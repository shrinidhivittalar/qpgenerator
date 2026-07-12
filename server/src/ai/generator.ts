import Groq from 'groq-sdk';
import { validateQuestionBlock, assignGlobalIds, QuestionBlock } from '../validation/index.js';
import { QuestionType } from '../validation/schemaMap.js';
import { buildPrompt, PromptContext } from './prompts.js';
import { buildMapSkillPrompt, generateFigureQuestionForSlot } from './paperGenerator.js';
import type { FigureImage } from './paperGenerator.js';
import { withRetry, withTimeout } from '../lib/retry.js';
import { groqAcquire } from '../lib/groqLimiter.js';
import { allocateSlots, ChapterInput } from './slotAllocator.js';
import { pickStrategy, Strategy } from './strategyPicker.js';
import { createLimiter } from '../lib/concurrency.js';
import { logger } from '../lib/logger.js';

// Lazy singleton — constructed only when realGenerateFn is first called so
// that importing this module in tests without GROQ_API_KEY does not throw.
let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

type ToneOption = 'formal-board-exam' | 'neutral' | 'conversational';

export interface GenerationContext extends PromptContext {
  // strategyContext is separate from strategy/baseQuestion in PromptContext:
  // it carries the same values to validateQuestionBlock for similarity checks.
  strategyContext?: { strategy: Strategy; baseQuestion: string | null };
}

export type GenerateFn = (
  sourceText:       string,
  type:             QuestionType,
  count:            number,
  marksPerQuestion: number,
  dedupeHint?:      string,
  context?:         GenerationContext,
) => Promise<unknown[]>;

export type RunTypeLoopResult =
  | { status: 'success'; questions: object[] }
  | { status: 'failed';  questions: object[]; requested: number; received: number; error: string };

const MAX_ATTEMPTS = 3;

export async function runTypeLoop(
  sourceText:       string,
  type:             QuestionType,
  targetCount:      number,
  marksPerQuestion: number,
  generateFn:       GenerateFn,
  context?:         GenerationContext,
): Promise<RunTypeLoopResult> {
  let collected: object[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const shortfall = targetCount - collected.length;

    let raw: unknown[];
    try {
      raw = await generateFn(
        sourceText,
        type,
        shortfall,
        marksPerQuestion,
        attempt > 1 ? 'Avoid duplicating previously generated questions.' : undefined,
        context,
      );
    } catch {
      // EC-GEN-08: thrown error (network, invalid JSON) = 0 received this round
      raw = [];
    }

    const { valid } = await validateQuestionBlock(
      type, raw, [],
      context?.difficulty as ('easy' | 'moderate' | 'hard') | undefined,
      context?.strategyContext,
    );
    collected = collected.concat(valid);

    if (collected.length >= targetCount) {
      collected = collected.slice(0, targetCount); // GEN-04, EC-GEN-05: trim excess
      return { status: 'success', questions: recalculateMarks(collected, marksPerQuestion) };
    }
  }

  return {
    status:    'failed',
    questions: recalculateMarks(collected, marksPerQuestion),
    requested: targetCount,
    received:  collected.length,
    error:     collected.length === 0
      ? `Could not generate any ${type} questions from the source content.`
      : `Insufficient source content to generate ${targetCount} ${type} questions.`,
  };
}

// marks are server-assigned from typeConfig — the AI's value is never trusted
function recalculateMarks(questions: object[], marksPerQuestion: number): object[] {
  return questions.map(q => ({ ...q, marks: marksPerQuestion }));
}

