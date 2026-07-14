import Groq from 'groq-sdk';
import { withRetry, withTimeout } from '../lib/retry.js';
import { logger } from '../lib/logger.js';

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

const GROQ_MODEL = process.env.GROQ_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct';

const CHUNK_SIZE = 12_000;
const OVERLAP    = 1_500;

const SYSTEM_PROMPT =
  'You scan textbook text for chapter or unit heading titles ' +
  '(e.g. "Chapter 3: Cell Structure", "Unit 5"). List EVERY heading-like ' +
  'title that appears in this excerpt, exactly as written.\n' +
  'If none appear, respond with exactly: NONE\n' +
  'Return one heading per line, nothing else — no numbering, no commentary.';

export async function detectHeadingsViaLLM(
  fullText: string,
): Promise<{ title: string; approxCharOffset: number }[]> {
  logger.info('chapter_detection_tier', { tier: 'llm', textLength: fullText.length });

  const chunks: { text: string; offset: number }[] = [];
  for (let i = 0; i < fullText.length; i += CHUNK_SIZE - OVERLAP) {
    chunks.push({ text: fullText.slice(i, i + CHUNK_SIZE), offset: i });
  }

  const allCandidates: { title: string; approxCharOffset: number }[] = [];
  const fullTextLower = fullText.toLowerCase();

  for (const chunk of chunks) {
    const response = await withRetry(
      () => withTimeout(
        () => getGroq().chat.completions.create({
          model:       GROQ_MODEL,
          messages:    [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: chunk.text },
          ],
          temperature: 0,
        }),
        20_000,
        'chapterDetection',
      ),
      2,
    );

    const raw = (response.choices[0]?.message?.content ?? '').trim();
    if (raw === 'NONE' || raw.length === 0) continue;

    for (const line of raw.split('\n').map((l: string) => l.trim()).filter(Boolean)) {
      // Prefer exact match; fall back to case-insensitive when the LLM normalises
      // the heading's capitalisation (e.g. "CHAPTER 1" → "Chapter 1").
      let idx = fullText.indexOf(line, chunk.offset);
      if (idx === -1) idx = fullTextLower.indexOf(line.toLowerCase(), chunk.offset);
      if (idx !== -1) allCandidates.push({ title: line, approxCharOffset: idx });
    }
  }

  // Dedupe headings found twice because they landed in the overlap region
  const deduped = allCandidates
    .sort((a, b) => a.approxCharOffset - b.approxCharOffset)
    .filter((c, i, arr) => i === 0 || c.approxCharOffset - arr[i - 1].approxCharOffset > 200);

  return deduped;
}
