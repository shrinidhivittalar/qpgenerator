import Groq from 'groq-sdk';
import { withRetry, withTimeout } from '../lib/retry.js';
import { PaperStructure, PaperStructureSchema } from '../types/paperStructure.js';

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// Board-agnostic: the prompt never names CBSE, ICSE, or any specific board.
// All structure comes from whatever the uploaded document says.
const PAPER_STRUCTURE_PROMPT = `You are an exam paper analyst.

Read the uploaded exam pattern, marking scheme, or sample paper.
Extract its EXACT hierarchical structure — only what the document explicitly states.
Do NOT assume any board, standard, or typical pattern. Read only the document.

Return ONLY this raw JSON object (no markdown fences, no explanatory text):
{
  "title": "paper title from the document",
  "totalMarks": <number>,
  "duration": "e.g. 2 Hours",
  "generalInstructions": ["instruction 1", "instruction 2"],
  "sections": [
    {
      "label": "SECTION A",
      "title": "optional section heading if present",
      "instructions": "exact instruction text, e.g. Attempt any 5 of the following 6 questions",
      "totalToAttempt": 5,
      "totalMarks": 5,
      "questions": [
        {
          "number": 1,
          "type": "<see type mapping below>",
          "marks": 1,
          "wordLimit": { "min": 20, "max": 30 },
          "unitRef": "Unit 2: Data Handling",
          "subPartCount": 2
        }
      ]
    }
  ]
}

Field rules:
- "totalToAttempt": include ONLY when the document says "answer any N out of M". The value is N.
- "wordLimit": include ONLY when the document specifies a word count limit for that question type.
- "unitRef": include ONLY when the document links a question/section to a named unit or chapter.
- "subPartCount": include when a single numbered question has multiple sub-parts (a, b, c...). This applies to longAnswer AND to case-based MCQ questions where one stem has multiple MCQ items. Set "marks" to the TOTAL marks for the whole question (all sub-parts), not 1.
- "title" on a section: include only if the document has a section heading beyond just the label.
- "instructions" on a section: include any printed instruction line for that section.

Type mapping — pick the closest match for each question:
- multipleChoice    → MCQ, choose the correct/best option, objective questions with one answer
- multiSelect       → choose all correct options, multiple correct, select all that apply
- fillInBlanks      → fill in the blank, complete the sentence, one-word answer
- trueFalse         → true/false, correct/incorrect, right/wrong statement
- matchTheFollowing → match the following, match columns, pair items
- reordering        → arrange in order, sequence steps, put in order
- sorting           → classify into groups, categorize, sort items
- assertionReason   → assertion-reason, statement A and reason R
- shortAnswer       → short answer (2–5 marks), written explanation
- longAnswer        → long answer (4+ marks), case study, extended question with sub-parts
- figureBased       → diagram-based, figure-based, image-based, picture-based questions; questions that refer to a labelled diagram, chart, or map image provided alongside the question

Additional rules:
- List every numbered question as a separate entry in "questions".
- If a section has mixed types (e.g. Q1 is MCQ, Q2 is fill-in-blank), each gets its own type.
- section.totalMarks = totalToAttempt × marksPerQuestion when a choice exists, OR sum of all question marks.
- paper totalMarks = sum of all section totalMarks.
- If a question type cannot be determined, default to "shortAnswer".`;

function parseJsonObject(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function inferPaperStructure(rawText: string): Promise<PaperStructure> {
  const response = await withRetry(
    () => withTimeout(
      () => getGroq().chat.completions.create({
        model:    process.env.GROQ_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          { role: 'system', content: PAPER_STRUCTURE_PROMPT },
          { role: 'user',   content: `DOCUMENT TEXT:\n${rawText.slice(0, 40000)}` },
        ],
        temperature: 0.1,
      }),
      30_000,
      'paperBlueprintParser',
    ),
    3,
  );

  const content = response.choices[0]?.message?.content ?? '';
  const parsed  = parseJsonObject(content);

  const result = PaperStructureSchema.safeParse(parsed);
  if (result.success) return result.data;

  throw new Error('PAPER_STRUCTURE_PARSE_FAILED');
}