// EC-GEN-08: strip markdown fences the model may add despite instructions,
// then parse. If the model prepends prose before the JSON array, find the
// first [...] bracket pair and extract it. Returns [] on any parse failure.
export function parseAiJsonArray(raw: string): unknown[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // Fast path: the whole cleaned string is valid JSON
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Slow path: extract the first [...] block from the string.
  // Walk character-by-character tracking bracket depth to find the matching ].
  const start = cleaned.indexOf('[');
  if (start === -1) return [];
  let depth = 0;
  let end   = -1;
  for (let i = start; i < cleaned.length; i++) {
    if      (cleaned[i] === '[') depth++;
    else if (cleaned[i] === ']') { if (--depth === 0) { end = i; break; } }
  }
  if (end === -1) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Shared Groq call — reserves a token window slot before calling the API.
// The actual HTTP call runs concurrently with others; only the reserve step
// is serialised (inside groqAcquire) to prevent window-check races.
async function callGroq(
  type:   QuestionType,
  system: string,
  user:   string,
): Promise<{ questions: unknown[]; tokens: number }> {
  await groqAcquire();
  const response = await withRetry(
    () => withTimeout(
      () => getGroq().chat.completions.create({
        model:       GROQ_MODEL,
        messages:    [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
        temperature: 0.7,
      }),
      30_000,
      `groq:${type}`,
    ),
    3,
  );
  const tokens = response.usage?.total_tokens ?? 0;
  const raw    = response.choices[0]?.message?.content ?? '';
  return { questions: parseAiJsonArray(raw), tokens };
}

// Convenience export for one-off calls (no token tracking).
export const realGenerateFn: GenerateFn = async (sourceText, type, count, marks, dedupeHint, context) => {
  const { system, user } = await buildPrompt(type, sourceText, count, marks, { ...context, dedupeHint });
  const { questions } = await callGroq(type, system, user);
  return questions;
};

// Factory for per-run token tracking. Each call to makeTrackedGenerateFn
// returns a fresh counter; the route calls getTokensUsed() after generateSet
// completes to obtain the total for that run.
export function makeTrackedGenerateFn(): { generateFn: GenerateFn; getTokensUsed: () => number } {
  let tokensUsed = 0;
  const generateFn: GenerateFn = async (sourceText, type, count, marks, dedupeHint, context) => {
    const { system, user } = await buildPrompt(type, sourceText, count, marks, { ...context, dedupeHint });
    const { questions, tokens } = await callGroq(type, system, user);
    tokensUsed += tokens;
    return questions;
  };
  return { generateFn, getTokensUsed: () => tokensUsed };
}

// ── Slot-based generation ─────────────────────────────────────────────────────
// Slots are grouped into batches per API call. Batch size trades diversity for
// speed: larger batches = fewer API calls but more questions sharing one excerpt.
// Long-answer questions use batch size 1 so every question gets its own unique
// excerpt — they're most prone to duplicate "same scenario, different wording".

const DEFAULT_BATCH_SIZE = 3;
const TYPE_BATCH_SIZE: Partial<Record<QuestionType, number>> = {
  longAnswer:  1,
  shortAnswer: 2,
};

// Deduplicate by Jaccard similarity on question text. Keeps the first of any
// pair exceeding the threshold so ordering is deterministic.
function deduplicateQuestions(questions: object[], threshold = 0.55): object[] {
  const getWords = (q: object): Set<string> =>
    new Set(
      (((q as any).questionText ?? '') as string)
        .toLowerCase()
        .match(/\b[a-z]{4,}\b/g) ?? [],
    );

  const accepted: object[] = [];
  for (const q of questions) {
    const qWords = getWords(q);
    const isDup  = accepted.some(a => {
      const aWords = getWords(a);
      const inter  = [...qWords].filter(w => aWords.has(w)).length;
      const union  = new Set([...qWords, ...aWords]).size;
      return union > 0 && inter / union >= threshold;
    });
    if (!isDup) accepted.push(q);
  }
  return accepted;
}

export async function generateTypeViaSlots(
  type:               QuestionType,
  count:              number,
  marksPerQuestion:   number,
  chapters:           ChapterInput[],
  explicitDifficulty: 'easy' | 'moderate' | 'hard' | undefined,
  teacherId:          string,
  tone:               ToneOption,
  bankId:             string | undefined,
  limiter:            ReturnType<typeof createLimiter>,
  typeIndex:          number = 0,
  mapItems?:          string[],
  figurePages?:       FigureImage[],
): Promise<{ questions: object[]; requested: number; received: number }> {
  // figureBased questions are generated via vision API, not text prompts.
  // Each slot picks one figure page round-robin from the uploaded chapter pages.
  if (type === 'figureBased') {
    logger.info('figureBased_slot_start', { figurePageCount: figurePages?.length ?? 0, count });
    if (!figurePages || figurePages.length === 0) {
      logger.warn('figureBased_no_pages', { count });
      return { questions: [], requested: count, received: 0 };
    }
    const questions: object[] = [];
    for (let i = 0; i < count; i++) {
      const figure = figurePages[i % figurePages.length];
      try {
        const q = await limiter(() =>
          generateFigureQuestionForSlot(marksPerQuestion, figure.base64, figure.mimeType, teacherId, tone, figure._id),
        );
        if (q) questions.push(q);
      } catch { /* skip failed slot */ }
    }
    return { questions, requested: count, received: questions.length };
  }

  const slots = await allocateSlots(type, count, marksPerQuestion, chapters, explicitDifficulty, typeIndex);

  // Group slots into batches. Long-answer uses batch size 1 so every question
  // gets its own unique excerpt and API call — they're most prone to the
  // "same scenario, different wording" duplication pattern.
  const batchSize = TYPE_BATCH_SIZE[type] ?? DEFAULT_BATCH_SIZE;
  const batches: typeof slots[] = [];
  for (let i = 0; i < slots.length; i += batchSize) {
    batches.push(slots.slice(i, i + batchSize));
  }

  const settled = await Promise.allSettled(
    batches.map(batchSlots =>
      limiter(async () => {
        const lead       = batchSlots[0];
        const batchCount = batchSlots.length;
        const { strategy, baseQuestion } = await pickStrategy(teacherId, lead.chapterId, type);

        const slotGenerateFn: GenerateFn = async (_src, _type, n, marks) => {
          const { system, user } = type === 'mapSkill'
            ? buildMapSkillPrompt(marks, mapItems, n)
            : await buildPrompt(type, lead.sourceExcerpt, n, marks, {
                teacherId,
                bankId,
                tone,
                difficulty:   lead.difficulty,
                chapterName:  lead.chapterName,
                strategy,
                baseQuestion,
                mapItems,
              });
          const { questions } = await callGroq(type, system, user);
          return questions;
        };

        return runTypeLoop(
          lead.sourceExcerpt,
          type,
          batchCount,
          marksPerQuestion,
          slotGenerateFn,
          { strategyContext: { strategy, baseQuestion } },
        );
      }),
    ),
  );

  const raw: object[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      // Include questions from both successful and partial batches.
      // A failed batch still has whatever valid questions it produced.
      raw.push(...r.value.questions);
    }
  }

  // Deduplicate by Jaccard similarity on question text before returning.
  // Catches cosmetic variants produced when multiple batches hit the same
  // textbook example (e.g. "50m from minar at 30°" vs "50m from tower at 30°").
  const questions = deduplicateQuestions(raw);

  // Shortfall pass: some batches may have returned fewer than their allocated
  // count because a narrow excerpt window ran out of distinct content.
  // Retry for the remaining gap using the full combined chapter text so the
  // model has broader context to draw from.
  if (questions.length < count && type !== 'mapSkill' && chapters.length > 0) {
    const shortfall    = count - questions.length;
    const combinedText = chapters
      .map(c => c.sourceText)
      .join('\n\n')
      .slice(0, 8000);

    try {
      const { strategy, baseQuestion } = await pickStrategy(teacherId, chapters[0].id, type);
      const retryFn: GenerateFn = async (_src, _type, n, marks) => {
        const { system, user } = await buildPrompt(type, combinedText, n, marks, {
          teacherId,
          bankId,
          tone,
          difficulty:  explicitDifficulty,
          chapterName: chapters[0].name,
          strategy,
          baseQuestion,
          dedupeHint:  'Focus on different topics and scenarios not yet covered. Do not repeat questions already generated.',
        });
        const { qs } = await callGroq(type, system, user).then(r => ({ qs: r.questions }));
        return qs;
      };

      const retryResult = await limiter(() =>
        runTypeLoop(combinedText, type, shortfall, marksPerQuestion, retryFn),
      );
      if (retryResult.questions.length > 0) {
        const merged = deduplicateQuestions([...questions, ...retryResult.questions]);
        return {
          questions: merged.slice(0, count),
          requested: count,
          received:  Math.min(merged.length, count),
        };
      }
    } catch { /* ignore retry failure — return what we already have */ }
  }

  return { questions, requested: count, received: questions.length };
}

export interface GenerationError {
  type:      string;
  requested: number;
  received:  number;
  error:     string;
}

export interface TypeConfig {
  type:             QuestionType;
  count:            number;
  marksPerQuestion: number;
  difficulty?:      'easy' | 'moderate' | 'hard';
}

// Note: if ALL counts are 0 the route layer should reject before calling
// generateSet — that boundary is enforced at the API level (Day 3), not here.
export async function generateSet(
  sourceText:  string,
  typeConfig:  TypeConfig[],
  generateFn:  GenerateFn,
  context?:    Omit<GenerationContext, 'difficulty'>,
): Promise<{ blocks: QuestionBlock[]; errors: GenerationError[] }> {
  // GEN-09, EC-GEN-01: types with count 0 are silently skipped
  const activeTypes = typeConfig.filter(tc => tc.count > 0);

  // ADR-003: Promise.allSettled so one type's unexpected throw never
  // cancels the others
  const settled = await Promise.allSettled(
    activeTypes.map(tc =>
      runTypeLoop(
        sourceText, tc.type, tc.count, tc.marksPerQuestion, generateFn,
        { ...context, difficulty: tc.difficulty },
      ).then(result => ({ type: tc.type, result })),
    ),
  );

  const blocks: QuestionBlock[] = [];
  const errors: GenerationError[] = [];

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      // runTypeLoop should never reject (catches internally), but if it
      // somehow does, skip it — don't crash the entire generateSet call
      continue;
    }
    const { type, result } = outcome.value;
    if (result.status === 'success') {
      blocks.push({
        questionType: type,
        totalMarks:   result.questions.reduce((sum, q) => sum + ((q as Record<string, unknown>).marks as number), 0),
        status:       'success',
        questions:    result.questions,
      });
    } else if (result.received > 0) {
      // Partial result — accept what was generated rather than discarding it.
      blocks.push({
        questionType: type,
        totalMarks:   result.questions.reduce((sum, q) => sum + ((q as Record<string, unknown>).marks as number), 0),
        status:       'success',
        questions:    result.questions,
      });
      errors.push({
        type,
        requested: result.requested,
        received:  result.received,
        error:     result.error,
      });
    } else {
      errors.push({
        type,
        requested: result.requested,
        received:  result.received,
        error:     result.error,
      });
    }
  }

  // ADR-004: single ID-assignment pass after all types complete
  assignGlobalIds(blocks);
  return { blocks, errors };
}
