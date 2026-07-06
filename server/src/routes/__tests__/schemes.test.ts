// vi.mock is hoisted â€” runs before any imports.
vi.mock('pdf-parse/lib/pdf-parse.js', () => ({
  default: vi.fn().mockResolvedValue({ text: 'Section A: MCQ (20 x 1 mark)\nSection B: Fill in blanks (10 x 1 mark)' }),
}));

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn().mockResolvedValue({ value: 'Section A: True or False (15 x 1 mark)\nSection B: MCQ (10 x 2 marks)' }),
  },
}));

// Mock schemeParser so route tests don't depend on Groq â€” parser is unit-tested separately.
vi.mock('../../ai/schemeParser.js', () => ({
  parseSchemeBlueprint: vi.fn(),
}));

import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../app.js';
import { QuestionSet } from '../../models/QuestionSet.js';
import mongoose from 'mongoose';

const PARSED_CONFIG_PDF  = [
  { type: 'multipleChoice', count: 20, marksPerQuestion: 1 },
  { type: 'fillInBlanks',   count: 10, marksPerQuestion: 1 },
];
const PARSED_CONFIG_DOCX = [
  { type: 'trueFalse',      count: 15, marksPerQuestion: 1 },
  { type: 'multipleChoice', count: 10, marksPerQuestion: 2 },
];
const PARSED_CONFIG_REPLACED = [
  { type: 'sorting',   count: 5, marksPerQuestion: 3 },
  { type: 'reordering', count: 5, marksPerQuestion: 3 },
];

const FAKE_PDF  = Buffer.from('%PDF-1.4 fake pdf content for testing only');
const FAKE_DOCX = Buffer.from('PK fake docx content');

