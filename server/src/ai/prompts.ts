import { QuestionType } from '../validation/schemaMap.js';
import { DIFFICULTY_INSTRUCTIONS } from './difficulty.js';
import { getExemplars } from './exemplarRetrieval.js';
import { Strategy } from './strategyPicker.js';

// ── Context consumed by buildPrompt ──────────────────────────────────────────

export interface PromptContext {
  // Institution
  examBoard?:          string;
  institutionType?:    string;
  // Difficulty & tone
  difficulty?:         'easy' | 'moderate' | 'hard';
  tone?:               'formal-board-exam' | 'neutral' | 'conversational';
  // Exemplar retrieval
  teacherId?:          string;
  bankId?:             string;
  subjectHint?:        string;
  // Batch quality context (main generation path)
  highValueSnippets?:  string[];
  referenceQuestions?: string[];
  bloomsDistribution?: { remember: number; understand: number; apply: number; analyze: number };
  inferenceRatio?:     number;       // percentage 0–30
  // Chapter context
  chapterName?:        string;
  // Repair/regen strategy — for per-slot (count=1) paths only
  strategy?:           Strategy;
  baseQuestion?:       string | null;
  // Legacy retry deduplication hint from runTypeLoop
  dedupeHint?:         string;
}

// ── Shared preamble ───────────────────────────────────────────────────────────
// All {{placeholders}} are filled at call time by renderTemplate().

const PREAMBLE = `You are a senior {{examBoard}}-pattern question paper setter for a \
{{institutionType}} with over a decade of experience writing assessments. \
You are not a summarizer: you never turn a single sentence from the chapter \
into a question by simply blanking out a word or restating it as a query. \
Every question you write is something an experienced teacher would actually \
put in front of students to test genuine understanding, not surface recall \
of exact wording.

SOURCE MATERIAL HIERARCHY
- The teacher-flagged high-value snippets listed below are your PRIMARY \
source — the majority of your questions should originate from ideas found here.
- The full source text is supporting context. Use it to fill gaps, add \
scenario detail, and supply numbers or examples for application questions \
— but do not let it dominate your question selection over what the teacher \
has flagged.

TEACHER-FLAGGED HIGH-VALUE SNIPPETS:
{{highValueSnippets}}

AVOIDING REPETITION OF PAST QUESTIONS
The questions below have appeared before on this chapter and type. Study \
their style — phrasing register, structure, how they frame a scenario — \
but never reuse their wording, their specific scenario, or their specific \
numbers. If a reference question tests a concept you also want to test, \
you must change at least one of: the scenario/context, the given numbers \
or data, the framing angle, or which sub-aspect of the concept is probed. \
A rewrite with only a synonym swapped is not acceptable.

PAST / MODEL PAPER QUESTIONS TO AVOID REPEATING:
{{referenceQuestions}}

BLOOM'S LEVEL DISTRIBUTION
Write questions according to this distribution: {{bloomsDistribution}}
- remember: a single fact directly stated in the source, answerable \
without any reasoning
- understand: the student must recognize or express the idea in their \
own words — a paraphrased form, not the source's exact phrasing
- apply: the student must use the concept in a scenario that is NOT the \
one given in the source material
- analyze: the student must break a concept into parts, compare two \
things, or identify a relationship the source did not state outright
Track your own progress against this distribution as you write — do not \
front-load easy questions and treat the higher levels as an afterthought.

INFERENCE REQUIREMENT
{{inferenceRatio}}% of the questions you write must require the student \
to draw a conclusion, apply a concept to new information, or reason from \
given data — not locate a sentence that already contains the answer.

DIFFICULTY-TO-MARKS CALIBRATION
Each question carries {{marksPerQuestion}} mark(s). Calibrate accordingly:
- 1 mark: direct recall, answerable from one clearly stated fact
- 2 marks: requires understanding — explain, distinguish, or apply a \
concept once
- 3–5 marks: requires application or analysis — combine two ideas, \
reason through a scenario, or justify a conclusion
Never write a 1-mark question that needs multi-step reasoning, and never \
write a high-mark question answerable by recalling one sentence.

THE PASS/EXCELLENCE BALANCE
This paper must let a sincere, averagely-prepared student pass comfortably \
(40–50% range) through the recall and understanding-level questions, while \
genuinely testing whether a student has mastered the material through the \
apply/analyze-level questions needed to score 90%+. Do not make every \
question a trap, and do not make every question trivial.

EXPLANATION FIELD
Every question needs a non-empty "explanation" field. Write it for a \
student who chose a plausible wrong answer and needs to understand their \
mistake: state the correct answer, then explain the specific reasoning \
that gets there, addressing the most likely misconception directly. Do \
not simply restate the question in declarative form.

OUTPUT RULES
- Return ONLY a raw JSON array. No markdown, no code fences, no \
commentary before or after.
- Generate exactly {{count}} questions.
- Do NOT include an "id" field — IDs are assigned by the system after \
generation.
- Every question must match the exact schema below, with no additional \
fields beyond what is shown.`;

