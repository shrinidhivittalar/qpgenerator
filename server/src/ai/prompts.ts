import { QuestionType } from '../validation/schemaMap.js';
import type { PaperQuestion } from '../types/paperStructure.js';
import { DIFFICULTY_INSTRUCTIONS } from './difficulty.js';
import { getExemplars } from './exemplarRetrieval.js';
import { getStyleGuide } from './styleExtractor.js';
import type { StyleGuide } from './styleExtractor.js';
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
  // Blueprint-derived fields (Gap 2 — threaded from scheme's examBlueprint)
  globalInstructions?: string[];     // board-level exam instructions (e.g. "all parts compulsory")
  expectedAnswerStyle?:string;       // e.g. "bullet points", "prose paragraphs", "numbered steps"
  // Repair/regen strategy — for per-slot (count=1) paths only
  strategy?:           Strategy;
  baseQuestion?:       string | null;
  // Legacy retry deduplication hint from runTypeLoop
  dedupeHint?:         string;
  // mapSkill only: teacher-specified places to mark on the map
  mapItems?:           string[];
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

SCENARIO GROUNDING RULE
Application and scenario-based questions must be grounded in the actual \
examples, case studies, and domains present in the source text. If the \
source mentions "loan default prediction", "fraud detection", "traffic \
analysis", "sentiment analysis on reviews", or any other specific context, \
base your application questions on THOSE contexts — do not substitute a \
generic hospital or medical scenario unless the source explicitly uses one. \
Read the source carefully and extract its examples before writing questions.

DOMAIN DIVERSITY RULE
Scan the source for all the distinct domains and applications it mentions. \
Distribute questions so that no single domain accounts for more than 2 \
questions in a batch of 10 or more. If the source text contains [SECTION N] \
markers, treat each section as a separate pool and generate approximately \
equal numbers of questions from each section. A student reading the full \
batch must encounter multiple genuinely different real-world contexts, each \
traceable to a specific part of the source text.

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
fields beyond what is shown.

MATH / LATEX ENCODING RULES (CRITICAL — violations corrupt the output)
- Wrap EVERY mathematical expression in dollar-sign delimiters: $...$. \
Examples: "$x^2$", "$\\frac{a}{b}$", "$\\sqrt{b^2 - 4ac}$".
- Inside a JSON string, ALL LaTeX backslash commands MUST use a double \
backslash so the JSON parser sees one backslash. Examples: \
"$\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$", "$\\times$", "$\\theta$", \
"$\\alpha + \\beta$". A single backslash before a letter is a JSON \
escape sequence and will corrupt the command (\\t becomes a tab, \
\\n a newline, etc.).
- Plain numbers and single-letter variables in running text do not need \
dollar signs. Use them only when you write a formula, expression, \
equation, or symbol that a student would expect to see typeset.
- NEVER use $ as a currency symbol. Write monetary amounts as plain \
numbers (e.g. 8000, 500) or use the appropriate symbol (₹, USD). \
Using $8000 will break the math renderer and corrupt the question text.`;

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
- NEVER use "all of the above", "none of the above", "both A and B", or \
any other meta-option. Every option must be a standalone, independently \
evaluable claim. If you find yourself wanting to write "all of the above", \
rewrite the question entirely with four genuinely distinct options.`,

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
- question.text MUST be a declarative statement — a sentence that asserts \
something as fact. It must NOT end with a question mark and must NOT be \
phrased as "Which…?", "What…?", "How…?", or any other interrogative form. \
Wrong: "Which stage involves data collection?" \
Correct: "Data collection is the first stage of the AI Project Cycle."
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
      "Both A and R are correct, and R is the correct explanation of A",
      "Both A and R are correct, but R is not the correct explanation of A",
      "A is correct, but R is incorrect",
      "A is incorrect, but R is correct"
    ],
    "correctAnswer": string,
    "explanation": string
  }
]

