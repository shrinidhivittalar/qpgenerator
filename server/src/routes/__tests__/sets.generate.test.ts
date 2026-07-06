// vi.mock is hoisted by vitest — must appear before any imports.
vi.mock('groq-sdk', () => {
  const create = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({ chat: { completions: { create } } })),
    __mockCreate: create,
  };
});

import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../app.js';
import { QuestionSet } from '../../models/QuestionSet.js';
import { GenerationRun } from '../../models/GenerationRun.js';
import mongoose from 'mongoose';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getMockCreate(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('groq-sdk');
  return (mod as any).__mockCreate as ReturnType<typeof vi.fn>;
}

async function registerAndLogin() {
  const email = `teacher-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test Teacher', email, password: 'password123', role: 'teacher', department: 'CS' })
    .expect(201);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function createSet(teacherId: string): Promise<string> {
  const set = await QuestionSet.create({
    teacherId,
    department: 'CS',
    fileName: 'source.pdf',
    sourceText: 'This is comprehensive source text about many educational topics. It covers mathematics, science, history, and literature. There are many facts and concepts here that can form the basis of questions.',
    status: 'draft',
  });
  return set._id.toString();
}

// Build a valid question shape for each type
function makeQuestion(type: string, idx: number, marks = 1): object {
  const base = {
    id: idx, marks,
    explanation: `Explanation for question ${idx}.`,
    question: { hide_text: false, text: `Question ${idx} text?`, read_text: false, image: '' },
  };
  switch (type) {
    case 'multipleChoice':
      return { ...base, options: [
        { hide_text: false, text: 'Option A', read_text: false, image: '' },
        { hide_text: false, text: 'Option B', read_text: false, image: '' },
      ], correctAnswer: 'Option A' };
    case 'multiSelect':
      return { ...base, options: [
        { hide_text: false, text: 'Option A', read_text: false, image: '' },
        { hide_text: false, text: 'Option B', read_text: false, image: '' },
      ], correctAnswer: ['Option A'] };
    case 'trueFalse':
      return { ...base, correctAnswer: true };
    case 'matchTheFollowing':
      return { ...base, leftItems: ['Term A'], rightItems: ['Def 1'], correctAnswer: [{ left: 'Term A', right: 'Def 1' }] };
    case 'reordering':
      return { ...base, items: ['Step 1', 'Step 2'], correctAnswer: ['Step 1', 'Step 2'] };
    case 'sorting':
      return { ...base, categories: ['Cat A'], items: ['Item 1'], correctAnswer: { 'Cat A': ['Item 1'] } };
    default: // fillInBlanks
      return { ...base, correctAnswer: `Answer ${idx}`, alternatives: [] };
  }
}

function makeQuestions(type: string, n: number, marks = 1): object[] {
  return Array.from({ length: n }, (_, i) => makeQuestion(type, i + 1, marks));
}

function groqResp(questions: unknown[]) {
  return {
    choices: [{ message: { content: JSON.stringify(questions) } }],
    usage: { total_tokens: 150 },
  };
}

// Detect question type from the machine-readable marker injected by buildPrompt
function typeFromParams(params: any): string {
  const sys: string = params.messages?.[0]?.content ?? '';
  const m = sys.match(/\[QUESTION_TYPE:(\w+)\]/);
  return m?.[1] ?? 'fillInBlanks';
}

// ---------------------------------------------------------------------------
// Test state (reset each beforeEach via setup.ts collection wipe)
// ---------------------------------------------------------------------------

let teacherToken: string;
let teacherId:    string;
let setId:        string;
let create:       ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const t = await registerAndLogin();
  teacherToken = t.token;
  teacherId    = t.userId;
  setId        = await createSet(teacherId);

  create = await getMockCreate();
  create.mockReset();
  // Default: return valid fillInBlanks questions for any type (overridden per-test)
  create.mockImplementation((params: any) =>
    Promise.resolve(groqResp(makeQuestions(typeFromParams(params), 10))),
  );
});

// ---------------------------------------------------------------------------
// TC-GEN-01 — Single type, exact count returned
// ---------------------------------------------------------------------------
describe('TC-GEN-01: Single type — exact count', () => {
  it('returns exactly N questions with no generationErrors', async () => {
    const COUNT = 7;
    create.mockImplementation((params: any) =>
      Promise.resolve(groqResp(makeQuestions(typeFromParams(params), COUNT))),
    );

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'fillInBlanks', count: COUNT, marksPerQuestion: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.questionBlocks).toHaveLength(1);
    expect(res.body.questionBlocks[0].questions).toHaveLength(COUNT);
    expect(res.body.generationErrors).toHaveLength(0);
    expect(res.body.totalGenerated).toBe(COUNT);
  });

  it('trims when AI returns more than requested (EC-GEN-05)', async () => {
    const REQUESTED = 3;
    create.mockImplementation((params: any) =>
      Promise.resolve(groqResp(makeQuestions(typeFromParams(params), 10))), // returns 10, requested 3
    );

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'fillInBlanks', count: REQUESTED, marksPerQuestion: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.questionBlocks[0].questions).toHaveLength(REQUESTED);
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-02 — Multiple types generated independently
// ---------------------------------------------------------------------------
describe('TC-GEN-02: Multiple types — each generates independently', () => {
  it('returns 3 blocks with correct per-type counts', async () => {
    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [
          { type: 'fillInBlanks',   count: 10, marksPerQuestion: 1 },
          { type: 'multipleChoice', count: 5,  marksPerQuestion: 2 },
          { type: 'trueFalse',      count: 5,  marksPerQuestion: 1 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.questionBlocks).toHaveLength(3);
    expect(res.body.totalGenerated).toBe(20);

    const byType = Object.fromEntries(
      res.body.questionBlocks.map((b: any) => [b.questionType, b.questions.length]),
    );
    expect(byType['fillInBlanks']).toBe(10);
    expect(byType['multipleChoice']).toBe(5);
    expect(byType['trueFalse']).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-03 — Count = 0 excluded from output
// ---------------------------------------------------------------------------
describe('TC-GEN-03: Count = 0 — type excluded entirely', () => {
  it('omits the zero-count type; does not appear as empty array', async () => {
    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [
          { type: 'trueFalse',    count: 0, marksPerQuestion: 1 },
          { type: 'fillInBlanks', count: 5, marksPerQuestion: 1 },
        ],
      });

    expect(res.status).toBe(200);
    const types = res.body.questionBlocks.map((b: any) => b.questionType);
    expect(types).not.toContain('trueFalse');
    expect(types).toContain('fillInBlanks');
  });

  it('returns 400 when ALL types have count = 0 (EC-GEN-02)', async () => {
    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'fillInBlanks', count: 0, marksPerQuestion: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one question type/i);
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-04 — IDs globally unique across types
// ---------------------------------------------------------------------------
describe('TC-GEN-04: IDs globally unique across types', () => {
  it('assigns sequential IDs 1..totalCount with no duplicates across types', async () => {
    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [
          { type: 'fillInBlanks',   count: 10, marksPerQuestion: 1 },
          { type: 'multipleChoice', count: 5,  marksPerQuestion: 2 },
        ],
      });

    expect(res.status).toBe(200);
    const allIds = res.body.questionBlocks.flatMap((b: any) => b.questions.map((q: any) => q.id));
    expect(allIds).toHaveLength(15);

    const unique = new Set(allIds);
    expect(unique.size).toBe(15); // no duplicates

    expect(Math.min(...allIds)).toBe(1);
    expect(Math.max(...allIds)).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-05 — explanation present and non-empty on every question
// ---------------------------------------------------------------------------
describe('TC-GEN-05: explanation present on every question', () => {
  it('every returned question has a non-empty explanation field', async () => {
    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [
          { type: 'fillInBlanks', count: 5, marksPerQuestion: 1 },
          { type: 'trueFalse',    count: 3, marksPerQuestion: 1 },
        ],
      });

    expect(res.status).toBe(200);
    for (const block of res.body.questionBlocks) {
      for (const q of block.questions) {
        expect(q.explanation).toBeTypeOf('string');
        expect(q.explanation.length).toBeGreaterThan(0);
      }
    }
  });

  it('questions missing explanation are discarded (EC-GEN-10: schema validation drops them)', async () => {
    // First call returns 2 questions (one missing explanation, one valid)
    // Second call (retry) returns the remaining valid question
    const validQ = makeQuestion('fillInBlanks', 1, 1);
    const missingExp = { ...makeQuestion('fillInBlanks', 2, 1), explanation: '' }; // empty → invalid
    const retryQ = makeQuestion('fillInBlanks', 2, 1);

    create
      .mockResolvedValueOnce(groqResp([missingExp, validQ])) // attempt 1: 1 valid
      .mockResolvedValueOnce(groqResp([retryQ]));             // attempt 2 (retry for shortfall): 1 valid

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'fillInBlanks', count: 2, marksPerQuestion: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.questionBlocks[0].questions).toHaveLength(2);
    for (const q of res.body.questionBlocks[0].questions) {
      expect((q as any).explanation).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-06 — totalMarks calculated correctly
// ---------------------------------------------------------------------------
describe('TC-GEN-06: totalMarks = count × marksPerQuestion', () => {
  it('block.totalMarks equals count × marksPerQuestion, and every q.marks matches', async () => {
    const COUNT = 8;
    const MPQ   = 2;

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'fillInBlanks', count: COUNT, marksPerQuestion: MPQ }] });

    expect(res.status).toBe(200);
    const block = res.body.questionBlocks[0];
    expect(block.totalMarks).toBe(COUNT * MPQ);
    for (const q of block.questions) {
      expect((q as any).marks).toBe(MPQ);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-07 — One type fails; others still succeed
// ---------------------------------------------------------------------------
describe('TC-GEN-07: Partial failure — one type fails, others succeed', () => {
  it('fillInBlanks succeeds; multipleChoice that returns [] → generationErrors', async () => {
    create.mockImplementation((params: any) => {
      const type = typeFromParams(params);
      if (type === 'multipleChoice') return Promise.resolve(groqResp([])); // always 0
      return Promise.resolve(groqResp(makeQuestions(type, 10)));
    });

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [
          { type: 'fillInBlanks',   count: 5, marksPerQuestion: 1 },
          { type: 'multipleChoice', count: 5, marksPerQuestion: 2 },
        ],
      });

    expect(res.status).toBe(200);

    const successTypes = res.body.questionBlocks.map((b: any) => b.questionType);
    expect(successTypes).toContain('fillInBlanks');
    expect(successTypes).not.toContain('multipleChoice');

    expect(res.body.generationErrors).toHaveLength(1);
    expect(res.body.generationErrors[0].type).toBe('multipleChoice');
    expect(res.body.generationErrors[0].requested).toBe(5);
    expect(res.body.generationErrors[0].received).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-08 — Extra fields stripped by Zod (.strip mode)
// ---------------------------------------------------------------------------
describe('TC-GEN-08: Extra fields on questions are stripped', () => {
  it('questions with extra AI fields have those fields removed before return', async () => {
    create.mockResolvedValueOnce(groqResp(
      makeQuestions('trueFalse', 3).map(q => ({ ...q, difficulty: 'hard', source_section: 2 })),
    ));

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'trueFalse', count: 3, marksPerQuestion: 1 }] });

    expect(res.status).toBe(200);
    for (const q of res.body.questionBlocks[0].questions) {
      expect(q).not.toHaveProperty('difficulty');
      expect(q).not.toHaveProperty('source_section');
      expect(q).toHaveProperty('correctAnswer');
      expect(q).toHaveProperty('explanation');
    }
  });
});

// ---------------------------------------------------------------------------
// TC-GEN-09 — Teacher B cannot generate for Teacher A's set
// ---------------------------------------------------------------------------
describe('TC-GEN-09: Ownership check', () => {
  it("returns 403 when a different teacher tries to generate for another teacher's set", async () => {
    const teacherB = await registerAndLogin();

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherB.token}`)
      .send({ typeConfig: [{ type: 'fillInBlanks', count: 3, marksPerQuestion: 1 }] });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permission/i);
  });
});

