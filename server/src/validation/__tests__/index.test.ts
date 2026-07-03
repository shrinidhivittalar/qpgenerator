import { describe, it, expect } from 'vitest';
import { validateQuestionBlock, assignGlobalIds, validateExportSet, ValidationError } from '../index.js';

const makeQuestion = (overrides: Record<string, unknown> = {}) => ({
  id:            1,
  marks:         2,
  explanation:   'Explanation here',
  question:      { hide_text: false, text: 'What is X?', read_text: false, image: '' },
  correctAnswer: 'answer',
  alternatives:  [],
  ...overrides,
});

// ────────────────────────────────────────────────────────────────────────────
// assignGlobalIds
// ────────────────────────────────────────────────────────────────────────────
describe('assignGlobalIds', () => {
  it('assigns sequential IDs 1-15 across 2 blocks (10 + 5 questions) in block order (EC-ID-02, EC-ID-03)', () => {
    const block1 = { questionType: 'fillInBlanks', questions: Array.from({ length: 10 }, () => ({})) };
    const block2 = { questionType: 'trueFalse',    questions: Array.from({ length: 5  }, () => ({})) };

    assignGlobalIds([block1, block2]);

    const ids1 = block1.questions.map(q => (q as Record<string, unknown>).id);
    const ids2 = block2.questions.map(q => (q as Record<string, unknown>).id);

    expect(ids1).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ids2).toEqual([11, 12, 13, 14, 15]);
  });

  it('is a no-op on an empty blocks array — does not throw', () => {
    expect(() => assignGlobalIds([])).not.toThrow();
  });

  it('is a no-op on blocks with empty questions arrays', () => {
    const block = { questionType: 'trueFalse', questions: [] };
    assignGlobalIds([block]);
    expect(block.questions).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// validateQuestionBlock
// ────────────────────────────────────────────────────────────────────────────
describe('validateQuestionBlock', () => {
  it('returns valid.length === 6 and invalidCount === 2 when 2 of 8 questions have empty explanation (EC-GEN-10)', () => {
    const questions = [
      ...Array.from({ length: 6 }, () => makeQuestion()),
      makeQuestion({ explanation: '' }),
      makeQuestion({ explanation: '' }),
    ];

    const { valid, invalidCount } = validateQuestionBlock('fillInBlanks', questions);

    expect(valid).toHaveLength(6);
    expect(invalidCount).toBe(2);
  });

  it('passes question with unknown extra field and strips it from the result (EC-GEN-09)', () => {
    const raw = makeQuestion({ unknownAiField: 'should be stripped' });
    const { valid, invalidCount } = validateQuestionBlock('fillInBlanks', [raw]);

    expect(invalidCount).toBe(0);
    expect(valid).toHaveLength(1);
    expect((valid[0] as Record<string, unknown>).unknownAiField).toBeUndefined();
  });

  it('returns all valid when every question is well-formed', () => {
    const questions = Array.from({ length: 4 }, () => makeQuestion());
    const { valid, invalidCount } = validateQuestionBlock('fillInBlanks', questions);

    expect(valid).toHaveLength(4);
    expect(invalidCount).toBe(0);
  });

  it('returns empty valid array when all questions are invalid', () => {
    const questions = [
      makeQuestion({ explanation: '' }),
      makeQuestion({ marks: -1 }),
    ];
    const { valid, invalidCount } = validateQuestionBlock('fillInBlanks', questions);

    expect(valid).toHaveLength(0);
    expect(invalidCount).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// validateExportSet (stub)
// ────────────────────────────────────────────────────────────────────────────
describe('validateExportSet', () => {
  it('throws ValidationError when no blocks have status "success"', () => {
    expect(() => validateExportSet([
      { questionType: 'fillInBlanks', questions: [], status: 'failed' },
    ])).toThrow(ValidationError);
  });

  it('throws ValidationError on empty blocks array', () => {
    expect(() => validateExportSet([])).toThrow(ValidationError);
  });

  it('does not throw when at least one block has status "success"', () => {
    expect(() => validateExportSet([
      { questionType: 'fillInBlanks', questions: [makeQuestion()], status: 'success' },
    ])).not.toThrow();
  });
});