TYPE-SPECIFIC RULES
- "options" must be EXACTLY these 4 strings, in this exact order, every \
time — never rephrase, reorder, shorten, or add punctuation to them.
- "correctAnswer" must be one of those 4 strings verbatim.
- Assertion and reason must each be an independently checkable true-or- \
false claim about the chapter's content — not two halves of a single \
sentence artificially split apart.
- The hardest and most valuable variant is: both correct, but the reason \
does NOT actually explain the assertion (a common trap) — use this \
case deliberately in some questions, not only the straightforward \
both-correct-and-explains case.
- Explanation must state whether the assertion is correct, whether the \
reason is correct, AND — if both are correct — whether the reason \
genuinely explains the assertion.`,

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

  longAnswer: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "explanation": string,
    "preamble": string,
    "parts": [
      {
        "label": string,
        "marks": number,
        "question": string,
        "modelAnswer": string
      }
    ]
  }
]

Return a JSON array containing exactly 1 long-answer question object (count is always 1 for this type).

TYPE-SPECIFIC RULES
- "preamble": Write a realistic scenario or case study paragraph based on \
the source material. Introduce a context, entity, or situation that all \
sub-part questions can reference. Invent a fresh real-world scenario \
rather than copying text verbatim. 3-5 sentences.
- "parts": Each sub-part is a question arising from the preamble scenario. \
Labels are "a", "b", "c", etc. Marks per part must sum exactly to the \
total "marks" value.
- Sub-part questions should escalate in cognitive demand: start with \
recall or comprehension, end with application or analysis.
- "modelAnswer" for each part must be exam-quality prose matching its \
marks: ~20-30 words per mark.
- "explanation" is a teacher note explaining the conceptual linkage \
between the preamble and the sub-parts — not a restatement of the answers.`,

  mapSkill: `
SCHEMA FOR THIS TYPE:
[
  {
    "marks": number,
    "explanation": string,
    "instruction": string,
    "items": [string, string, ...],
    "totalToAttempt": number,
    "modelAnswer": [string, string, ...]
  }
]

TYPE-SPECIFIC RULES
- "instruction": Write the formal exam instruction line, e.g. \
"Locate and label any five of the following places on the outline map of India \
provided to you." Adapt to the actual subject and number of items to attempt.
- "items": {{mapItemsBlock}}
- "totalToAttempt": The number of items the student must mark — equal to the \
marks value (1 mark per item). Must be less than or equal to items.length.
- "modelAnswer": One short descriptive sentence per item (in the same order as \
"items") saying WHERE the feature is located — its state/region, coast, \
direction, or any identifier that confirms correct placement on the map. \
Must have exactly one entry for EVERY item listed.
- "explanation": A teacher note on which geographic/spatial skills this question \
tests — not a restatement of the answers.`,

  figureBased: `
SCHEMA FOR THIS TYPE:
{
  "marks": number,
  "questionText": string,
  "subType": "mcq" | "shortAnswer",
  "options": [string],
  "correctAnswer": string,
  "useLatex": boolean,
  "explanation": string
}

NOTE: figureBased questions are generated via the vision path (image + text), not \
this text-only prompt. This entry exists only for type-system completeness. \
If you reach this prompt for a figureBased question, treat it as a shortAnswer \
about the most likely figure described in the source text.

TYPE-SPECIFIC RULES
- "questionText": The question about the figure. For math/science, use $LaTeX$ \
syntax for formulas: $x^2 + y^2 = r^2$. Set "useLatex": true if any math is used.
- "subType": "mcq" for 1-2 mark questions; "shortAnswer" for 3+ marks.
- "options": Exactly 4 strings for mcq; omit entirely for shortAnswer.
- "correctAnswer": Exact option text (mcq) or model answer prose (shortAnswer).
- "explanation": Why the answer is correct, addressing the most likely mistake.`,
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
    examBoard           = 'CBSE',
    institutionType     = 'school',
    difficulty          = 'moderate',
    tone                = 'formal-board-exam',
    teacherId           = '',
    bankId,
    subjectHint,
    highValueSnippets   = [],
    referenceQuestions  = [],
    bloomsDistribution,
    inferenceRatio      = 20,
    chapterName,
    globalInstructions  = [],
    expectedAnswerStyle,
    strategy,
    baseQuestion        = null,
    dedupeHint,
    mapItems,
  } = context;

  // Both DB calls run in parallel — skipped when teacherId absent
  const [exemplars, styleGuide] = await Promise.all([
    getExemplars(teacherId, type, { bankId, subjectHint }),
    getStyleGuide(teacherId, bankId),
  ]);

  // Legacy dedupeHint (retry loop) merged into referenceQuestions when empty
  const refQs = referenceQuestions.length === 0 && dedupeHint
    ? [dedupeHint]
    : referenceQuestions;

  // ── Assemble system prompt ────────────────────────────────────────────────
  const mapItemsBlock = mapItems && mapItems.length > 0
    ? `Use EXACTLY these places provided by the teacher:\n${mapItems.map((item, i) => `  ${i + 1}. ${item}`).join('\n')}\nCopy each entry into "items" exactly as written. Do not add, remove, or rename any item.`
    : 'List 6–8 distinct geographical features, places, rivers, cities, regions, or landmarks drawn from the source text. Use only entities that actually appear in or are strongly implied by the source. Each item must be identifiable on a map.';

  const preamble = renderTemplate(PREAMBLE + '\n\n' + TYPE_SUFFIX[type], {
    examBoard,
    institutionType,
    highValueSnippets:  fmtSnippets(highValueSnippets),
    referenceQuestions: fmtReferenceQuestions(refQs),
    bloomsDistribution: fmtBlooms(bloomsDistribution),
    inferenceRatio:     String(inferenceRatio),
    count:              String(count),
    marksPerQuestion:   String(marksPerQuestion),
    mapItemsBlock,
  });

  const difficultyBlock = `\nDIFFICULTY GUIDANCE: ${DIFFICULTY_INSTRUCTIONS[difficulty]}`;
  const toneBlock       = `\nTONE: ${TONE_INSTRUCTION[tone]}`;

  const globalInstructionsBlock = globalInstructions.length > 0
    ? `\n\nEXAM-LEVEL INSTRUCTIONS (official board/institution requirements — follow exactly):\n` +
      globalInstructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')
    : '';

  const expectedAnswerStyleBlock = expectedAnswerStyle
    ? `\n\nEXPECTED ANSWER STYLE: ${expectedAnswerStyle}`
    : '';

  const styleGuideBlock = styleGuide
    ? `\n\nBOARD STYLE GUIDE — your output must match these patterns exactly:\n` +
      `Exam: ${styleGuide.examBoard} | Subject: ${styleGuide.subject}\n` +
      `Command words used: ${styleGuide.commandWords.join(', ')}\n` +
      `Tone: ${styleGuide.toneDescriptor}\n` +
      `Prefer: ${styleGuide.preferPatterns.join(' | ')}\n` +
      `Avoid: ${styleGuide.avoidPatterns.join(' | ')}\n` +
      `Cognitive level: ${styleGuide.bloomsSummary}\n` +
      `Answer style: ${styleGuide.answerStyle}`
    : '';

  const exemplarBlock = exemplars.length > 0
    ? `\n\nSTYLE EXEMPLARS — match register, precision, and framing:\n${exemplars.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
    : '';

  const strategyBlock = strategy && strategy !== 'fresh'
    ? `\n\n${STRATEGY_INSTRUCTIONS[strategy](baseQuestion)}`
    : '';

  // Machine-readable type marker on line 1 — used by test mocks to route
  // the correct question fixture per type without parsing prose content.
  const system = `[QUESTION_TYPE:${type}]\n` + preamble + difficultyBlock + toneBlock + globalInstructionsBlock + expectedAnswerStyleBlock + styleGuideBlock + exemplarBlock + strategyBlock;

  // ── Assemble user message ─────────────────────────────────────────────────
  const chapterPrefix = chapterName
    ? `This question set should be drawn from the chapter "${chapterName}" in the source text.\n\n`
    : '';

  const sectionCount = (sourceText.match(/^\[SECTION \d+\]/gm) ?? []).length;
  const sectionHint = sectionCount > 1
    ? `The source below is divided into ${sectionCount} sections. Generate approximately ${Math.round(count / sectionCount)} questions from each section to ensure broad topic coverage.\n\n`
    : '';

  const user = `${chapterPrefix}${sectionHint}SOURCE TEXT:\n${sourceText}`;

  return { system, user };
}

// ── Long-answer prompt (paper generation path) ────────────────────────────────
// Returns a single JSON object, not an array. Used by paperGenerator.ts.

export interface LongAnswerPromptContext {
  tone?:               'formal-board-exam' | 'neutral' | 'conversational';
  chapterName?:        string;
  marks:               number;
  subPartCount:        number;
  // Board / style context (Gap 4 — paper mode style awareness)
  examBoard?:          string;
  bloomsDistribution?: { remember: number; understand: number; apply: number; analyze: number };
  globalInstructions?: string[];
  expectedAnswerStyle?:string;
  styleGuide?:         StyleGuide | null;
}

const LONG_ANSWER_SYSTEM = `You are a senior {{examBoard}}question paper setter.

