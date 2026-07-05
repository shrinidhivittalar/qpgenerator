import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('groq-sdk', () => {
  const create = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create } },
    })),
    __mockCreate: create,
  };
});

async function getMockCreate(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('groq-sdk');
  return (mod as any).__mockCreate as ReturnType<typeof vi.fn>;
}

function makeGroqResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

// ── fullText layout ──────────────────────────────────────────────────────────
// CHUNK_SIZE = 12000, OVERLAP = 1500, step = 10500
//
// Chunk 0: offsets [0,    12000)  ← offset 0
// Chunk 1: offsets [10500, 22500) ← offset 10500
// Chunk 2: offsets [21000, 33000) ← offset 21000
// fullText length = 25000 → exactly 3 chunks (loop stops when i = 31500 ≥ 25000)
//
// "Chapter 1" at 11000 → falls in chunk 0 [0..12000) AND chunk 1 [10500..22500)
//   → the overlap re-detection we need to deduplicate.
// "Chapter 2" at 15000 → chunk 1 only [10500..22500)
// "Chapter 3" at 22000 → chunk 2 only [21000..33000)

const C1_OFFSET = 11_000;
const C2_OFFSET = 15_000;
const C3_OFFSET = 22_000;
const TEXT_LEN  = 25_000;

function buildFullText(): string {
  // Lay out padding ('a') around three heading strings at exact offsets
  const insertions = [
    { offset: C1_OFFSET, text: 'Chapter 1' },
    { offset: C2_OFFSET, text: 'Chapter 2' },
    { offset: C3_OFFSET, text: 'Chapter 3' },
  ] as const;

  const parts: string[] = [];
  let pos = 0;
  for (const { offset, text } of insertions) {
    parts.push('a'.repeat(offset - pos));
    parts.push(text);
    pos = offset + text.length;
  }
  parts.push('a'.repeat(TEXT_LEN - pos));
  return parts.join('');
}

const FULL_TEXT = buildFullText();

describe('detectHeadingsViaLLM', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deduplicates overlap re-detections and returns 3 entries in order (TC-LLM-01)', async () => {
    const mockCreate = await getMockCreate();

    // Chunk 0 (offset 0):     reports "Chapter 1" (it's at 11000, within 0..12000)
    mockCreate.mockResolvedValueOnce(makeGroqResponse('Chapter 1'));

    // Chunk 1 (offset 10500): re-reports "Chapter 1" (overlap) plus new "Chapter 2"
    mockCreate.mockResolvedValueOnce(makeGroqResponse('Chapter 1\nChapter 2'));

    // Chunk 2 (offset 21000): reports "Chapter 3"
    mockCreate.mockResolvedValueOnce(makeGroqResponse('Chapter 3'));

    const { detectHeadingsViaLLM } = await import('../chapterLlmDetection.js');
    const result = await detectHeadingsViaLLM(FULL_TEXT);

    // Duplicate "Chapter 1" (both at offset 11000, diff = 0 ≤ 200) is collapsed
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ title: 'Chapter 1', approxCharOffset: C1_OFFSET });
    expect(result[1]).toEqual({ title: 'Chapter 2', approxCharOffset: C2_OFFSET });
    expect(result[2]).toEqual({ title: 'Chapter 3', approxCharOffset: C3_OFFSET });

    // Groq was called once per chunk — 3 calls total
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('returns empty array when all chunks respond NONE (TC-LLM-02)', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(makeGroqResponse('NONE'));

    const { detectHeadingsViaLLM } = await import('../chapterLlmDetection.js');
    const result = await detectHeadingsViaLLM(FULL_TEXT);

    expect(result).toHaveLength(0);
  });

  it('skips headings the LLM hallucinates that do not appear in fullText (TC-LLM-03)', async () => {
    const mockCreate = await getMockCreate();

    // Chunk 0: real heading + hallucinated heading not in text
    mockCreate.mockResolvedValueOnce(makeGroqResponse('Chapter 1\nChapter 99: Quantum Gravity'));
    mockCreate.mockResolvedValue(makeGroqResponse('NONE'));

    const { detectHeadingsViaLLM } = await import('../chapterLlmDetection.js');
    const result = await detectHeadingsViaLLM(FULL_TEXT);

    // "Chapter 99: Quantum Gravity" is not in FULL_TEXT → indexOf returns -1 → excluded
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Chapter 1');
  });

  it('deduplication threshold: two headings more than 200 chars apart are both kept (TC-LLM-04)', async () => {
    const mockCreate = await getMockCreate();

    // Report both headings from chunk 0; they are 4000 chars apart → not deduped
    mockCreate.mockResolvedValueOnce(makeGroqResponse('Chapter 1\nChapter 2'));
    mockCreate.mockResolvedValue(makeGroqResponse('NONE'));

    const { detectHeadingsViaLLM } = await import('../chapterLlmDetection.js');
    const result = await detectHeadingsViaLLM(FULL_TEXT);

    expect(result).toHaveLength(2);
    // C2_OFFSET - C1_OFFSET = 4000 > 200 → both survive dedup
    expect(result[0].approxCharOffset).toBe(C1_OFFSET);
    expect(result[1].approxCharOffset).toBe(C2_OFFSET);
  });
});
