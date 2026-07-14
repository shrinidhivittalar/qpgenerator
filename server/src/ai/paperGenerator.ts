import Groq from 'groq-sdk';
import { withRetry, withTimeout } from '../lib/retry.js';
import { groqAcquire } from '../lib/groqLimiter.js';
import { buildLongAnswerPrompt } from './prompts.js';
import { getStyleGuide } from './styleExtractor.js';
import type { StyleGuide } from './styleExtractor.js';
import { parseAiJsonArray } from './generator.js';
import { schemaMap, QuestionType } from '../validation/schemaMap.js';
import { LongAnswerSchema } from '../validation/schemas/longAnswer.js';
import { FigureBasedSchema } from '../validation/schemas/figureBased.js';
import { createLimiter } from '../lib/concurrency.js';
import { logger } from '../lib/logger.js';
import type { PaperStructure, PaperQuestion, PaperSection } from '../types/paperStructure.js';
import type { ChapterInput } from './slotAllocator.js';

export interface FigureImage {
  _id?:      string;   // ChapterFigurePage._id — set when sourced from the DB
  base64:    string;
  mimeType:  'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  filename?: string;
}

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

const GROQ_MODEL = process.env.GROQ_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct';

const VISION_MODEL = process.env.OPENROUTER_MODEL ?? 'qwen/qwen2.5-vl-72b-instruct';

async function callVisionModel(system: string, base64: string, mimeType: string, userText: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0.7,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: userText },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? '';
}

// Returns { system, user } for mapSkill — items are teacher-specified so the
// model must NOT look to the source text for place names; it only writes
// geography-accurate modelAnswer descriptions for each provided item.
export function buildMapSkillPrompt(marks: number, mapItems?: string[], count = 1): { system: string; user: string } {
  const places = (mapItems && mapItems.length >= 2)
    ? mapItems
    : ['Place 1', 'Place 2', 'Place 3', 'Place 4', 'Place 5', 'Place 6', 'Place 7'];
  const itemsJson = JSON.stringify(places);
  const attempt   = Math.min(marks, places.length);

  const system = `[QUESTION_TYPE:mapSkill]
You are a geography question paper setter. The teacher has pre-specified the following map items — you MUST use them exactly as given.

ITEMS (copy into "items" array verbatim, in the same order):
${places.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}

Return ONLY a raw JSON array containing exactly ${count} object${count > 1 ? 's' : ''}. No markdown, no prose, no commentary before or after the JSON.

Schema (repeat ${count} time${count > 1 ? 's' : ''} in the array):
[{
  "marks": ${marks},
  "instruction": "Locate and label any ${attempt} of the following on the outline map provided.",
  "items": ${itemsJson},
  "totalToAttempt": ${attempt},
  "modelAnswer": [one concise sentence per item describing WHERE it is located — its region, state, coast, direction, or any identifier that confirms correct placement. Same order as items.],
  "explanation": "one sentence summarising what geographical knowledge this question tests"
}]

RULES:
- "items" MUST be copied from the list above, character-for-character.
- "totalToAttempt" MUST equal ${attempt}.
- "modelAnswer" MUST have exactly ${places.length} entries, one per item.
- Each modelAnswer entry: "${places[0]} — <where it is located on a map>".
- Do NOT return an empty array. Do NOT add extra fields.`;

  const user = `Generate ${count} mapSkill question${count > 1 ? 's' : ''} using the items listed in the system prompt.`;
  return { system, user };
}

// Carries board and style context down to every slot-level prompt.
// Fetched once per generatePaper call and reused across all slots.
interface SlotStyleContext {
  styleGuide:          StyleGuide | null;
  examBoard:           string;
  bloomsDistribution?: { remember: number; understand: number; apply: number; analyze: number };
  globalInstructions?: string[];
  expectedAnswerStyle?:string;
}