// ---------------------------------------------------------------------------
// EC-GEN-11 — Groq timeout: GenerationError recorded, route returns 200
// Note: withRetry inside callGroq retries 3×, with real 1s+2s backoffs ×
//       3 outer runTypeLoop iterations → ~9 s test duration.
// ---------------------------------------------------------------------------
describe('EC-GEN-11: Groq timeout → GenerationError, not 500', () => {
  it('returns 200 with generationErrors when Groq repeatedly times out', async () => {
    // Simulate withTimeout throwing — "timed out" in message makes it retryable by withRetry
    create.mockRejectedValue(
      new Error('groq:fillInBlanks timed out after 30000ms'),
    );

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'fillInBlanks', count: 3, marksPerQuestion: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.questionBlocks).toHaveLength(0);
    expect(res.body.generationErrors).toHaveLength(1);
    expect(res.body.generationErrors[0].type).toBe('fillInBlanks');
    expect(res.body.generationErrors[0].received).toBe(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// EC-GEN-12 — Groq 429 rate limit: retried, then GenerationError recorded
// Same ~9 s wall-clock time due to 1s+2s backoffs in withRetry.
// ---------------------------------------------------------------------------
describe('EC-GEN-12: Groq 429 → withRetry exhausted → GenerationError', () => {
  it('returns 200 with generationErrors after all retry attempts return 429', async () => {
    create.mockRejectedValue(
      Object.assign(new Error('Rate limit exceeded'), { status: 429 }),
    );

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'trueFalse', count: 3, marksPerQuestion: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.questionBlocks).toHaveLength(0);
    expect(res.body.generationErrors).toHaveLength(1);
    expect(res.body.generationErrors[0].type).toBe('trueFalse');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// EC-GEN-13 — Daily token budget exceeded → 429 pre-check
// ---------------------------------------------------------------------------
describe('EC-GEN-13: Daily token budget exceeded → 429 before generation starts', () => {
  it('returns 429 when daily token total already exceeds DAILY_TOKEN_LIMIT', async () => {
    // Create a run that exhausts the 100k default limit
    await GenerationRun.create({
      setId:           new mongoose.Types.ObjectId(setId),
      userId:          new mongoose.Types.ObjectId(teacherId),
      role:            'teacher',
      typesRequested:  ['fillInBlanks'],
      countsRequested: { fillInBlanks: 1 },
      tokensUsed:      100_001, // exceeds default DAILY_TOKEN_LIMIT (100_000)
      durationMs:      500,
    });

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'fillInBlanks', count: 3, marksPerQuestion: 1 }] });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/budget exceeded/i);
    // Groq must NOT have been called
    expect(create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GenerationRun always created — success and partial failure cases
// ---------------------------------------------------------------------------
describe('GenerationRun created after every generate call (EC-DATA-01)', () => {
  it('creates a GenerationRun on success', async () => {
    await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ typeConfig: [{ type: 'fillInBlanks', count: 5, marksPerQuestion: 1 }] })
      .expect(200);

    const run = await GenerationRun.findOne({ setId });
    expect(run).not.toBeNull();
    expect(run!.typesSucceeded).toContain('fillInBlanks');
    expect(run!.typesFailed).toHaveLength(0);
  });

  it('creates a GenerationRun even on partial failure', async () => {
    create.mockImplementation((params: any) => {
      const type = typeFromParams(params);
      if (type === 'trueFalse') return Promise.resolve(groqResp([]));
      return Promise.resolve(groqResp(makeQuestions(type, 10)));
    });

    await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [
          { type: 'fillInBlanks', count: 5, marksPerQuestion: 1 },
          { type: 'trueFalse',    count: 5, marksPerQuestion: 1 },
        ],
      })
      .expect(200);

    const run = await GenerationRun.findOne({ setId });
    expect(run).not.toBeNull();
    expect(run!.typesSucceeded).toContain('fillInBlanks');
    expect(run!.typesFailed).toContain('trueFalse');
  });
});

// ---------------------------------------------------------------------------
// Parallelism — 4 types complete faster than 4 sequential Groq calls
// ---------------------------------------------------------------------------
describe('Parallelism: 4 types in parallel faster than sequential', () => {
  it('completes 4 types (each with 100ms Groq delay) well under 4×100ms', async () => {
    const CALL_DELAY = 100; // ms per Groq call

    create.mockImplementation(async (params: any) => {
      const type = typeFromParams(params);
      await new Promise(r => setTimeout(r, CALL_DELAY));
      return groqResp(makeQuestions(type, 5));
    });

    const start = Date.now();

    const res = await request(app)
      .post(`/api/sets/${setId}/generate`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        typeConfig: [
          { type: 'fillInBlanks',   count: 5, marksPerQuestion: 1 },
          { type: 'multipleChoice', count: 5, marksPerQuestion: 2 },
          { type: 'trueFalse',      count: 5, marksPerQuestion: 1 },
          { type: 'multiSelect',    count: 5, marksPerQuestion: 1 },
        ],
      });

    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.totalGenerated).toBe(20);
    // 4 sequential = 400ms; parallel should finish in ≤ 350ms
    expect(elapsed).toBeLessThan(350);
  });
});