function makeBlueprint(config: Array<{ type: string; count: number; marksPerQuestion: number }>, overrides: Record<string, unknown> = {}) {
  const sections = config.map((tc, index) => ({
    name: `Section ${String.fromCharCode(65 + index)}`,
    instructions: '',
    questionType: tc.type,
    count: tc.count,
    marksPerQuestion: tc.marksPerQuestion,
    totalMarks: tc.count * tc.marksPerQuestion,
    choicePattern: '',
    difficultyMix: { easy: 30, moderate: 50, hard: 20 },
    bloomsDistribution: { remember: 30, understand: 30, apply: 25, analyze: 15 },
    expectedAnswerStyle: '',
    sourceEvidence: [],
  }));

  return {
    title: 'Inferred Blueprint',
    examBoard: 'inferred',
    institutionType: 'school',
    subject: 'Mathematics',
    standard: '10',
    examType: '',
    totalMarks: sections.reduce((sum, s) => sum + s.totalMarks, 0),
    tone: 'formal-board-exam',
    difficultyDefault: 'moderate',
    chapters: [],
    sections,
    globalInstructions: [],
    constraints: [],
    inferredFrom: ['scheme-document'],
    ...overrides,
  };
}
async function registerAndGetToken(suffix = '') {
  const email = `teacher-${Date.now()}-${suffix}${Math.random().toString(36).slice(2)}@test.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test Teacher', email, password: 'password123', role: 'teacher', department: 'CS' })
    .expect(201);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function uploadScheme(token: string, config = PARSED_CONFIG_PDF) {
  const { parseSchemeBlueprint } = await import('../../ai/schemeParser.js');
  (parseSchemeBlueprint as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeBlueprint(config));

  const res = await request(app)
    .post('/api/schemes/upload')
    .set('Authorization', `Bearer ${token}`)
    .field('name',     'CBSE 10th Maths')
    .field('subject',  'Mathematics')
    .field('standard', '10')
    .attach('file', FAKE_PDF, { filename: 'scheme.pdf', contentType: 'application/pdf' });

  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// â”€â”€â”€ TC-SCH-01: Upload PDF â†’ parsedConfig reflects correct types/counts â”€â”€â”€â”€â”€â”€
describe('TC-SCH-01: POST /api/schemes/upload (PDF)', () => {
  it('returns 201 with schemeId, parsedConfig and previewSections derived from config', async () => {
    const { token } = await registerAndGetToken('01');
    const res = await uploadScheme(token, PARSED_CONFIG_PDF);

    expect(res.status).toBe(201);
    expect(res.body.schemeId).toBeTypeOf('string');
    expect(res.body.parsedConfig).toHaveLength(2);
    expect(res.body.parsedConfig[0]).toEqual({ type: 'multipleChoice', count: 20, marksPerQuestion: 1 });
    expect(res.body.parsedConfig[1]).toEqual({ type: 'fillInBlanks',   count: 10, marksPerQuestion: 1 });
    // previewSections are human-readable strings derived from parsedConfig
    expect(res.body.previewSections).toHaveLength(2);
    expect(res.body.previewSections[0]).toMatch(/multipleChoice/);
    expect(res.body.previewSections[0]).toMatch(/20/);
    expect(res.body.previewSections[1]).toMatch(/fillInBlanks/);
  });

  it('returns 422 when pdf-parse returns no extractable text', async () => {
    const { token } = await registerAndGetToken('01b');
    const mockPdf = (await import('pdf-parse/lib/pdf-parse.js')).default as ReturnType<typeof vi.fn>;
    mockPdf.mockResolvedValueOnce({ text: '   ' });

    const res = await request(app)
      .post('/api/schemes/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'X').field('subject', 'X').field('standard', 'X')
      .attach('file', FAKE_PDF, { filename: 'bad.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/extract/i);
  });

  it('returns 422 when scheme parser cannot identify question types (SCH-06)', async () => {
    const { token } = await registerAndGetToken('01c');
    const { parseSchemeBlueprint } = await import('../../ai/schemeParser.js');
    (parseSchemeBlueprint as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('SCHEME_PARSE_FAILED'));

    const res = await request(app)
      .post('/api/schemes/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'X').field('subject', 'X').field('standard', 'X')
      .attach('file', FAKE_PDF, { filename: 'unreadable.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/parse/i);
  });

  it('returns 400 for unsupported file type (not PDF or .docx)', async () => {
    const { token } = await registerAndGetToken('01d');

    const res = await request(app)
      .post('/api/schemes/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'X').field('subject', 'X').field('standard', 'X')
      .attach('file', Buffer.from('plain text'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PDF|Word/i);
  });
});

// â”€â”€â”€ TC-SCH-02: Upload .docx scheme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('TC-SCH-02: POST /api/schemes/upload (.docx)', () => {
  it('extracts text via mammoth and parses correctly', async () => {
    const { token } = await registerAndGetToken('02');
    const { parseSchemeBlueprint } = await import('../../ai/schemeParser.js');
    (parseSchemeBlueprint as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeBlueprint(PARSED_CONFIG_DOCX));

    const res = await request(app)
      .post('/api/schemes/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name',     'CBSE 9th Science')
      .field('subject',  'Science')
      .field('standard', '9')
      .attach('file', FAKE_DOCX, {
        filename: 'scheme.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

    expect(res.status).toBe(201);
    expect(res.body.parsedConfig).toHaveLength(2);
    expect(res.body.parsedConfig[0].type).toBe('trueFalse');
    expect(res.body.parsedConfig[1].type).toBe('multipleChoice');

    // Verify mammoth was called (not pdf-parse)
    const mammoth = (await import('mammoth')).default as any;
    expect(mammoth.extractRawText).toHaveBeenCalledOnce();
  });
});

// â”€â”€â”€ TC-SCH-03: GET /api/schemes â†’ scheme appears in list for second set â”€â”€â”€â”€â”€
describe('TC-SCH-03: GET /api/schemes (saved scheme appears in picker)', () => {
  it('returns the saved scheme after upload, sorted by updatedAt desc', async () => {
    const { token } = await registerAndGetToken('03');
    const uploadRes = await uploadScheme(token);
    expect(uploadRes.status).toBe(201);
    const schemeId = uploadRes.body.schemeId as string;

    const listRes = await request(app)
      .get('/api/schemes')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].schemeId).toBe(schemeId);
    expect(listRes.body[0].parsedConfig).toHaveLength(2);
    expect(listRes.body[0]).not.toHaveProperty('rawText'); // rawText excluded from list
  });

  it('returns 200 empty array when teacher has no schemes', async () => {
    const { token } = await registerAndGetToken('03b');

    const res = await request(app)
      .get('/api/schemes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// â”€â”€â”€ TC-SCH-04: Replace â†’ new parsedConfig; QuestionSet typeConfig unchanged â”€
describe('TC-SCH-04: PATCH /api/schemes/:id/replace', () => {
  it('updates scheme parsedConfig without touching any QuestionSet that references it', async () => {
    const { token, userId } = await registerAndGetToken('04');

    // 1. Upload initial scheme
    const uploadRes = await uploadScheme(token, PARSED_CONFIG_PDF);
    expect(uploadRes.status).toBe(201);
    const schemeId = uploadRes.body.schemeId as string;

    // 2. Create a QuestionSet referencing this scheme with typeConfig A
    const originalTypeConfig = [{ type: 'fillInBlanks', count: 5, marksPerQuestion: 1 }];
    const qs = await QuestionSet.create({
      teacherId:   new mongoose.Types.ObjectId(userId),
      department:  'CS',
      fileName:    'source.pdf',
      sourceText:  'source text',
      typeConfig:  originalTypeConfig,
      schemeId:    new mongoose.Types.ObjectId(schemeId),
    });

    // 3. Replace scheme with new file â†’ different parsedConfig
    const { parseSchemeBlueprint } = await import('../../ai/schemeParser.js');
    (parseSchemeBlueprint as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeBlueprint(PARSED_CONFIG_REPLACED));

    const replaceRes = await request(app)
      .patch(`/api/schemes/${schemeId}/replace`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', FAKE_PDF, { filename: 'new-scheme.pdf', contentType: 'application/pdf' });

    expect(replaceRes.status).toBe(200);
    expect(replaceRes.body.parsedConfig).toHaveLength(2);
    expect(replaceRes.body.parsedConfig[0].type).toBe('sorting');

    // 4. QuestionSet typeConfig is unchanged (SCH-09)
    const freshQs = await QuestionSet.findById(qs._id).lean();
    expect(freshQs!.typeConfig).toHaveLength(1);
    expect((freshQs!.typeConfig[0] as any).type).toBe('fillInBlanks');
    expect((freshQs!.typeConfig[0] as any).count).toBe(5);
  });
});

// â”€â”€â”€ TC-SCH-05: Delete â†’ scheme gone; QuestionSet still functional â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('TC-SCH-05: DELETE /api/schemes/:id', () => {
  it('deletes scheme but leaves any referencing QuestionSet intact (SCH-13)', async () => {
    const { token, userId } = await registerAndGetToken('05');

    // Upload a scheme
    const uploadRes = await uploadScheme(token);
    const schemeId = uploadRes.body.schemeId as string;

    // Create a QuestionSet referencing it
    const qs = await QuestionSet.create({
      teacherId:  new mongoose.Types.ObjectId(userId),
      department: 'CS',
      fileName:   'src.pdf',
      sourceText: 'text',
      schemeId:   new mongoose.Types.ObjectId(schemeId),
    });

    // Delete the scheme (SCH-13 â€” no cascade)
    const delRes = await request(app)
      .delete(`/api/schemes/${schemeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // Scheme is gone from list
    const listRes = await request(app)
      .get('/api/schemes')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.body).toHaveLength(0);

    // QuestionSet still exists with its schemeId field intact
    const freshQs = await QuestionSet.findById(qs._id).lean();
    expect(freshQs).not.toBeNull();
    expect(freshQs!.schemeId?.toString()).toBe(schemeId);
  });

  it('returns 404 when scheme does not exist', async () => {
    const { token } = await registerAndGetToken('05b');
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .delete(`/api/schemes/${fakeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// â”€â”€â”€ TC-SCH-06: Cross-teacher 403 for GET, PATCH, DELETE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe('TC-SCH-06: Cross-teacher authorization (SCH-14)', () => {
  it('returns 403 when teacher B tries to GET a scheme owned by teacher A', async () => {
    const a = await registerAndGetToken('06a');
    const b = await registerAndGetToken('06b');

    const uploadRes = await uploadScheme(a.token);
    const schemeId = uploadRes.body.schemeId as string;

    const res = await request(app)
      .get(`/api/schemes/${schemeId}`)
      .set('Authorization', `Bearer ${b.token}`);

    expect(res.status).toBe(403);
  });

  it('returns 403 when teacher B tries to PATCH /replace a scheme owned by teacher A', async () => {
    const a = await registerAndGetToken('06c');
    const b = await registerAndGetToken('06d');

    const uploadRes = await uploadScheme(a.token);
    const schemeId = uploadRes.body.schemeId as string;

    // No parseScheme mock needed â€” ownership check fires before extraction/parsing
    const res = await request(app)
      .patch(`/api/schemes/${schemeId}/replace`)
      .set('Authorization', `Bearer ${b.token}`)
      .attach('file', FAKE_PDF, { filename: 'scheme.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
  });

  it('returns 403 when teacher B tries to DELETE a scheme owned by teacher A', async () => {
    const a = await registerAndGetToken('06e');
    const b = await registerAndGetToken('06f');

    const uploadRes = await uploadScheme(a.token);
    const schemeId = uploadRes.body.schemeId as string;

    const res = await request(app)
      .delete(`/api/schemes/${schemeId}`)
      .set('Authorization', `Bearer ${b.token}`);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated request hits any scheme route', async () => {
    const res = await request(app).get('/api/schemes');
    expect(res.status).toBe(401);
  });
});

// â”€â”€â”€ TC-SCH-07: Parser type safety â€” no invalid type names ever emitted â”€â”€â”€â”€â”€â”€â”€
describe('TC-SCH-07: Scheme parser type safety (integration with route)', () => {
  it('returns 422 when parseScheme throws SCHEME_PARSE_FAILED (all types unknown/zero)', async () => {
    const { token } = await registerAndGetToken('07');
    const { parseSchemeBlueprint } = await import('../../ai/schemeParser.js');
    (parseSchemeBlueprint as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('SCHEME_PARSE_FAILED'));

    const res = await request(app)
      .post('/api/schemes/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Adversarial').field('subject', 'Math').field('standard', '10')
      .attach('file', FAKE_PDF, { filename: 'adversarial.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/parse/i);
  });

  it('stores only the config returned by parseScheme â€” route never re-injects types', async () => {
    const { token } = await registerAndGetToken('07b');
    // Parser returns only 1 valid type (as if other sections were filtered out)
    const { parseSchemeBlueprint } = await import('../../ai/schemeParser.js');
    (parseSchemeBlueprint as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeBlueprint([
      { type: 'trueFalse', count: 10, marksPerQuestion: 1 },
    ]));

    const res = await request(app)
      .post('/api/schemes/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Partial').field('subject', 'Bio').field('standard', '11')
      .attach('file', FAKE_PDF, { filename: 'partial.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.parsedConfig).toHaveLength(1);
    expect(res.body.parsedConfig[0].type).toBe('trueFalse');
    // No other types injected
    expect(res.body.parsedConfig.every((c: any) => c.type === 'trueFalse')).toBe(true);
  });
});
