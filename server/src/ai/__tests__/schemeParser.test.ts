import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock groq-sdk before importing schemeParser
vi.mock('groq-sdk', () => {
  const create = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create } },
    })),
    __mockCreate: create,
  };
  it('returns TypeConfig entries derived from a full ExamBlueprint object', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValueOnce(makeGroqResponse(JSON.stringify({
      title: 'University Pattern Midterm',
      examBoard: 'VTU',
      institutionType: 'engineering college',
      subject: 'Artificial Intelligence',
      standard: 'Semester 5',
      examType: 'Midterm',
      totalMarks: 30,
      tone: 'formal-board-exam',
      difficultyDefault: 'moderate',
      chapters: [
        { title: 'Search', aliases: [], estimatedWeight: 40, learningOutcomes: [], sourceEvidence: ['Unit 1'] },
      ],
      sections: [
        {
          name: 'Part A',
          instructions: 'Answer all questions.',
          questionType: 'multipleChoice',
          count: 10,
          marksPerQuestion: 1,
          totalMarks: 10,
          choicePattern: '',
          difficultyMix: { easy: 40, moderate: 40, hard: 20 },
          bloomsDistribution: { remember: 30, understand: 30, apply: 25, analyze: 15 },
          expectedAnswerStyle: 'Select the correct option.',
          sourceEvidence: ['10 x 1'],
        },
        {
          name: 'Part B',
          instructions: 'Answer any four.',
          questionType: 'shortAnswer',
          count: 4,
          marksPerQuestion: 5,
          totalMarks: 20,
          choicePattern: 'Answer any 4 out of 6.',
          difficultyMix: { easy: 20, moderate: 50, hard: 30 },
          bloomsDistribution: { remember: 20, understand: 30, apply: 30, analyze: 20 },
          expectedAnswerStyle: 'Brief explanatory answer.',
          sourceEvidence: ['4 x 5'],
        },
      ],
      globalInstructions: [],
      constraints: [],
      inferredFrom: ['scheme-document'],
    })));

    const { parseScheme } = await import('../schemeParser.js');
    const result = await parseScheme('University midterm paper pattern');

    expect(result).toEqual([
      { type: 'multipleChoice', count: 10, marksPerQuestion: 1 },
      { type: 'shortAnswer', count: 4, marksPerQuestion: 5 },
    ]);
  });
});

// Helper to get the mocked `create` fn without importing groq-sdk directly
async function getMockCreate() {
  const mod = await import('groq-sdk');
  return (mod as any).__mockCreate as ReturnType<typeof vi.fn>;
}

function makeGroqResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('parseScheme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // â”€â”€â”€ TC-SCH-PARSE-01 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('returns 3 TypeConfig entries for a clean scheme with 3 clear sections', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValueOnce(makeGroqResponse(JSON.stringify([
      { type: 'fillInBlanks',   count: 10, marksPerQuestion: 1 },
      { type: 'multipleChoice', count: 5,  marksPerQuestion: 2 },
      { type: 'trueFalse',      count: 8,  marksPerQuestion: 1 },
    ])));

    const { parseScheme } = await import('../schemeParser.js');
    const result = await parseScheme('Section A: Fill in the blanks...');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'fillInBlanks',   count: 10, marksPerQuestion: 1 });
    expect(result[1]).toEqual({ type: 'multipleChoice', count: 5,  marksPerQuestion: 2 });
    expect(result[2]).toEqual({ type: 'trueFalse',      count: 8,  marksPerQuestion: 1 });
  });

  // â”€â”€â”€ TC-SCH-PARSE-02a â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('filters out entries with type names not in VALID_TYPES', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValueOnce(makeGroqResponse(JSON.stringify([
      { type: 'multipleChoice', count: 5, marksPerQuestion: 2 },
      { type: 'essay',          count: 3, marksPerQuestion: 5 }, // invalid type
    ])));

    const { parseScheme } = await import('../schemeParser.js');
    const result = await parseScheme('some scheme text');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('multipleChoice');
  });

  // â”€â”€â”€ TC-SCH-PARSE-02b â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('throws SCHEME_PARSE_FAILED when the only entry has an invalid type name', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValueOnce(makeGroqResponse(JSON.stringify([
      { type: 'essay', count: 3, marksPerQuestion: 5 },
    ])));

    const { parseScheme } = await import('../schemeParser.js');
    await expect(parseScheme('some scheme text')).rejects.toThrow('SCHEME_PARSE_FAILED');
  });

  // â”€â”€â”€ TC-SCH-PARSE-03 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('throws SCHEME_PARSE_FAILED when model returns malformed JSON', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValueOnce(makeGroqResponse('this is not json at all'));

    const { parseScheme } = await import('../schemeParser.js');
    await expect(parseScheme('some scheme text')).rejects.toThrow('SCHEME_PARSE_FAILED');
  });

  // â”€â”€â”€ TC-SCH-PARSE-04 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('throws SCHEME_PARSE_FAILED when count is a string "10" instead of a number', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValueOnce(makeGroqResponse(JSON.stringify([
      { type: 'fillInBlanks', count: '10', marksPerQuestion: 1 }, // count is string
    ])));

    const { parseScheme } = await import('../schemeParser.js');
    await expect(parseScheme('some scheme text')).rejects.toThrow('SCHEME_PARSE_FAILED');
  });
  it('returns TypeConfig entries derived from a full ExamBlueprint object', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValueOnce(makeGroqResponse(JSON.stringify({
      title: 'University Pattern Midterm',
      examBoard: 'VTU',
      institutionType: 'engineering college',
      subject: 'Artificial Intelligence',
      standard: 'Semester 5',
      examType: 'Midterm',
      totalMarks: 30,
      tone: 'formal-board-exam',
      difficultyDefault: 'moderate',
      chapters: [
        { title: 'Search', aliases: [], estimatedWeight: 40, learningOutcomes: [], sourceEvidence: ['Unit 1'] },
      ],
      sections: [
        {
          name: 'Part A',
          instructions: 'Answer all questions.',
          questionType: 'multipleChoice',
          count: 10,
          marksPerQuestion: 1,
          totalMarks: 10,
          choicePattern: '',
          difficultyMix: { easy: 40, moderate: 40, hard: 20 },
          bloomsDistribution: { remember: 30, understand: 30, apply: 25, analyze: 15 },
          expectedAnswerStyle: 'Select the correct option.',
          sourceEvidence: ['10 x 1'],
        },
        {
          name: 'Part B',
          instructions: 'Answer any four.',
          questionType: 'shortAnswer',
          count: 4,
          marksPerQuestion: 5,
          totalMarks: 20,
          choicePattern: 'Answer any 4 out of 6.',
          difficultyMix: { easy: 20, moderate: 50, hard: 30 },
          bloomsDistribution: { remember: 20, understand: 30, apply: 30, analyze: 20 },
          expectedAnswerStyle: 'Brief explanatory answer.',
          sourceEvidence: ['4 x 5'],
        },
      ],
      globalInstructions: [],
      constraints: [],
      inferredFrom: ['scheme-document'],
    })));

    const { parseScheme } = await import('../schemeParser.js');
    const result = await parseScheme('University midterm paper pattern');

    expect(result).toEqual([
      { type: 'multipleChoice', count: 10, marksPerQuestion: 1 },
      { type: 'shortAnswer', count: 4, marksPerQuestion: 5 },
    ]);
  });
});