// ── Per-type schema + type-specific rules ─────────────────────────────────────

const TYPE_SUFFIX: Record<QuestionType, string> = {

  fillInBlanks: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "question": {
      "hide_text": boolean,
      "text": string,
      "read_text": boolean,
      "image": ""
    },
    "correctAnswer": string,
    "alternatives": [string],
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- The blank must sit at a conceptually meaningful point in the sentence — \
never blank out an article, a connector word, or anything a student \
could guess without knowing the material.
- "alternatives" should contain genuinely acceptable alternate phrasings \
of the correct answer (the way a real marking scheme allows multiple \
equivalent responses), not synonyms of a single word. If the correct \
answer is a concept nameable two ways, include both.
- Do not construct the blank by deleting a single word from a sentence \
copied near-verbatim from the source or past questions — build the \
sentence yourself around the concept.
- The blank must be marked as "_____" (five underscores) in the question text.`,

  multipleChoice: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "question": { "hide_text": boolean, "text": string, "read_text": boolean, "image": "" },
    "options": [
      { "hide_text": boolean, "text": string, "read_text": boolean, "image": "" }
    ],
    "correctAnswer": string,
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- Provide exactly 4 options per question.
- "correctAnswer" must be the exact text of one of the options.
- All distractors must be plausible — a student who hasn't studied well \
should find at least two options attractive.
- Avoid "all of the above" and "none of the above" options.`,

  multiSelect: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "question": { "hide_text": boolean, "text": string, "read_text": boolean, "image": "" },
    "options": [
      { "hide_text": boolean, "text": string, "read_text": boolean, "image": "" }
    ],
    "correctAnswer": [string],
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- At least 2 of the options must be correct, and at least 1 must be \
incorrect — never make every option correct, and never make it a \
disguised single-answer question.
- Distractors follow the same plausibility rule as multipleChoice: a \
student who has only partially understood the material should find at \
least one distractor tempting.
- The explanation must address why EACH correct option qualifies and, at \
minimum, why the most tempting distractor does not.`,

  matchTheFollowing: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "question": { "hide_text": boolean, "text": string, "read_text": boolean, "image": "" },
    "leftItems": [string],
    "rightItems": [string],
    "correctAnswer": [ { "left": string, "right": string } ],
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- Pairings must reflect a genuine conceptual relationship from the \
chapter — term-to-definition, cause-to-effect, example-to-category — \
never an arbitrary or trivially guessable pairing.
- leftItems and rightItems do not need to be the same length (some \
rightItems may have no correct pairing, functioning as distractors) — \
use this deliberately where it strengthens the test rather than \
defaulting to a trivial 1-to-1 mapping every time.
- Explanation should briefly justify the reasoning behind at least the \
least-obvious pairing, not just restate the pairing itself.`,

  reordering: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "question": { "hide_text": boolean, "text": string, "read_text": boolean, "image": "" },
    "items": [string],
    "correctAnswer": [string],
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- Items must have a genuine sequential or logical relationship from the \
chapter (steps in a process, stages of a cycle, order of operations) — \
never an arbitrary list shuffled for the sake of the format.
- Ensure the correct order is unambiguous — if two items could \
legitimately swap positions without changing correctness, the sequence \
isn't well chosen; pick content where ordering genuinely matters.
- Explanation should state WHY the sequence proceeds in that order, not \
just restate the order.`,

  sorting: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "question": { "hide_text": boolean, "text": string, "read_text": boolean, "image": "" },
    "categories": [string],
    "items": [string],
    "correctAnswer": { "<categoryName>": [string] },
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- Category boundaries must be clear enough that each item unambiguously \
belongs to exactly one category — avoid items that could reasonably \
fit two categories, which produces disputes rather than a fair test.
- Use 2-4 categories and enough items (at least 2 per category) that \
sorting requires real understanding, not a 50/50 guess.
- Explanation should note the distinguishing criterion for at least one \
category boundary, especially any item a student might plausibly mis-sort.`,

  trueFalse: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "question": { "hide_text": boolean, "text": string, "read_text": boolean, "image": "" },
    "correctAnswer": boolean,
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- The statement should be a genuine claim requiring evaluation — ideally \
built around a common misconception stated as if it were fact — not a \
trivially obvious truth or falsehood.
- Roughly balance true and false statements across a batch; do not make \
every statement false (or every one true) as a shortcut.
- If the statement is false, the explanation must state what IS correct, \
not just that the statement is wrong.`,

  assertionReason: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "assertion": string,
    "reason": string,
    "options": [
      "Both (A) and (R) are true and (R) is the correct explanation of (A).",
      "Both (A) and (R) are true, but (R) is not the correct explanation of (A).",
      "(A) is true, but (R) is false.",
      "(A) is false, but (R) is true."
    ],
    "correctAnswer": string,
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- "options" must be EXACTLY these 4 strings, in this exact order, every \
time — never rephrase, reorder, or shorten them.
- Assertion and reason must each be an independently checkable true-or- \
false claim about the chapter's content — not two halves of a single \
sentence artificially split apart.
- The hardest and most valuable variant is: both true, but the reason \
does NOT actually explain the assertion (a common trap) — use this \
case deliberately in some questions, not only the straightforward \
both-true-and-explains case.
- Explanation must state the truth value of the assertion, the truth \
value of the reason, AND — if both are true — whether the reason \
genuinely explains the assertion, per {{examBoard}} convention.`,

  shortAnswer: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "question": { "hide_text": boolean, "text": string, "read_text": boolean, "image": "" },
    "wordLimit": { "min": number, "max": number },
    "modelAnswer": string,
    "markingScheme": [ { "point": string, "marks": number } ],
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- Scale wordLimit with marks, matching real board-exam convention: \
roughly 20-30 words for 2-mark questions, 50-80 words for 4-5 mark \
questions.
- markingScheme should mirror genuine partial-credit conventions (e.g. \
"1 mark for any one correct point, 2 marks if both required points are \
present") — 2 to 4 points is typical; avoid oddly granular fractional \
splits that don't correspond to a real grading judgment. The marks \
across all markingScheme points must sum exactly to the question's \
"marks" value.
- modelAnswer must read as genuine exam-quality prose a strong student \
would write — not a bare bullet dump of the markingScheme's point labels.
- The question stem itself should require SOME synthesis or explanation \
in the student's own words, even at 2 marks — this type should not be \
used for a question answerable in 2-3 words (use fillInBlanks instead \
for that).`,
};