function buildSlotSystemPrompt(
  type:    QuestionType,
  marks:   number,
  tone:    string,
  style?:  SlotStyleContext,
): string {
  const toneNote = tone === 'formal-board-exam' ? 'Formal board-exam register.' : 'Clear, plain language.';
  const m = marks;
  const q = `{"hide_text":false,"text":"question text here","read_text":false,"image":""}`;
  const opt = (t: string) => `{"hide_text":false,"text":"${t}","read_text":false,"image":""}`;

  const schemaMap: Partial<Record<QuestionType, string>> = {
    multipleChoice:   `[{"marks":${m},"question":${q},"options":[${opt('option A')},${opt('option B')},${opt('option C')},${opt('option D')}],"correctAnswer":"option A","explanation":"why A is correct"}]`,
    trueFalse:        `[{"marks":${m},"question":{"hide_text":false,"text":"A declarative statement (not a question).","read_text":false,"image":""},"correctAnswer":true,"explanation":"why this is true"}]`,
    fillInBlanks:     `[{"marks":${m},"question":{"hide_text":false,"text":"The _____ is used to...","read_text":false,"image":""},"correctAnswer":"answer word","alternatives":["alternate phrasing"],"explanation":"why this answer"}]`,
    assertionReason:  `[{"marks":${m},"assertion":"Assertion statement.","reason":"Reason statement.","options":["Both A and R are correct, and R is the correct explanation of A","Both A and R are correct, but R is not the correct explanation of A","A is correct, but R is incorrect","A is incorrect, but R is correct"],"correctAnswer":"Both A and R are correct, and R is the correct explanation of A","explanation":"why"}]`,
    shortAnswer:      `[{"marks":${m},"question":${q},"wordLimit":{"min":${m*20},"max":${m*40}},"modelAnswer":"model answer prose","markingScheme":[{"point":"key point","marks":${m}}],"explanation":"marking guidance"}]`,
    multiSelect:      `[{"marks":${m},"question":${q},"options":[${opt('option A')},${opt('option B')},${opt('option C')},${opt('option D')}],"correctAnswer":["option A","option B"],"explanation":"why A and B are correct"}]`,
    matchTheFollowing:`[{"marks":${m},"question":${q},"leftItems":["Term 1","Term 2","Term 3"],"rightItems":["Def 1","Def 2","Def 3","Distractor"],"correctAnswer":[{"left":"Term 1","right":"Def 1"},{"left":"Term 2","right":"Def 2"},{"left":"Term 3","right":"Def 3"}],"explanation":"why these pairs"}]`,
    reordering:       `[{"marks":${m},"question":${q},"items":["Step C","Step A","Step B"],"correctAnswer":["Step A","Step B","Step C"],"explanation":"why this order"}]`,
    sorting:          `[{"marks":${m},"question":${q},"categories":["Cat A","Cat B"],"items":["item1","item2","item3","item4"],"correctAnswer":{"Cat A":["item1","item3"],"Cat B":["item2","item4"]},"explanation":"why"}]`,
    // figureBased is generated via the vision path — this schema is shown only as a
    // fallback reference if the text path is ever called for this type.
    figureBased:      `{"marks":${m},"questionText":"question about the figure","subType":"mcq","options":["option A","option B","option C","option D"],"correctAnswer":"option A","useLatex":false,"explanation":"why A is correct"}`,
  };

  const schema = schemaMap[type] ?? schemaMap.shortAnswer!;

  const mcqStemNote = (type === 'multipleChoice' || type === 'multiSelect')
    ? `\nSTEM RULE (mandatory): The question.text MUST be an incomplete statement or a "Which of the following..." prompt that one of the four options directly answers.
BAD stems (forbidden): "What is X?", "Explain X", "How does X work?", "What are the benefits of X?"
GOOD stems: "Which of the following best describes X?", "The primary purpose of X is ___.", "X is characterised by which of the following?", "In the context of Y, which statement about X is correct?"
Each option MUST be a short, plausible completion or answer — not a placeholder like "option A".
CRITICAL: correctAnswer MUST be copied CHARACTER-FOR-CHARACTER from one of the options[i].text values. Do NOT use "A", "B", "C" or a paraphrase — use the exact option text string.`
    : '';

  // Board / style context blocks — appended when a StyleContext is supplied
  const examBoardLabel = style?.examBoard ? `senior ${style.examBoard}-pattern ` : '';

  let styleLines = '';
  if (style?.styleGuide) {
    const sg = style.styleGuide;
    styleLines += `\nBOARD STYLE: Use command words from this set: ${sg.commandWords.join(', ')}.`;
    const marksKey = String(marks);
    if (sg.marksFormat[marksKey])
      styleLines += ` For ${marks}-mark questions: ${sg.marksFormat[marksKey]}`;
    if (sg.preferPatterns.length > 0)
      styleLines += `\nPREFER patterns: ${sg.preferPatterns.slice(0, 3).join(' | ')}`;
    if (sg.avoidPatterns.length > 0)
      styleLines += `\nAVOID patterns: ${sg.avoidPatterns.slice(0, 3).join(' | ')}`;
  }
  if (style?.bloomsDistribution) {
    const d = style.bloomsDistribution;
    const dominant = (Object.entries(d) as [string, number][]).sort((a, b) => b[1] - a[1])[0];
    styleLines += `\nCOGNITIVE LEVEL: Target ${dominant[0]} level (${dominant[1]}% of questions in this section).`;
  }
  if (style?.globalInstructions && style.globalInstructions.length > 0) {
    styleLines += `\nEXAM INSTRUCTIONS: ${style.globalInstructions.slice(0, 3).join(' | ')}`;
  }
  if (style?.expectedAnswerStyle) {
    styleLines += `\nEXPECTED ANSWER STYLE: ${style.expectedAnswerStyle}`;
  }

  return `[QUESTION_TYPE:${type}]
You are a ${examBoardLabel}question paper setter. Generate exactly 1 ${type} question worth ${m} mark(s) from the source text.
${toneNote} Ground the question in concepts and examples actually present in the source. Do not invent hospital scenarios.${styleLines}
${mcqStemNote}
Return ONLY a raw JSON array — no markdown, no extra fields, no commentary. Use this exact schema:
${schema}`;
}

