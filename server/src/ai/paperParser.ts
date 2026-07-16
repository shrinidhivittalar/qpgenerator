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
  'reordering', 'sorting', 'trueFalse',
] as const;

type ValidType = typeof VALID_TYPES[number];

export interface ParsedQuestion {
  questionType: ValidType;
  rawText:      string;
}

const PAPER_PARSE_PROMPT = `You parse exam question papers into individual questions.

For each distinct question found, output exactly one JSON object:
  "questionType": one of: fillInBlanks | multipleChoice | multiSelect | matchTheFollowing | reordering | sorting | trueFalse
  "rawText": the complete question text (for MCQ and multiSelect include all option labels and text verbatim)

TYPE MAPPING:
  multipleChoice   → single-answer MCQ with options (A)(B)(C)(D)
  multiSelect      → "select all that apply", multiple correct answers
  fillInBlanks     → complete the sentence / fill in the blank
  trueFalse        → true or false / correct or incorrect
  matchTheFollowing → match column A to column B
  reordering       → arrange / sequence steps in order
  sorting          → classify / categorise items into groups

EXCLUDE: section headings, instructions, total marks lines, page numbers, sub-headings that are not questions.

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
      item.rawText.trim().length > 0,
  );
}