Generate a long-answer question based on the provided source text.
The question consists of a preamble (scenario/case) and sub-part questions.

Return ONLY a raw JSON object (no markdown, no array wrapper):
{
  "marks": <total marks>,
  "explanation": "<teacher note on conceptual linkage>",
  "preamble": "<3-5 sentence scenario paragraph based on the source>",
  "parts": [
    {
      "label": "a",
      "marks": <marks for this part>,
      "question": "<question text>",
      "modelAnswer": "<exam-quality model answer>"
    }
  ]
}

Rules:
- "preamble": Invent a fresh real-world scenario that draws from the source \
material's concepts. Do NOT copy text verbatim. The scenario should set up \
context for all sub-part questions.
- "parts": Generate exactly {{subPartCount}} sub-parts labelled a, b, c, ... \
Sub-part marks MUST sum to exactly {{totalMarks}}. Distribute as: {{partMarkDistrib}}.
- Sub-parts should escalate in cognitive demand: recall first, application/analysis last.
- "modelAnswer" length: ~20-30 words per mark for that sub-part.
- "explanation": A teacher-facing note, not a student answer — explain \
why these sub-parts test the key learning outcomes of the source.
- TONE: {{tone}}{{styleBlock}}`;

export function buildLongAnswerPrompt(
  sourceText: string,
  ctx:        LongAnswerPromptContext,
): { system: string; user: string } {
  const tone = TONE_INSTRUCTION[ctx.tone ?? 'formal-board-exam'] ?? TONE_INSTRUCTION['formal-board-exam'];

  // Build explicit per-part mark distribution so the LLM can't misread the total.
  const base    = Math.floor(ctx.marks / ctx.subPartCount);
  const rem     = ctx.marks % ctx.subPartCount;
  const distrib = Array.from({ length: ctx.subPartCount }, (_, i) =>
    `${String.fromCharCode(97 + i)}) ${base + (i < rem ? 1 : 0)} mark${base + (i < rem ? 1 : 0) !== 1 ? 's' : ''}`,
  ).join(', ');

  // Board / style context blocks
  const examBoardPrefix = ctx.examBoard ? `${ctx.examBoard}-pattern ` : '';

  let styleBlock = '';
  if (ctx.bloomsDistribution) {
    const d = ctx.bloomsDistribution;
    styleBlock += `\nBLOOM'S DISTRIBUTION: remember ${d.remember}%, understand ${d.understand}%, apply ${d.apply}%, analyze ${d.analyze}%. Sub-parts should reflect this spread.`;
  }
  if (ctx.globalInstructions && ctx.globalInstructions.length > 0) {
    styleBlock += `\nEXAM INSTRUCTIONS: ${ctx.globalInstructions.join(' | ')}`;
  }
  if (ctx.expectedAnswerStyle) {
    styleBlock += `\nEXPECTED ANSWER STYLE: ${ctx.expectedAnswerStyle}`;
  }
  if (ctx.styleGuide) {
    const sg = ctx.styleGuide;
    styleBlock += `\nBOARD STYLE: Use command words from this set: ${sg.commandWords.join(', ')}.`;
    if (sg.preferPatterns.length > 0)
      styleBlock += ` Prefer: ${sg.preferPatterns.slice(0, 3).join(' | ')}.`;
    if (sg.avoidPatterns.length > 0)
      styleBlock += ` Avoid: ${sg.avoidPatterns.slice(0, 3).join(' | ')}.`;
    styleBlock += `\nANSWER STYLE: ${sg.answerStyle}`;
  }

  const system = `[QUESTION_TYPE:longAnswer]\n` + renderTemplate(LONG_ANSWER_SYSTEM, {
    examBoard:       examBoardPrefix,
    subPartCount:    String(ctx.subPartCount),
    totalMarks:      String(ctx.marks),
    partMarkDistrib: distrib,
    tone,
    styleBlock,
  });

  const chapterPrefix = ctx.chapterName
    ? `This question should be drawn from the chapter "${ctx.chapterName}" in the source text.\n\n`
    : '';

  const user = `${chapterPrefix}SOURCE TEXT:\n${sourceText}`;

  return { system, user };
}