// Parse single JSON object (long answer returns one object, not an array)
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

// Pick the best chapter for a question slot.
// Priority: exact chapterId → unitRef substring match → round-robin by globalIndex.
function pickChapter(
  question:    PaperQuestion,
  chapters:    ChapterInput[],
  globalIndex: number,
): ChapterInput {
  if (chapters.length === 0) throw new Error('No chapters provided');

  if (question.chapterId) {
    const match = chapters.find(c => c.id === question.chapterId);
    if (match) return match;
  }

  if (question.unitRef) {
    const ref = question.unitRef.toLowerCase();
    const match = chapters.find(c =>
      c.name.toLowerCase().includes(ref) || ref.includes(c.name.toLowerCase()),
    );
    if (match) return match;
  }

  return chapters[globalIndex % chapters.length];
}

// Pick a text excerpt window for the question.
// Uses totalWindows (= total slot count) so each slot gets a unique segment of the source.
// Window size is 2000 chars so a single figure caption or table can't fill the whole window.
function pickExcerpt(sourceText: string, offsetIndex: number, windowSize = 2000, totalWindows = 4): string {
  if (sourceText.length <= windowSize) return sourceText;
  const segments = Math.max(totalWindows, 4);
  const step     = Math.floor(sourceText.length / segments);
  const start    = (offsetIndex * step) % (sourceText.length - windowSize);
  return sourceText.slice(start, start + windowSize);
}

// Carries board and style context into figure (vision) prompts.
// Kept separate from SlotStyleContext so it can be exported to generator.ts.
export interface FigureStyleHint {
  examBoard?:  string;
  styleGuide?: StyleGuide | null;
}

