import Groq from 'groq-sdk';
import { withRetry, withTimeout } from '../lib/retry.js';

function parseAiJsonArray(raw: string): unknown[] {
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

const VALID_TYPES = [
  'fillInBlanks', 'multipleChoice', 'multiSelect', 'matchTheFollowing',
  'reordering', 'sorting', 'trueFalse', 'shortAnswer', 'longAnswer',
] as const;

type ValidType = typeof VALID_TYPES[number];

export interface ParsedQuestion {
  questionType: ValidType;
  rawText:      string;
  marks:        number | null;
  confidence:   number;
}

const PAPER_PARSE_PROMPT = `You parse exam question papers into individual questions.

For each distinct question found, output exactly one JSON object with these fields:
  "questionType": one of: fillInBlanks | multipleChoice | multiSelect | matchTheFollowing | reordering | sorting | trueFalse | shortAnswer | longAnswer
  "rawText": the complete question text (for MCQ include all option labels and text verbatim)
  "marks": number of marks for this question (integer), or null if not determinable. Look for inline cues like "[1 Mark]", "(2 marks)", "1 mark each", section headers like "Section A — 1 mark each".
  "confidence": float 0.0–1.0 — how confident you are this is a complete, well-formed, standalone question. Low confidence if: truncated, garbled text, clearly a heading/instruction, OCR artifacts present.

TYPE MAPPING:
  multipleChoice   → single-answer MCQ with options (A)(B)(C)(D)
  multiSelect      → "select all that apply", multiple correct answers
  fillInBlanks     → complete the sentence / fill in the blank
  trueFalse        → true or false / correct or incorrect
  matchTheFollowing → match column A to column B
  reordering       → arrange / sequence steps in order
  sorting          → classify / categorise items into groups
  shortAnswer      → answer in 2–3 sentences or a few lines
  longAnswer       → answer in a paragraph or more

EXCLUDE: section headings, general instructions, total marks lines, page numbers, sub-headings that are not questions.

Return ONLY a raw JSON array. No markdown fences, no commentary.`;

export async function parsePaperIntoQuestions(text: string): Promise<ParsedQuestion[]> {
  const response = await withRetry(
    () => withTimeout(
      () => getGroq().chat.completions.create({
        model: process.env.GROQ_MODEL ?? 'llama-4-maverick-17b-128e-instruct',
        messages: [
          { role: 'system', content: PAPER_PARSE_PROMPT },
          { role: 'user',   content: text.slice(0, 8000) },
        ],
        temperature: 0.1,
      }),
      30_000,
      'paperParser',
    ),
    3,
  );

  const raw    = response.choices[0]?.message?.content ?? '';
  const parsed = parseAiJsonArray(raw);

  return (parsed as any[]).filter(
    (item): item is ParsedQuestion =>
      VALID_TYPES.includes(item?.questionType) &&
      typeof item?.rawText === 'string' &&
      item.rawText.trim().length > 0 &&
      typeof item?.confidence === 'number',
  ).map(item => ({
    ...item,
    marks:      typeof item.marks === 'number' ? item.marks : null,
    confidence: Math.min(1, Math.max(0, item.confidence)),
  }));
}
