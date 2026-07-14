import Groq from 'groq-sdk';
import { withRetry, withTimeout } from '../lib/retry.js';
import { schemaMap, type QuestionType } from '../validation/schemaMap.js';

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// figureBased and mapSkill questions depend on images/maps — not storable as text exemplars.
const BANK_EXCLUDED = new Set<string>(['figureBased', 'mapSkill']);
const VALID_TYPES = Object.keys(schemaMap).filter(t => !BANK_EXCLUDED.has(t)) as QuestionType[];

export interface ParsedQuestion {
  questionType: QuestionType;
  rawText:      string;
}

const TYPE_MAPPINGS = `
  multipleChoice    → single-answer MCQ with options (A)(B)(C)(D)
  multiSelect       → "select all that apply", multiple correct answers
  fillInBlanks      → complete the sentence / fill in the blank
  trueFalse         → true or false / correct or incorrect
  matchTheFollowing → match column A to column B
  reordering        → arrange / sequence steps in order
  sorting           → classify / categorise items into groups
  assertionReason   → Assertion (A) and Reason (R) questions
  shortAnswer       → short written answer (2–4 lines): define / state / write / give one example
  longAnswer        → extended written answer: explain / describe / prove / derive / discuss`;

// Like parseAiJsonArray but recovers complete objects even when the array
// is truncated mid-stream (LLM hits max_tokens before closing ']').
function parseAiJsonArrayPartial(raw: string): unknown[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // Fast path: valid complete JSON
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Recovery path: extract every complete {...} object from the string.
  // Walks char-by-char tracking depth and string state, collects each
  // top-level object that closes cleanly.
  const results: unknown[] = [];
  let i = cleaned.indexOf('{');
  while (i !== -1 && i < cleaned.length) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    let j = i;
    for (; j < cleaned.length; j++) {
      const c = cleaned[j];
      if (escape)         { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"')      { inStr = !inStr; continue; }
      if (inStr)          continue;
      if (c === '{')      depth++;
      else if (c === '}') { if (--depth === 0) break; }
    }
    if (depth === 0) {
      try { results.push(JSON.parse(cleaned.slice(i, j + 1))); } catch {}
    }
    i = cleaned.indexOf('{', j + 1);
  }
  return results;
}

function buildParsePrompt(): string {
  const typeList = VALID_TYPES.join(' | ');
  return `You parse exam question papers into individual questions.

For each distinct question found, output exactly one JSON object:
  "questionType": one of: ${typeList}
  "rawText": the complete question text (for MCQ and multiSelect include all option labels and text verbatim)

TYPE MAPPING:${TYPE_MAPPINGS}

EXCLUDE: section headings, instructions, total marks lines, page numbers, sub-headings that are not questions.

Return ONLY a raw JSON array. No markdown fences, no commentary.`;
}

export async function parsePaperIntoQuestions(text: string): Promise<ParsedQuestion[]> {
  const response = await withRetry(
    () => withTimeout(
      () => getGroq().chat.completions.create({
        model: process.env.GROQ_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          { role: 'system', content: buildParsePrompt() },
          { role: 'user',   content: text.slice(0, 8000) },
        ],
        temperature: 0.1,
        max_tokens: 8192,
      }),
      30_000,
      'paperParser',
    ),
    3,
  );

  const raw    = response.choices[0]?.message?.content ?? '';
  const parsed = parseAiJsonArrayPartial(raw);

  return (parsed as any[]).filter(
    (item): item is ParsedQuestion =>
      (VALID_TYPES as string[]).includes(item?.questionType) &&
      typeof item?.rawText === 'string' &&
      item.rawText.trim().length > 0,
  );
}