// Vision-based generation: sends the figure image + instruction to the multimodal model.
// The LLM returns a FigureBasedSchema-compatible JSON object (without imageBase64/imageMimeType).
// We inject those fields server-side after the call.
async function generateFigureQuestion(
  question:   PaperQuestion,
  figure:     FigureImage,
  options:    PaperGenerateOptions,
  requestId?: string,
  style?:     FigureStyleHint,
): Promise<object | null> {
  const m       = question.marks;
  const subType = m >= 3 ? 'shortAnswer' : 'mcq';

  // Dev mock — set GROQ_MOCK_FIGURE=true in server/.env to skip the real vision
  // call during development (works regardless of which vision backend is active).
  // Returns a realistic LaTeX-bearing fixture so the full pipeline
  // (validation → storage → rendering → Word export) can be tested
  // without consuming any API tokens.
  if (process.env.GROQ_MOCK_FIGURE === 'true') {
    const isMcq = subType === 'mcq';
    return {
      marks:         m,
      imageBase64:   figure.base64,
      imageMimeType: figure.mimeType,
      ...(figure._id ? { figurePageId: figure._id } : {}),
      questionText:  isMcq
        ? `In the given figure, if $\\angle A + \\angle B = 90°$, then $\\angle A$ and $\\angle B$ are called:`
        : `The figure shows a right triangle with legs $a$ and $b$ and hypotenuse $c$. Using the Pythagorean theorem $a^2 + b^2 = c^2$, find $c$ when $a = 3$ cm and $b = 4$ cm. Show your working.`,
      subType,
      ...(isMcq ? {
        options: [
          'Complementary angles',
          'Supplementary angles',
          'Vertically opposite angles',
          'Co-interior angles',
        ],
        correctAnswer: 'Complementary angles',
      } : {
        correctAnswer: `$c = \\sqrt{a^2 + b^2} = \\sqrt{9 + 16} = \\sqrt{25} = 5$ cm. The hypotenuse is 5 cm.`,
      }),
      useLatex:    true,
      explanation: isMcq
        ? 'Two angles that sum to $90°$ are complementary by definition. Supplementary angles sum to $180°$.'
        : 'Substituting into $a^2 + b^2 = c^2$: $3^2 + 4^2 = 9 + 16 = 25$, so $c = \\sqrt{25} = 5$ cm.',
    };
  }

  // Board / style context for the figure prompt
  const examBoardLabel = style?.examBoard ? `senior ${style.examBoard}-pattern ` : '';
  let figureStyleLines = '';
  if (style?.styleGuide) {
    const sg = style.styleGuide;
    if (sg.commandWords.length > 0)
      figureStyleLines += `\nBOARD STYLE: Use command words from this set: ${sg.commandWords.join(', ')}.`;
    if (sg.preferPatterns.length > 0)
      figureStyleLines += ` Preferred phrasing patterns: ${sg.preferPatterns.slice(0, 2).join(' | ')}.`;
    if (subType === 'shortAnswer' && sg.answerStyle)
      figureStyleLines += `\nANSWER STYLE: ${sg.answerStyle}`;
  }

  const system = `[QUESTION_TYPE:figureBased]
You are a ${examBoardLabel}question paper setter. Analyze the provided figure carefully.

FIRST — decide if this figure is suitable for an exam question:
SKIP if the figure is any of: QR code, barcode, decorative border, ladder/scaffold diagram, page number, watermark, logo, header/footer graphic, purely textual image with no diagram, photograph of a person, or any non-mathematical non-scientific decorative element.
ACCEPT if the figure contains: geometry (triangles, circles, polygons, angles), graphs (coordinate axes, functions, bar/pie charts, histograms), scientific diagrams (ray diagrams, electric circuits, force diagrams, biology diagrams), number lines, statistical tables with visual layout, or any labeled mathematical/scientific illustration.

If SKIP: return exactly {"skip": true}
If ACCEPT: generate exactly 1 question worth ${m} mark${m !== 1 ? 's' : ''}.${figureStyleLines}

Return ONLY a raw JSON object — no markdown, no array wrapper, no extra fields:
{
  "questionText": "question stem referencing the figure (use $LaTeX$ for math, e.g. $x^2$, $\\\\frac{a}{b}$)",
  "subType": "${subType}",
  ${subType === 'mcq'
    ? '"options": ["Option A", "Option B", "Option C", "Option D"],'
    : ''}
  "correctAnswer": "${subType === 'mcq' ? 'exact text of the correct option' : 'model answer prose'}",
  "useLatex": false,
  "explanation": "why the answer is correct, addressing the most likely wrong interpretation",
  "marks": ${m}
}

Rules:
- Base the question ONLY on what is visible in the figure — do not invent unlabeled parts.
- For math/science: use $...$ for inline LaTeX. Set "useLatex": true if ANY math appears.
- subType "${subType}" is mandatory — do not change it.
${subType === 'mcq'
  ? '- Exactly 4 options. correctAnswer must be character-for-character identical to one option text.\n- All distractors must be plausible given the figure content.'
  : '- Omit "options" entirely.\n- correctAnswer is exam-quality model answer prose.'}
- GEOMETRY FIRST: If the figure contains any geometric elements (angles, triangles, circles, polygons, parallel lines, coordinate axes, congruence/similarity marks), ALWAYS base the question on the geometric property — angle calculation, area, perimeter, Pythagoras, similarity ratio, arc length, etc.
- Base the question ONLY on what is visible in the figure — do not invent unlabeled parts.
- For math/science: use $...$ for inline LaTeX. Set "useLatex": true if ANY math appears.
- explanation must state the specific reason, not merely restate the answer.`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await withRetry(
        () => withTimeout(
          () => callVisionModel(
            system,
            figure.base64,
            figure.mimeType,
            `Generate a ${m}-mark ${subType} question about this figure.`,
          ),
          45_000,
          `paperGen:figureBased:q${question.number}`,
        ),
        2,
      );
      const parsed = parseJsonObject(raw);

      if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).skip === true) {
        logger.info('paper_gen_figure_skipped', { requestId, questionNumber: question.number, reason: 'non-educational figure' });
        return null;
      }

      const result = FigureBasedSchema.safeParse(parsed);

      if (result.success) {
        return {
          ...result.data,
          imageBase64:   figure.base64,
          imageMimeType: figure.mimeType,
          ...(figure._id ? { figurePageId: figure._id } : {}),
          marks:         m,
        };
      }

      logger.info('paper_gen_validation_fail', {
        requestId,
        questionNumber: question.number,
        type: 'figureBased',
        attempt,
        issues: result.error.issues.slice(0, 2).map(i => i.message),
      });
    } catch (err) {
      logger.warn('paper_gen_figure_error', {
        requestId,
        questionNumber: question.number,
        type: 'figureBased',
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return null;
}

async function generateObjectiveQuestion(
  question:    PaperQuestion,
  chapter:     ChapterInput,
  excerpt:     string,
  options:     PaperGenerateOptions,
  requestId?:  string,
  style?:      SlotStyleContext,
): Promise<object | null> {
  const type = question.type as QuestionType;
  const schema = schemaMap[type];
  if (!schema) return null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { system, user } = type === 'mapSkill'
        ? buildMapSkillPrompt(question.marks, question.mapItems)
        : { system: buildSlotSystemPrompt(type, question.marks, options.tone ?? 'formal-board-exam', style), user: `SOURCE TEXT:\n${excerpt}` };

      await groqAcquire();
      const response = await withRetry(
        () => withTimeout(
          () => getGroq().chat.completions.create({
            model:    GROQ_MODEL,
            messages: [
              { role: 'system', content: system },
              { role: 'user',   content: user },
            ],
            temperature: 0.7,
          }),
          30_000,
          `paperGen:${type}:q${question.number}`,
        ),
        2,
      );

      const raw = response.choices[0]?.message?.content ?? '';
      const arr = parseAiJsonArray(raw);
      if (arr.length === 0) continue;

      const parsed = schema.safeParse(arr[0]);
      if (parsed.success) {
        return { ...parsed.data, marks: question.marks };
      }

      logger.info('paper_gen_validation_fail', {
        requestId,
        questionNumber: question.number,
        type,
        attempt,
        issues: parsed.error.issues.slice(0, 2).map(i => i.message),
      });
    } catch (err) {
      logger.warn('paper_gen_slot_error', {
        requestId,
        questionNumber: question.number,
        type,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return null;
}

async function generateLongAnswerQuestion(
  question:    PaperQuestion,
  chapter:     ChapterInput,
  excerpt:     string,
  options:     PaperGenerateOptions,
  requestId?:  string,
  style?:      SlotStyleContext,
): Promise<object | null> {
  const subPartCount = question.subPartCount ?? 2;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { system, user } = buildLongAnswerPrompt(excerpt, {
        tone:                options.tone,
        chapterName:         chapter.name,
        marks:               question.marks,
        subPartCount,
        examBoard:           style?.examBoard,
        bloomsDistribution:  style?.bloomsDistribution,
        globalInstructions:  style?.globalInstructions,
        expectedAnswerStyle: style?.expectedAnswerStyle,
        styleGuide:          style?.styleGuide,
      });

      await groqAcquire();
      const response = await withRetry(
        () => withTimeout(
          () => getGroq().chat.completions.create({
            model:    GROQ_MODEL,
            messages: [
              { role: 'system', content: system },
              { role: 'user',   content: user },
            ],
            temperature: 0.6,
          }),
          45_000,
          `paperGen:longAnswer:q${question.number}`,
        ),
        2,
      );

      const raw    = response.choices[0]?.message?.content ?? '';
      const parsed = parseJsonObject(raw);
      const result = LongAnswerSchema.safeParse(parsed);

      if (result.success) {
        return { ...result.data, marks: question.marks };
      }

      logger.info('paper_gen_validation_fail', {
        requestId,
        questionNumber: question.number,
        type: 'longAnswer',
        attempt,
        issues: result.error.issues.slice(0, 2).map(i => i.message),
      });
    } catch (err) {
      logger.warn('paper_gen_slot_error', {
        requestId,
        questionNumber: question.number,
        type: 'longAnswer',
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return null;
}

export interface PaperGenerateOptions {
  teacherId:           string;
  tone?:               'formal-board-exam' | 'neutral' | 'conversational';
  requestId?:          string;
  // Board / style context (Gap 4 — passed from route via scheme blueprint)
  examBoard?:          string;
  bankId?:             string;
  bloomsDistribution?: { remember: number; understand: number; apply: number; analyze: number };
  globalInstructions?: string[];
  expectedAnswerStyle?:string;
}

// Thin wrapper used by generateTypeViaSlots (non-paper mode) to call the vision
// API without needing to import PaperQuestion or PaperGenerateOptions directly.
export async function generateFigureQuestionForSlot(
  marks:         number,
  base64:        string,
  mimeType:      FigureImage['mimeType'],
  teacherId:     string,
  tone?:         PaperGenerateOptions['tone'],
  figurePageId?: string,
  style?:        FigureStyleHint,
): Promise<object | null> {
  const question = { number: 1, type: 'figureBased' as const, marks, generated: null };
  const figure:   FigureImage = { base64, mimeType, ...(figurePageId ? { _id: figurePageId } : {}) };
  const options:  PaperGenerateOptions = { teacherId, tone };
  return generateFigureQuestion(question, figure, options, undefined, style);
}

export interface PaperGenerateResult {
  structure:     PaperStructure;
  totalSlots:    number;
  filledSlots:   number;
  failedSlots:   number;
  tokensEstimate: number;
}

// Round-robin picker for figure images across figureBased slots.
function pickFigure(figures: FigureImage[], index: number): FigureImage | null {
  if (figures.length === 0) return null;
  return figures[index % figures.length];
}

// Deep-clone the structure and fill each question slot in parallel
// (max 2 concurrent Groq calls via limiter).
export async function generatePaper(
  structure:    PaperStructure,
  chapters:     ChapterInput[],
  options:      PaperGenerateOptions,
  figureImages: FigureImage[] = [],
): Promise<PaperGenerateResult> {
  if (chapters.length === 0) throw new Error('At least one chapter is required.');

  // Fetch StyleGuide once for the whole paper so every slot gets board patterns.
  // getStyleGuide returns null when no bankId or no guide exists — slots degrade
  // gracefully (style blocks are simply omitted from the prompt).
  const styleGuide = await getStyleGuide(options.teacherId, options.bankId).catch(() => null);
  const slotStyle: SlotStyleContext = {
    styleGuide,
    examBoard:           options.examBoard ?? '',
    bloomsDistribution:  options.bloomsDistribution,
    globalInstructions:  options.globalInstructions,
    expectedAnswerStyle: options.expectedAnswerStyle,
  };

  // Collect all question slots with section-aware offsets.
  // Each section starts at a different region of the source so same-numbered
  // questions across sections don't hit the same excerpt window.
  const slots: Array<{
    section:      PaperSection;
    question:     PaperQuestion;
    globalIndex:  number;
    excerptIndex: number;
  }> = [];

  const questionsPerSection = Math.ceil(
    structure.sections.reduce((n, s) => n + s.questions.length, 0) /
    Math.max(structure.sections.length, 1),
  );

  structure.sections.forEach((section, si) => {
    section.questions.forEach((question, qi) => {
      slots.push({
        section,
        question,
        globalIndex:  slots.length,
        excerptIndex: si * questionsPerSection + qi,
      });
    });
  });

  const limiter = createLimiter(2);
  let filledSlots  = 0;
  let failedSlots  = 0;
  let figureSlotIdx = 0;

  const settled = await Promise.allSettled(
    slots.map(({ question, globalIndex, excerptIndex }) =>
      limiter(async () => {
        let generated: object | null;

        if (question.type === 'figureBased') {
          const figure = pickFigure(figureImages, figureSlotIdx++);
          if (!figure) {
            // No figures uploaded — mark slot as failed
            return { globalIndex, generated: null };
          }
          generated = await generateFigureQuestion(question, figure, options, options.requestId, slotStyle);
        } else {
          const chapter = pickChapter(question, chapters, globalIndex);
          const excerpt = pickExcerpt(chapter.sourceText, excerptIndex, 1500, slots.length);
          generated = question.type === 'longAnswer'
            ? await generateLongAnswerQuestion(question, chapter, excerpt, options, options.requestId, slotStyle)
            : await generateObjectiveQuestion(question, chapter, excerpt, options, options.requestId, slotStyle);
        }

        return { globalIndex, generated };
      }),
    ),
  );

  // Rebuild the structure keyed by globalIndex (not question.number, which repeats across sections).
  const generatedMap = new Map<number, object | null>();
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      generatedMap.set(r.value.globalIndex, r.value.generated);
    }
  }

  // Fill sections in the same order slots were built so globalIndex matches.
  let gi = 0;
  const filledSections: PaperSection[] = structure.sections.map(section => ({
    ...section,
    questions: section.questions.map(q => {
      const generated = generatedMap.get(gi++);
      if (generated != null) {
        filledSlots++;
        return { ...q, generated, error: undefined };
      }
      failedSlots++;
      return { ...q, generated: null, error: 'Generation failed after 3 attempts.' };
    }),
  }));

  const filledStructure: PaperStructure = {
    ...structure,
    sections: filledSections,
  };

  return {
    structure:      filledStructure,
    totalSlots:     slots.length,
    filledSlots,
    failedSlots,
    tokensEstimate: slots.length * 800,
  };
}
