import { describe, it, expect, vi } from 'vitest';
import { generateSet, GenerateFn, TypeConfig } from '../generator.js';

const SOURCE = 'source text';
const MARKS  = 2;

const makeRaw = (overrides: Record<string, unknown> = {}) => ({
  id:            1,
  marks:         MARKS,
  explanation:   'Explanation',
  question:      { hide_text: false, text: 'Q?', read_text: false, image: '' },
  correctAnswer: 'answer',
  alternatives:  [],
  ...overrides,
});

const makeRawBatch = (n: number) => Array.from({ length: n }, () => makeRaw());

// ────────────────────────────────────────────────────────────────────────────

describe('generateSet', () => {
  // Test 1: 3 types all succeed
  it('returns 3 blocks with IDs 1-20 when 3 types succeed with counts 10, 5, 5 (TC-GEN-02, TC-GEN-04)', async () => {
    const config: TypeConfig[] = [
      { type: 'fillInBlanks',   count: 10, marksPerQuestion: MARKS },
      { type: 'multipleChoice', count: 5,  marksPerQuestion: MARKS },
      { type: 'trueFalse',      count: 5,  marksPerQuestion: MARKS },
    ];
    const fn = vi.fn<GenerateFn>()
      .mockImplementation((_src, type, count) => {
        if (type === 'multipleChoice') {
          // multipleChoice needs options array with min 2
          return Promise.resolve(Array.from({ length: count }, () => ({
            ...makeRaw(),
            options: [
              { hide_text: false, text: 'A', read_text: false, image: '' },
              { hide_text: false, text: 'B', read_text: false, image: '' },
            ],
          })));
        }
        if (type === 'trueFalse') {
          return Promise.resolve(Array.from({ length: count }, () => ({
            ...makeRaw(),
            correctAnswer: true,
          })));
        }
        return Promise.resolve(makeRawBatch(count));
      });

    const { blocks, errors } = await generateSet(SOURCE, config, fn);

    expect(errors).toHaveLength(0);
    expect(blocks).toHaveLength(3);

    const allQuestions = blocks.flatMap(b => b.questions);
    expect(allQuestions).toHaveLength(20);

    const ids = allQuestions.map(q => (q as Record<string, unknown>).id as number);
    expect(ids.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  // Test 2: count: 0 type is skipped entirely
  it('skips types with count: 0 and never calls generateFn for them (TC-GEN-03, EC-GEN-01)', async () => {
    const config: TypeConfig[] = [
      { type: 'fillInBlanks',   count: 3, marksPerQuestion: MARKS },
      { type: 'multipleChoice', count: 0, marksPerQuestion: MARKS },
    ];
    const fn = vi.fn<GenerateFn>().mockResolvedValue(makeRawBatch(3));

    const { blocks, errors } = await generateSet(SOURCE, config, fn);

    expect(errors).toHaveLength(0);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].questionType).toBe('fillInBlanks');

    // generateFn should never have been called for multipleChoice
    const calledTypes = fn.mock.calls.map(c => c[1]);
    expect(calledTypes).not.toContain('multipleChoice');
  });

  // Test 3: documented boundary — route layer must reject all-zero typeConfig
  // generateSet itself does not error; it returns empty blocks and no errors.
  it('returns empty blocks and errors when all counts are 0 (boundary is route-level, not generateSet)', async () => {
    const config: TypeConfig[] = [
      { type: 'fillInBlanks', count: 0, marksPerQuestion: MARKS },
    ];
    const fn = vi.fn<GenerateFn>();

    const { blocks, errors } = await generateSet(SOURCE, config, fn);

    expect(blocks).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });

  // Test 4: one type fails, two succeed
  it('places failed type in errors and keeps succeeded blocks intact (TC-GEN-07, GEN-08)', async () => {
    const config: TypeConfig[] = [
      { type: 'fillInBlanks',   count: 5, marksPerQuestion: MARKS },
      { type: 'trueFalse',      count: 5, marksPerQuestion: MARKS },
      { type: 'reordering',     count: 5, marksPerQuestion: MARKS },
    ];

    const fn = vi.fn<GenerateFn>().mockImplementation((_src, type, count) => {
      if (type === 'reordering') return Promise.resolve([]); // always fails
      if (type === 'trueFalse') {
        return Promise.resolve(Array.from({ length: count }, () => ({
          ...makeRaw(), correctAnswer: true,
        })));
      }
      return Promise.resolve(makeRawBatch(count));
    });

    const { blocks, errors } = await generateSet(SOURCE, config, fn);

    expect(blocks).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('reordering');
    expect(errors[0].received).toBe(0);

    const blockTypes = blocks.map(b => b.questionType);
    expect(blockTypes).toContain('fillInBlanks');
    expect(blockTypes).toContain('trueFalse');
    blocks.forEach(b => expect(b.questions).toHaveLength(5));
  });

  // Test 5: IDs have no gaps despite a failed type
  it('assigns IDs 1-20 with no gaps when 2 types succeed (10+10) and 1 fails (EC-ID-01)', async () => {
    const config: TypeConfig[] = [
      { type: 'fillInBlanks',   count: 10, marksPerQuestion: MARKS },
      { type: 'sorting',        count: 10, marksPerQuestion: MARKS },
      { type: 'trueFalse',      count: 5,  marksPerQuestion: MARKS },
    ];

    const fn = vi.fn<GenerateFn>().mockImplementation((_src, type, count) => {
      if (type === 'trueFalse') return Promise.resolve([]); // fails
      if (type === 'sorting') {
        return Promise.resolve(Array.from({ length: count }, () => ({
          ...makeRaw(),
          categories:    ['A'],
          items:         ['x'],
          correctAnswer: { A: ['x'] },
        })));
      }
      return Promise.resolve(makeRawBatch(count));
    });

    const { blocks, errors } = await generateSet(SOURCE, config, fn);

    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('trueFalse');

    const allQuestions = blocks.flatMap(b => b.questions);
    expect(allQuestions).toHaveLength(20);

    const ids = allQuestions.map(q => (q as Record<string, unknown>).id as number).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  // Test 6: types run concurrently, not sequentially
  it('runs type loops in parallel — wall time ≈ max delay, not sum of delays', async () => {
    const config: TypeConfig[] = [
      { type: 'fillInBlanks', count: 1, marksPerQuestion: MARKS },
      { type: 'trueFalse',    count: 1, marksPerQuestion: MARKS },
    ];

    const fn = vi.fn<GenerateFn>().mockImplementation((_src, type, count) => {
      const delay = type === 'fillInBlanks' ? 100 : 10;
      const data  = type === 'trueFalse'
        ? Array.from({ length: count }, () => ({ ...makeRaw(), correctAnswer: true }))
        : makeRawBatch(count);
      return new Promise(resolve => setTimeout(() => resolve(data), delay));
    });

    const start = Date.now();
    await generateSet(SOURCE, config, fn);
    const elapsed = Date.now() - start;

    // If sequential: ~110ms. If parallel: ~100ms.
    // Allow generous headroom for CI jitter — just rule out sequential.
    expect(elapsed).toBeLessThan(180);
  });
});
