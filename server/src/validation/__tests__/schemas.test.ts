import { describe, it, expect } from 'vitest';
import { FillInBlanksSchema }      from '../schemas/fillInBlanks.js';
import { MultipleChoiceSchema }    from '../schemas/multipleChoice.js';
import { MultiSelectSchema }       from '../schemas/multiSelect.js';
import { MatchTheFollowingSchema } from '../schemas/matchTheFollowing.js';
import { ReorderingSchema }        from '../schemas/reordering.js';
import { SortingSchema }           from '../schemas/sorting.js';
import { TrueFalseSchema }         from '../schemas/trueFalse.js';

const baseQuestion = {
  id:          1,
  marks:       2,
  explanation: 'Some explanation',
  question:    { hide_text: false, text: 'What is X?', read_text: false, image: '' },
};

// ────────────────────────────────────────────────────────────────────────────
// fillInBlanks
// ────────────────────────────────────────────────────────────────────────────
describe('FillInBlanksSchema', () => {
  it('accepts a valid fillInBlanks question', () => {
    const result = FillInBlanksSchema.safeParse({
      ...baseQuestion,
      correctAnswer: 'photosynthesis',
      alternatives:  ['photosythesis', 'photo synthesis'],
    });
    expect(result.success).toBe(true);
  });

  // EC-GEN-14: missing explanation fails
  it('rejects a question with missing explanation', () => {
    const result = FillInBlanksSchema.safeParse({
      ...baseQuestion,
      explanation:   '',
      correctAnswer: 'photosynthesis',
      alternatives:  [],
    });
    expect(result.success).toBe(false);
  });

  // ADR-011: unknown fields are silently dropped, not rejected
  it('silently drops unknown fields (strip mode)', () => {
    const result = FillInBlanksSchema.safeParse({
      ...baseQuestion,
      correctAnswer: 'photosynthesis',
      alternatives:  [],
      unknownAiField: 'should be dropped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownAiField).toBeUndefined();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// multipleChoice
// ────────────────────────────────────────────────────────────────────────────
describe('MultipleChoiceSchema', () => {
  const option = { hide_text: false, text: 'Option A', read_text: false, image: '' };

  it('accepts a valid multipleChoice question', () => {
    const result = MultipleChoiceSchema.safeParse({
      ...baseQuestion,
      options:       [option, { ...option, text: 'Option B' }],
      correctAnswer: 'Option A',
    });
    expect(result.success).toBe(true);
  });

  // EC-GEN-15: fewer than 2 options must fail
  it('rejects options array with fewer than 2 items (EC-GEN-15)', () => {
    const result = MultipleChoiceSchema.safeParse({
      ...baseQuestion,
      options:       [option],
      correctAnswer: 'Option A',
    });
    expect(result.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// multiSelect
// ────────────────────────────────────────────────────────────────────────────
describe('MultiSelectSchema', () => {
  const option = { hide_text: false, text: 'Option A', read_text: false, image: '' };

  it('accepts a valid multiSelect question', () => {
    const result = MultiSelectSchema.safeParse({
      ...baseQuestion,
      options:       [option, { ...option, text: 'Option B' }],
      correctAnswer: ['Option A', 'Option B'],
    });
    expect(result.success).toBe(true);
  });

  // EC-GEN-17: empty correctAnswer array must fail
  it('rejects empty correctAnswer array (EC-GEN-17)', () => {
    const result = MultiSelectSchema.safeParse({
      ...baseQuestion,
      options:       [option],
      correctAnswer: [],
    });
    expect(result.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// matchTheFollowing
// ────────────────────────────────────────────────────────────────────────────
describe('MatchTheFollowingSchema', () => {
  it('accepts a valid matchTheFollowing question', () => {
    const result = MatchTheFollowingSchema.safeParse({
      ...baseQuestion,
      leftItems:     ['A', 'B'],
      rightItems:    ['1', '2'],
      correctAnswer: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }],
    });
    expect(result.success).toBe(true);
  });

  // EC-GEN-18: mismatched leftItems/rightItems lengths are VALID — no length constraint
  it('accepts mismatched leftItems/rightItems lengths (EC-GEN-18)', () => {
    const result = MatchTheFollowingSchema.safeParse({
      ...baseQuestion,
      leftItems:     ['A', 'B', 'C'],
      rightItems:    ['1', '2'],
      correctAnswer: [{ left: 'A', right: '1' }],
    });
    expect(result.success).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// reordering
// ────────────────────────────────────────────────────────────────────────────
describe('ReorderingSchema', () => {
  it('accepts a valid reordering question', () => {
    const result = ReorderingSchema.safeParse({
      ...baseQuestion,
      items:         ['step 3', 'step 1', 'step 2'],
      correctAnswer: ['step 1', 'step 2', 'step 3'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a question with non-positive marks', () => {
    const result = ReorderingSchema.safeParse({
      ...baseQuestion,
      marks:         0,
      items:         ['step 1'],
      correctAnswer: ['step 1'],
    });
    expect(result.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sorting
// ────────────────────────────────────────────────────────────────────────────
describe('SortingSchema', () => {
  it('accepts a valid sorting question', () => {
    const result = SortingSchema.safeParse({
      ...baseQuestion,
      categories:    ['Mammals', 'Reptiles'],
      items:         ['Dog', 'Snake', 'Cat', 'Lizard'],
      correctAnswer: { Mammals: ['Dog', 'Cat'], Reptiles: ['Snake', 'Lizard'] },
    });
    expect(result.success).toBe(true);
  });

  // EC-GEN-19: correctAnswer keys not cross-checked against categories — still valid
  it('accepts correctAnswer keys not present in categories (EC-GEN-19)', () => {
    const result = SortingSchema.safeParse({
      ...baseQuestion,
      categories:    ['Mammals'],
      items:         ['Dog', 'Snake'],
      correctAnswer: { Mammals: ['Dog'], Reptiles: ['Snake'] },
    });
    expect(result.success).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// trueFalse
// ────────────────────────────────────────────────────────────────────────────
describe('TrueFalseSchema', () => {
  it('accepts a valid trueFalse question with boolean correctAnswer', () => {
    const result = TrueFalseSchema.safeParse({
      ...baseQuestion,
      correctAnswer: true,
    });
    expect(result.success).toBe(true);
  });

  // EC-GEN-20: string "true" must fail — never coerce
  it('rejects string "true" as correctAnswer (EC-GEN-20)', () => {
    const result = TrueFalseSchema.safeParse({
      ...baseQuestion,
      correctAnswer: 'true',
    });
    expect(result.success).toBe(false);
  });
});
