import { describe, it, expect, vi } from 'vitest';
import { runTypeLoop, GenerateFn } from '../generator.js';

const SOURCE = 'some source text';
const TYPE   = 'fillInBlanks' as const;
const MARKS  = 2;

// Builds a valid fillInBlanks question payload as the AI would return it
const makeRaw = (overrides: Record<string, unknown> = {}) => ({
  id:            1,
  marks:         MARKS,
  explanation:   'Explanation',
  question:      { hide_text: false, text: 'Q?', read_text: false, image: '' },
  correctAnswer: 'answer',
  alternatives:  [],
  ...overrides,
});

const makeRawBatch = (n: number, overrides: Record<string, unknown> = {}) =>
  Array.from({ length: n }, () => makeRaw(overrides));

// ────────────────────────────────────────────────────────────────────────────

describe('runTypeLoop', () => {
  // Test 1: exact count on first attempt
  it('returns success when mock returns exactly targetCount on attempt 1; generateFn called once (EC-GEN-06)', async () => {
    const target = 5;
    const fn = vi.fn<GenerateFn>().mockResolvedValueOnce(makeRawBatch(target));

    const result = await runTypeLoop(SOURCE, TYPE, target, MARKS, fn);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.questions).toHaveLength(target);
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // Test 2: excess trimmed to exactly targetCount
  it('trims excess — returns exactly targetCount when mock returns more (EC-GEN-05)', async () => {
    const target = 5;
    const fn = vi.fn<GenerateFn>().mockResolvedValueOnce(makeRawBatch(target + 3));

    const result = await runTypeLoop(SOURCE, TYPE, target, MARKS, fn);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.questions).toHaveLength(target);
    }
  });

  // Test 3: shortfall on attempt 1, completed on attempt 2
  it('retries with shortfall count; second call receives the remaining count, not targetCount again', async () => {
    const target  = 10;
    const partial = 6;
    const fn = vi.fn<GenerateFn>()
      .mockResolvedValueOnce(makeRawBatch(partial))          // attempt 1: 6
      .mockResolvedValueOnce(makeRawBatch(target - partial)); // attempt 2: 4

    const result = await runTypeLoop(SOURCE, TYPE, target, MARKS, fn);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.questions).toHaveLength(target);
    }
    expect(fn).toHaveBeenCalledTimes(2);
    // second call must request only the shortfall (4), not the full target (10)
    expect(fn.mock.calls[1][2]).toBe(target - partial);
  });

  // Test 4: 0 returned on every attempt → failed
  it('returns failed with received: 0 after 3 attempts each returning nothing (EC-GEN-07, GEN-06)', async () => {
    const target = 5;
    const fn = vi.fn<GenerateFn>().mockResolvedValue([]);

    const result = await runTypeLoop(SOURCE, TYPE, target, MARKS, fn);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.received).toBe(0);
      expect(result.requested).toBe(target);
    }
    expect(fn).toHaveBeenCalledTimes(3);
  });

  // Test 5: partial across 3 attempts, never reaches target
  it('returns failed with exact partial count when never reaching target after 3 attempts (EC-GEN-04)', async () => {
    const target = 10;
    const fn = vi.fn<GenerateFn>()
      .mockResolvedValueOnce(makeRawBatch(2))
      .mockResolvedValueOnce(makeRawBatch(2))
      .mockResolvedValueOnce(makeRawBatch(2));

    const result = await runTypeLoop(SOURCE, TYPE, target, MARKS, fn);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.received).toBe(6);
      expect(result.requested).toBe(target);
    }
  });

  // Test 6: throws on attempt 1, succeeds on attempt 2
  it('recovers from thrown error on attempt 1 and succeeds on attempt 2 (EC-GEN-08)', async () => {
    const target = 4;
    const fn = vi.fn<GenerateFn>()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makeRawBatch(target));

    const result = await runTypeLoop(SOURCE, TYPE, target, MARKS, fn);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.questions).toHaveLength(target);
    }
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Test 7: schema-invalid questions don't count toward collected
  it('schema-invalid questions are dropped and trigger another attempt for the shortfall (EC-GEN-10)', async () => {
    const target  = 10;
    const invalid = makeRaw({ explanation: '' }); // fails schema
    const fn = vi.fn<GenerateFn>()
      // attempt 1: 10 raw but 3 are invalid → only 7 collected
      .mockResolvedValueOnce([
        ...makeRawBatch(7),
        invalid, invalid, invalid,
      ])
      // attempt 2: fills remaining 3
      .mockResolvedValueOnce(makeRawBatch(3));

    const result = await runTypeLoop(SOURCE, TYPE, target, MARKS, fn);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.questions).toHaveLength(target);
    }
    expect(fn).toHaveBeenCalledTimes(2);
    // second call must ask for exactly 3 (the shortfall)
    expect(fn.mock.calls[1][2]).toBe(3);
  });

  // Test 8: targetCount = 1 — minimum meaningful count
  it('works correctly with targetCount = 1 — no off-by-one (EC-GEN-03)', async () => {
    const fn = vi.fn<GenerateFn>().mockResolvedValueOnce(makeRawBatch(1));

    const result = await runTypeLoop(SOURCE, TYPE, 1, MARKS, fn);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.questions).toHaveLength(1);
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // Test 9: marks are always server-assigned, AI value is ignored
  it('overwrites marks with marksPerQuestion on every returned question, regardless of AI value', async () => {
    const target       = 3;
    const aiMarks      = 99; // AI returns wrong value
    const serverMarks  = 5;
    const fn = vi.fn<GenerateFn>().mockResolvedValueOnce(makeRawBatch(target, { marks: aiMarks }));

    const result = await runTypeLoop(SOURCE, TYPE, target, serverMarks, fn);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      for (const q of result.questions) {
        expect((q as Record<string, unknown>).marks).toBe(serverMarks);
      }
    }
  });
});
