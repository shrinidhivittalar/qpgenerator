// vi.mock is hoisted by vitest — must appear before any imports.
vi.mock('groq-sdk', () => {
  const create = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({ chat: { completions: { create } } })),
    __mockCreate: create,
  };
});

// Mock generateTypeViaSlots in isolation; keep all other exports real so the
// fallback generateSet path (used by TC-GEN-SL-04) functions normally.
vi.mock('../../ai/generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ai/generator.js')>();
  return { ...actual, generateTypeViaSlots: vi.fn() };
});

import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../app.js';
import { QuestionSet } from '../../models/QuestionSet.js';
import { GenerationRun } from '../../models/GenerationRun.js';
import TextbookChapter from '../../models/TextbookChapter.js';
import { generateTypeViaSlots } from '../../ai/generator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getMockCreate(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('groq-sdk');
  return (mod as any).__mockCreate as ReturnType<typeof vi.fn>;
}

async function registerAndLogin() {
  const email = `teacher-sl-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Slot Teacher', email, password: 'password123', role: 'teacher', department: 'CS' })
    .expect(201);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function createSet(teacherId: string): Promise<string> {
  const set = await QuestionSet.create({
    teacherId,
    department: 'CS',
    fileName:   'source.pdf',
    sourceText: 'Comprehensive source text covering many topics in computer science including algorithms, data structures, operating systems, and networking concepts.',
    status:     'draft',
  });
  return set._id.toString();
}

function makeFIBQuestion(idx: number, marks = 1): object {
  return {
    id:          idx,
    marks,
    explanation: `Explanation for question ${idx}.`,
    question:    { hide_text: false, text: `Question ${idx}?`, read_text: false, image: '' },
    correctAnswer: `Answer ${idx}`,
    alternatives:  [],
  };
}

function makeFIBQuestions(n: number, marks = 1): object[] {
  return Array.from({ length: n }, (_, i) => makeFIBQuestion(i + 1, marks));
}

function groqResp(questions: unknown[]) {
  return {
    choices: [{ message: { content: JSON.stringify(questions) } }],
    usage:   { total_tokens: 120 },
  };
}

async function createChapters(ownerId: string) {
  const ch1 = await TextbookChapter.create({
    teacherId:         ownerId,
    subject:           'CS',
    title:             'Algorithms',
    chapterNumber:     1,
    weightPercent:     60,
    sourceText:        'Algorithms are step-by-step procedures for solving problems. Sorting, searching, and graph traversal are foundational algorithms.',
    highValueSnippets: [],
  });
  const ch2 = await TextbookChapter.create({
    teacherId:         ownerId,
    subject:           'CS',
    title:             'Data Structures',
    chapterNumber:     2,
    weightPercent:     40,
    sourceText:        'Data structures organise data for efficient access. Arrays, linked lists, trees, and hash tables are commonly used.',
    highValueSnippets: [],
  });
  return [ch1, ch2] as const;
}

const mockSlots = generateTypeViaSlots as ReturnType<typeof vi.fn>;

let teacherToken: string;
let teacherId:    string;
let setId:        string;

beforeEach(async () => {
  const t  = await registerAndLogin();
  teacherToken = t.token;
  teacherId    = t.userId;
  setId        = await createSet(teacherId);

  mockSlots.mockReset();

  // Fallback Groq mock — used by the generateSet path (TC-GEN-SL-04)
  const create = await getMockCreate();
  create.mockReset();
  create.mockImplementation(() =>
    Promise.resolve(groqResp(makeFIBQuestions(10))),
  );
});

// ---------------------------------------------------------------------------
// TC-GEN-SL-01: slot path activated when chapterIds provided
// ---------------------------------------------------------------------------
describe('TC-GEN-SL-01: Slot path activated when chapterIds provided', () => {
  it('calls generateTypeViaSlots instead of generateSet', async () => {
    const [ch1, ch2] = await createChapters(teacherId);

    mockSlots.mockResolvedValue({
      questions: makeFIBQuestions(5),
      requested: 5,
      received:  5,
    });

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [{ type: 'fillInBlanks', count: 5, marksPerQuestion: 1 }],
        chapterIds: [ch1._id.toString(), ch2._id.toString()],
      });

    expect(res.status).toBe(200);
    expect(mockSlots).toHaveBeenCalledOnce();
    expect(res.body.questionBlocks).toHaveLength(1);
    expect(res.body.questionBlocks[0].questions).toHaveLength(5);
    expect(res.body.generationErrors).toHaveLength(0);
    expect(res.body.totalGenerated).toBe(5);
  });

  it('passes correct chapter inputs to generateTypeViaSlots', async () => {
    const [ch1, ch2] = await createChapters(teacherId);

    mockSlots.mockResolvedValue({ questions: makeFIBQuestions(3), requested: 3, received: 3 });

    await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [{ type: 'fillInBlanks', count: 3, marksPerQuestion: 2 }],
        chapterIds: [ch1._id.toString(), ch2._id.toString()],
        tone:       'formal-board-exam',
      });

    const [callType, callCount, callMarks, callChapters] = mockSlots.mock.calls[0];
    expect(callType).toBe('fillInBlanks');
    expect(callCount).toBe(3);
    expect(callMarks).toBe(2);
    expect(callChapters).toHaveLength(2);
    expect(callChapters[0].id).toBe(ch1._id.toString());
    expect(callChapters[1].id).toBe(ch2._id.toString());
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-SL-02: IDs globally unique across slot-generated blocks
// ---------------------------------------------------------------------------
describe('TC-GEN-SL-02: IDs globally unique in slot path', () => {
  it('assigns sequential IDs 1..N with no duplicates across types', async () => {
    const [ch1] = await createChapters(teacherId);

    mockSlots
      .mockResolvedValueOnce({ questions: makeFIBQuestions(4, 1), requested: 4, received: 4 })
      .mockResolvedValueOnce({
        questions: [
          { id: 99, marks: 2, explanation: 'E.', question: { hide_text: false, text: 'TF?', read_text: false, image: '' }, correctAnswer: true },
          { id: 99, marks: 2, explanation: 'E2.', question: { hide_text: false, text: 'TF2?', read_text: false, image: '' }, correctAnswer: false },
        ],
        requested: 2,
        received:  2,
      });

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [
          { type: 'fillInBlanks', count: 4, marksPerQuestion: 1 },
          { type: 'trueFalse',    count: 2, marksPerQuestion: 2 },
        ],
        chapterIds: [ch1._id.toString()],
      });

    expect(res.status).toBe(200);
    const allIds = res.body.questionBlocks.flatMap((b: any) => b.questions.map((q: any) => q.id));
    expect(allIds).toHaveLength(6);
    expect(new Set(allIds).size).toBe(6); // all unique
    expect(Math.min(...allIds)).toBe(1);
    expect(Math.max(...allIds)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-SL-03: partial slot failure → generationErrors
// ---------------------------------------------------------------------------
describe('TC-GEN-SL-03: Partial slot failure → generationErrors', () => {
  it('adds a generationError when received < requested and no block is created', async () => {
    const [ch1] = await createChapters(teacherId);

    mockSlots.mockResolvedValue({
      questions: makeFIBQuestions(2),
      requested: 5,
      received:  2,
    });

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [{ type: 'fillInBlanks', count: 5, marksPerQuestion: 1 }],
        chapterIds: [ch1._id.toString()],
      });

    expect(res.status).toBe(200);
    expect(res.body.questionBlocks).toHaveLength(0);
    expect(res.body.generationErrors).toHaveLength(1);
    expect(res.body.generationErrors[0].type).toBe('fillInBlanks');
    expect(res.body.generationErrors[0].requested).toBe(5);
    expect(res.body.generationErrors[0].received).toBe(2);
  });

  it('one type succeeds, another fails — both reflected correctly', async () => {
    const [ch1] = await createChapters(teacherId);

    mockSlots
      .mockResolvedValueOnce({ questions: makeFIBQuestions(3, 1), requested: 3, received: 3 })
      .mockResolvedValueOnce({ questions: [], requested: 3, received: 0 });

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [
          { type: 'fillInBlanks', count: 3, marksPerQuestion: 1 },
          { type: 'trueFalse',    count: 3, marksPerQuestion: 1 },
        ],
        chapterIds: [ch1._id.toString()],
      });

    expect(res.status).toBe(200);
    const successTypes = res.body.questionBlocks.map((b: any) => b.questionType);
    expect(successTypes).toContain('fillInBlanks');
    expect(successTypes).not.toContain('trueFalse');
    expect(res.body.generationErrors).toHaveLength(1);
    expect(res.body.generationErrors[0].type).toBe('trueFalse');
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-SL-04: non-owned chapters excluded → falls back to generateSet
// ---------------------------------------------------------------------------
describe('TC-GEN-SL-04: Non-owned chapters excluded → fallback to text path', () => {
  it('falls back to generateSet when chapterIds belong to another teacher', async () => {
    const otherTeacher = await registerAndLogin();
    const [theirCh]    = await createChapters(otherTeacher.userId);

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [{ type: 'fillInBlanks', count: 3, marksPerQuestion: 1 }],
        chapterIds: [theirCh._id.toString()],
      });

    // generateTypeViaSlots must NOT have been called — fell back to generateSet
    expect(mockSlots).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body.questionBlocks).toHaveLength(1);
  });

  it('falls back to generateSet when chapterIds contains only malformed ObjectIds', async () => {
    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [{ type: 'fillInBlanks', count: 3, marksPerQuestion: 1 }],
        chapterIds: ['not-an-objectid', '12345'],
      });

    expect(mockSlots).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body.questionBlocks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-SL-05: chapterIds persisted on QuestionSet
// ---------------------------------------------------------------------------
describe('TC-GEN-SL-05: chapterIds saved on QuestionSet', () => {
  it('stores resolved chapterIds on the QuestionSet document', async () => {
    const [ch1, ch2] = await createChapters(teacherId);

    mockSlots.mockResolvedValue({ questions: makeFIBQuestions(3), requested: 3, received: 3 });

    await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [{ type: 'fillInBlanks', count: 3, marksPerQuestion: 1 }],
        chapterIds: [ch1._id.toString(), ch2._id.toString()],
      });

    const saved = await QuestionSet.findById(setId).lean();
    const savedIds = (saved?.chapterIds ?? []).map(String);
    expect(savedIds).toContain(ch1._id.toString());
    expect(savedIds).toContain(ch2._id.toString());
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-SL-06: chapterIds recorded in GenerationRun audit log
// ---------------------------------------------------------------------------
describe('TC-GEN-SL-06: chapterIds recorded in GenerationRun', () => {
  it('saves chapterIds in the audit GenerationRun document', async () => {
    const [ch1] = await createChapters(teacherId);

    mockSlots.mockResolvedValue({ questions: makeFIBQuestions(2), requested: 2, received: 2 });

    await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [{ type: 'fillInBlanks', count: 2, marksPerQuestion: 1 }],
        chapterIds: [ch1._id.toString()],
      });

    const run = await GenerationRun.findOne({ setId }).lean();
    expect(run).not.toBeNull();
    expect(run!.chapterIds?.map(String)).toContain(ch1._id.toString());
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-SL-07: totalMarks correct for slot-generated blocks
// ---------------------------------------------------------------------------
describe('TC-GEN-SL-07: totalMarks correct in slot path', () => {
  it('block.totalMarks = count × marksPerQuestion for slot-generated blocks', async () => {
    const [ch1] = await createChapters(teacherId);
    const COUNT = 4;
    const MPQ   = 3;

    mockSlots.mockResolvedValue({
      questions: makeFIBQuestions(COUNT, MPQ),
      requested: COUNT,
      received:  COUNT,
    });

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [{ type: 'fillInBlanks', count: COUNT, marksPerQuestion: MPQ }],
        chapterIds: [ch1._id.toString()],
      });

    expect(res.status).toBe(200);
    expect(res.body.questionBlocks[0].totalMarks).toBe(COUNT * MPQ);
    for (const q of res.body.questionBlocks[0].questions) {
      expect((q as any).marks).toBe(MPQ);
    }
  });
});