// ── Auxiliary instruction blocks ──────────────────────────────────────────────

const TONE_INSTRUCTION: Record<string, string> = {
  'formal-board-exam': 'Use the formal, precise register of a national board examination paper — no casual phrasing, no contractions.',
  'neutral':           'Use clear, plain instructional language.',
  'conversational':    'Use an approachable, conversational tone while staying precise.',
};

// Used only on repair/regen paths (strategy != 'fresh', count = 1).
const STRATEGY_INSTRUCTIONS: Record<Strategy, (base: string | null) => string> = {
  fresh:    ()     => '',
  rephrase: (base) => `A similar question appeared in a previous exam:\n"${base}"\nRephrase this to test the same underlying concept with different wording, a different scenario, or different numerical values. Do NOT change what concept is being tested. Do NOT reuse the original sentence structure.`,
  variant:  (base) => `A previous exam tested this concept:\n"${base}"\nGenerate a NEW question on the same broad concept but from a different angle — a different sub-topic, a different question framing, or applied to a different scenario. Do not reproduce the original question's wording or specific scenario.`,
  reuse:    (base) => `Reformat this exact question to match the schema below, changing nothing about its content, wording, or answer:\n"${base}"`,
};

// ── Template helpers ──────────────────────────────────────────────────────────

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function fmtSnippets(snippets: string[]): string {
  if (snippets.length === 0)
    return '(none — use your own judgement to identify the most exam-worthy ideas from the source text)';
  return snippets.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

function fmtReferenceQuestions(questions: string[]): string {
  if (questions.length === 0) return '(none available for this chapter and type)';
  return questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
}

function fmtBlooms(dist?: PromptContext['bloomsDistribution']): string {
  const d = dist ?? { remember: 30, understand: 30, apply: 25, analyze: 15 };
  return `remember: ${d.remember}%, understand: ${d.understand}%, apply: ${d.apply}%, analyze: ${d.analyze}%`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function buildPrompt(
  type:             QuestionType,
  sourceText:       string,
  count:            number,
  marksPerQuestion: number,
  context:          PromptContext = {},
): Promise<{ system: string; user: string }> {
  const {
    examBoard          = 'CBSE',
    institutionType    = 'school',
    difficulty         = 'moderate',
    tone               = 'formal-board-exam',
    teacherId          = '',
    bankId,
    subjectHint,
    highValueSnippets  = [],
    referenceQuestions = [],
    bloomsDistribution,
    inferenceRatio     = 20,
    chapterName,
    strategy,
    baseQuestion       = null,
    dedupeHint,
  } = context;

  // Exemplars for style guidance (async DB call — skipped when teacherId absent)
  const exemplars = await getExemplars(teacherId, type, { bankId, subjectHint });

  // Legacy dedupeHint (retry loop) merged into referenceQuestions when empty
  const refQs = referenceQuestions.length === 0 && dedupeHint
    ? [dedupeHint]
    : referenceQuestions;

  // ── Assemble system prompt ────────────────────────────────────────────────
  const preamble = renderTemplate(PREAMBLE + '\n\n' + TYPE_SUFFIX[type], {
    examBoard,
    institutionType,
    highValueSnippets:  fmtSnippets(highValueSnippets),
    referenceQuestions: fmtReferenceQuestions(refQs),
    bloomsDistribution: fmtBlooms(bloomsDistribution),
    inferenceRatio:     String(inferenceRatio),
    count:              String(count),
    marksPerQuestion:   String(marksPerQuestion),
  });

  const difficultyBlock = `\nDIFFICULTY GUIDANCE: ${DIFFICULTY_INSTRUCTIONS[difficulty]}`;
  const toneBlock       = `\nTONE: ${TONE_INSTRUCTION[tone]}`;

  const exemplarBlock = exemplars.length > 0
    ? `\n\nSTYLE EXEMPLARS — match register, precision, and framing:\n${exemplars.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
    : '';

  const strategyBlock = strategy && strategy !== 'fresh'
    ? `\n\n${STRATEGY_INSTRUCTIONS[strategy](baseQuestion)}`
    : '';

  // Machine-readable type marker on line 1 — used by test mocks to route
  // the correct question fixture per type without parsing prose content.
  const system = `[QUESTION_TYPE:${type}]\n` + preamble + difficultyBlock + toneBlock + exemplarBlock + strategyBlock;

  // ── Assemble user message ─────────────────────────────────────────────────
  const chapterPrefix = chapterName
    ? `This question set should be drawn from the chapter "${chapterName}" in the source text.\n\n`
    : '';

  const user = `${chapterPrefix}SOURCE TEXT:\n${sourceText}`;

  return { system, user };
}
