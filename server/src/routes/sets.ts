import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';

import { requireRole } from '../middleware/requireRole.js';
import { QuestionSet } from '../models/QuestionSet.js';
import { User } from '../models/User.js';
import { GenerationRun } from '../models/GenerationRun.js';
import Scheme from '../models/Scheme.js';
import TextbookChapter from '../models/TextbookChapter.js';
import {
  generateSet, generateTypeViaSlots, runTypeLoop, makeTrackedGenerateFn, TypeConfig,
} from '../ai/generator.js';
import { generatePaper } from '../ai/paperGenerator.js';
import { buildQuestionPaperDoc } from '../ai/wordExporter.js';
import { createLimiter } from '../lib/concurrency.js';
import { assignGlobalIds, QuestionBlock, QuestionType } from '../validation/index.js';
import { schemaMap } from '../validation/schemaMap.js';
import { checkAndReserveBudget } from '../services/tokenBudget.js';
import { logger } from '../lib/logger.js';
import { DifficultyLevel, ToneOption } from '../validation/schemas/typeConfig.js';
import type { ChapterInput } from '../ai/slotAllocator.js';
import { PaperStructureSchema } from '../types/paperStructure.js';

const router = Router();

const VALID_TYPES = [
  'fillInBlanks', 'multipleChoice', 'multiSelect', 'matchTheFollowing',
  'reordering', 'sorting', 'trueFalse', 'assertionReason', 'shortAnswer', 'longAnswer',
] as const;

const TypeConfigItemSchema = z.object({
  type:             z.string(),
  count:            z.number().int().min(0),
  marksPerQuestion: z.number().positive(),
  difficulty:       DifficultyLevel.optional(),
});

const GenerateBodySchema = z.object({
  typeConfig:        z.array(TypeConfigItemSchema).min(1),
  chapterIds:        z.array(z.string()).optional(),
  schemeId:          z.string().optional(),
  bankId:            z.string().optional(),
  difficultyDefault: DifficultyLevel.optional(),
  tone:              ToneOption.optional(),
});

const RegenerateBodySchema = z.object({
  type: z.string(),
});

// ── POST /api/sets/create ─────────────────────────────────────────────────────
// Creates an empty QuestionSet for chapter-based mode where no source PDF is
// needed — chapters supply the source text at generation time.

router.post('/create', requireRole('teacher'), async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  try {
    const teacher = await User.findById(userId).lean();
    const set = await QuestionSet.create({
      teacherId:  userId,
      department: (teacher as any)?.department || 'General',
      sourceText: 'chapter-based',
      fileName:   'Chapter-based generation',
      status:     'draft',
    });
    res.status(201).json({
      setId:       set._id.toString(),
      fileName:    set.fileName,
      wordCount:   0,
      previewText: '',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('sets_create_failed', { userId, error: msg });
    res.status(500).json({ error: `Failed to create session: ${msg}` });
  }
});

// ── POST /api/sets/:id/generate ───────────────────────────────────────────────

router.post('/:id/generate', requireRole('teacher'), async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  const set = await QuestionSet.findById(req.params.id);
  if (!set) { res.status(404).json({ error: 'Question set not found.' }); return; }

  if (set.teacherId.toString() !== userId) {
    res.status(403).json({ error: "You don't have permission to generate for this set." });
    return;
  }

  const bodyResult = GenerateBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues[0]?.message ?? 'Invalid request body.' });
    return;
  }

  for (const tc of bodyResult.data.typeConfig) {
    if (!(VALID_TYPES as readonly string[]).includes(tc.type)) {
      res.status(400).json({ error: `Invalid question type: ${tc.type}` });
      return;
    }
  }

  const { difficultyDefault, tone, bankId, chapterIds } = bodyResult.data;

  // Leave difficulty undefined when neither per-type nor global default is set —
  // the difficulty filter in validateQuestionBlock only runs when explicitly requested.
  // buildPrompt still defaults to 'moderate' guidance even when undefined here.
  const effectiveTypeConfig = bodyResult.data.typeConfig.map(tc => ({
    ...tc,
    difficulty: tc.difficulty ?? difficultyDefault,
  }));

  const activeTypeConfig = effectiveTypeConfig.filter(tc => tc.count > 0) as TypeConfig[];
  if (activeTypeConfig.length === 0) {
    res.status(400).json({ error: 'Select at least one question type with a count greater than 0.' });
    return;
  }

  const hasBudget = await checkAndReserveBudget(userId);
  if (!hasBudget) { res.status(429).json({ error: 'Daily token budget exceeded.' }); return; }

  // Resolve chapters for slot path
  let resolvedChapters: ChapterInput[] = [];
  if (chapterIds && chapterIds.length > 0) {
    const validIds = chapterIds.filter(id => mongoose.isValidObjectId(id));
    if (validIds.length > 0) {
      const docs = await TextbookChapter.find({ _id: { $in: validIds }, teacherId: userId }).lean();
      docs.sort((a, b) => a.chapterNumber - b.chapterNumber);
      resolvedChapters = docs.map(c => ({
        id: c._id.toString(), name: c.title, weightPercent: c.weightPercent,
        sourceText: c.sourceText, highValueSnippets: c.highValueSnippets,
      }));
    }
  }

  const startTime = Date.now();
  let blocks:     QuestionBlock[] = [];
  let errors:     Array<{ type: string; requested: number; received: number; error: string }> = [];
  let tokensUsed = 0;

  try {
    if (resolvedChapters.length > 0) {
      const limiter = createLimiter(3);
      const slotSettled = await Promise.allSettled(
        activeTypeConfig.map((tc, typeIndex) =>
          generateTypeViaSlots(
            tc.type, tc.count, tc.marksPerQuestion, resolvedChapters,
            tc.difficulty ?? undefined,
            userId, tone ?? 'formal-board-exam', bankId ?? undefined, limiter,
            typeIndex,
          ).then(r => ({ type: tc.type, marksPerQuestion: tc.marksPerQuestion, ...r })),
        ),
      );

      for (const outcome of slotSettled) {
        if (outcome.status === 'rejected') continue;
        const { type, marksPerQuestion, questions, requested, received } = outcome.value;
        if (received >= requested) {
          blocks.push({
            questionType: type, status: 'success',
            totalMarks:   questions.reduce((s: number, q: any) => s + ((q.marks as number) ?? marksPerQuestion), 0),
            questions:    questions.slice(0, requested),
          });
        } else {
          errors.push({
            type, requested, received,
            error: received === 0
              ? `Could not generate any ${type} questions from the selected chapters.`
              : `Insufficient chapter content to generate ${requested} ${type} questions.`,
          });
        }
      }
      assignGlobalIds(blocks);
    } else {
      // No chapters selected — extract a diverse multi-section excerpt from
      // the source document rather than dumping the full text. For large
      // documents this prevents the LLM from fixating on whichever examples
      // happen to dominate the first few thousand characters.
      const { generateFn, getTokensUsed } = makeTrackedGenerateFn();
      const sourceForGeneration = diverseExcerpt(set.sourceText, activeTypeConfig.length);
      const result = await generateSet(sourceForGeneration, activeTypeConfig, generateFn, {
        tone, bankId, teacherId: userId, subjectHint: set.department,
      });
      blocks     = result.blocks;
      errors     = result.errors;
      tokensUsed = getTokensUsed();
    }
  } catch {
    res.status(503).json({ error: 'AI service unavailable. Please try again.' }); return;
  }

  const durationMs = Date.now() - startTime;

  const { schemeId } = bodyResult.data;
  if (schemeId) {
    try {
      const scheme = await Scheme.findById(schemeId).lean();
      if (scheme && scheme.teacherId.toString() === userId) set.schemeId = scheme._id as any;
    } catch { /* ignore */ }
  }

  if (difficultyDefault)            set.difficultyDefault = difficultyDefault as any;
  if (tone)                         set.tone              = tone as any;
  if (bankId)                       set.bankId            = bankId as any;
  if (resolvedChapters.length > 0)  set.chapterIds        = resolvedChapters.map(c => c.id) as any;

  set.questionBlocks   = blocks as any;
  set.generationErrors = errors as any;
  set.typeConfig       = activeTypeConfig as any;
  set.status           = 'draft';
  await set.save();

  await GenerationRun.create({
    setId: set._id, userId, role: 'teacher',
    typesRequested:  activeTypeConfig.map(t => t.type),
    typesSucceeded:  blocks.map(b => b.questionType),
    typesFailed:     errors.map(e => e.type),
    countsRequested: Object.fromEntries(activeTypeConfig.map(t => [t.type, t.count])),
    countsGenerated: Object.fromEntries(blocks.map(b => [b.questionType, b.questions.length])),
    tokensUsed, durationMs, requestId: (req as any).requestId,
    ...(resolvedChapters.length > 0 && { chapterIds: resolvedChapters.map(c => c.id) }),
  });

  logger.info('generation_complete', {
    requestId: (req as any).requestId, userId, role: 'teacher',
    setId: set._id.toString(), durationMs,
    typesRequested: activeTypeConfig.map(t => t.type),
    typesSucceeded: blocks.map(b => b.questionType),
    typesFailed:    errors.map(e => e.type),
    tokensUsed, slotPath: resolvedChapters.length > 0, chapterCount: resolvedChapters.length,
  });

  res.status(200).json({
    questionBlocks:   blocks,
    generationErrors: errors,
    totalGenerated:   blocks.reduce((s, b) => s + b.questions.length, 0),
  });
});

// ── PATCH /api/sets/:id/questions/:questionId ─────────────────────────────────
// Edit a single question's fields. Validates against the type's Zod schema.
// Preserves server-assigned id and marks.

router.patch('/:id/questions/:questionId', requireRole('teacher'), async (req: Request, res: Response) => {
  const userId     = (req as any).userId as string;
  const questionId = parseInt(req.params.questionId as string, 10);

  if (isNaN(questionId)) {
    res.status(400).json({ error: 'Invalid question ID.' }); return;
  }

  const set = await QuestionSet.findById(req.params.id);
  if (!set) { res.status(404).json({ error: 'Question set not found.' }); return; }

  if (set.teacherId.toString() !== userId) {
    res.status(403).json({ error: "You don't have permission to edit this set." }); return;
  }

  // Locate the question across all blocks
  const blocks = set.questionBlocks as any[];
  let blockIndex    = -1;
  let questionIndex = -1;
  let questionType: string | null = null;

  for (let bi = 0; bi < blocks.length; bi++) {
    const qi = (blocks[bi].questions as any[]).findIndex((q: any) => q.id === questionId);
    if (qi !== -1) {
      blockIndex = bi; questionIndex = qi; questionType = blocks[bi].questionType;
      break;
    }
  }

  if (blockIndex === -1) {
    res.status(404).json({ error: 'Question not found.' }); return;
  }

  const schema = schemaMap[questionType as QuestionType];
  if (!schema) {
    res.status(400).json({ error: `Unknown question type: ${questionType}` }); return;
  }

  // Inject the original server-assigned values so the schema never rejects them
  const original = blocks[blockIndex].questions[questionIndex];
  const bodyWithDefaults = { ...req.body, id: questionId, marks: original.marks };

  const parseResult = schema.safeParse(bodyWithDefaults);
  if (!parseResult.success) {
    res.status(422).json({
      error:   parseResult.error.issues[0]?.message ?? 'Invalid question data.',
      details: parseResult.error.issues,
    });
    return;
  }

  const updated = { ...parseResult.data, id: questionId, marks: original.marks };
  blocks[blockIndex].questions[questionIndex] = updated;
  set.markModified('questionBlocks');
  await set.save();

  logger.info('question_edited', {
    requestId:  (req as any).requestId,
    userId,
    setId:      set._id.toString(),
    questionId,
    questionType,
  });

  res.status(200).json({ question: updated });
});

// ── POST /api/sets/:id/regenerate ─────────────────────────────────────────────
// Re-generates a single question type using the same sources as the original run.
// On success: replaces the block and reassigns global IDs across all blocks.
// On failure: leaves all blocks unchanged and returns a 200 with success: false.

router.post('/:id/regenerate', requireRole('teacher'), async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  const bodyResult = RegenerateBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: 'type is required.' }); return;
  }

  const { type } = bodyResult.data;

  if (!(VALID_TYPES as readonly string[]).includes(type)) {
    res.status(400).json({ error: `Invalid question type: ${type}` }); return;
  }

  const set = await QuestionSet.findById(req.params.id);
  if (!set) { res.status(404).json({ error: 'Question set not found.' }); return; }

  if (set.teacherId.toString() !== userId) {
    res.status(403).json({ error: "You don't have permission to regenerate this set." }); return;
  }

  // Look up stored typeConfig for this type
  const storedConfig = (set.typeConfig as any[]).find(tc => tc.type === type);
  if (!storedConfig) {
    res.status(404).json({ error: `Type "${type}" was not part of the original generation.` }); return;
  }

  const hasBudget = await checkAndReserveBudget(userId);
  if (!hasBudget) { res.status(429).json({ error: 'Daily token budget exceeded.' }); return; }

  // Re-resolve chapters used in the original generation
  let resolvedChapters: ChapterInput[] = [];
  const storedChapterIds: string[] = ((set.chapterIds as any[]) ?? []).map((id: any) => id.toString());
  if (storedChapterIds.length > 0) {
    const docs = await TextbookChapter.find({ _id: { $in: storedChapterIds }, teacherId: userId }).lean();
    docs.sort((a, b) => a.chapterNumber - b.chapterNumber);
    resolvedChapters = docs.map(c => ({
      id: c._id.toString(), name: c.title, weightPercent: c.weightPercent,
      sourceText: c.sourceText, highValueSnippets: c.highValueSnippets,
    }));
  }

  const tc: TypeConfig = {
    type:             type as QuestionType,
    count:            storedConfig.count,
    marksPerQuestion: storedConfig.marksPerQuestion,
    difficulty:       storedConfig.difficulty,
  };

  type RegenerateResult =
    | { status: 'success'; questions: object[] }
    | { status: 'failed';  requested: number; received: number; error: string };

  let newResult: RegenerateResult;

  try {
    if (resolvedChapters.length > 0) {
      const limiter   = createLimiter(3);
      const slotResult = await generateTypeViaSlots(
        tc.type, tc.count, tc.marksPerQuestion, resolvedChapters,
        tc.difficulty ?? undefined,
        userId, ((set.tone as string) ?? 'formal-board-exam') as 'formal-board-exam' | 'neutral' | 'conversational', (set.bankId as string) ?? undefined, limiter,
      );
      if (slotResult.received >= slotResult.requested) {
        newResult = { status: 'success', questions: slotResult.questions.slice(0, slotResult.requested) };
      } else {
        newResult = {
          status: 'failed', requested: slotResult.requested, received: slotResult.received,
          error:  slotResult.received === 0
            ? `Could not generate any ${type} questions from the selected chapters.`
            : `Insufficient chapter content to generate ${slotResult.requested} ${type} questions.`,
        };
      }
    } else {
      const { generateFn } = makeTrackedGenerateFn();
      const sourceForRegen = diverseExcerpt(set.sourceText, 1);
      const loopResult = await runTypeLoop(
        sourceForRegen, tc.type, tc.count, tc.marksPerQuestion, generateFn,
        {
          tone:        (set.tone as 'formal-board-exam' | 'neutral' | 'conversational' | undefined) ?? undefined,
          bankId:      (set.bankId as string | undefined)  ?? undefined,
          teacherId:   userId,
          subjectHint: String(set.department),
          difficulty:  tc.difficulty,
        },
      );
      newResult = loopResult;
    }
  } catch {
    res.status(503).json({ error: 'AI service unavailable. Please try again.' }); return;
  }

  // Failure path: leave all blocks unchanged
  if (newResult.status === 'failed') {
    logger.info('regeneration_failed', {
      requestId: (req as any).requestId, userId, setId: set._id.toString(), type,
      requested: newResult.requested, received: newResult.received,
    });
    res.status(200).json({
      questionBlocks:  set.questionBlocks,
      regeneratedType: type,
      success:         false,
      error:           newResult.error,
      requested:       newResult.requested,
      received:        newResult.received,
    });
    return;
  }

  // Success path: replace block, reassign global IDs
  const blocks = [...(set.questionBlocks as any[])];
  const existingIndex = blocks.findIndex(b => b.questionType === type);
  const newBlock = {
    questionType: type,
    totalMarks:   newResult.questions.reduce((s: number, q: any) => s + ((q.marks as number) ?? tc.marksPerQuestion), 0),
    status:       'success',
    questions:    newResult.questions,
  };

  if (existingIndex !== -1) {
    blocks[existingIndex] = newBlock;
  } else {
    blocks.push(newBlock);
  }

  assignGlobalIds(blocks);
  set.questionBlocks = blocks as any;
  set.markModified('questionBlocks');
  await set.save();

  logger.info('regeneration_complete', {
    requestId: (req as any).requestId, userId, setId: set._id.toString(), type,
    questionsGenerated: newResult.questions.length,
  });

  res.status(200).json({
    questionBlocks:  blocks,
    regeneratedType: type,
    success:         true,
    totalGenerated:  blocks.reduce((s: number, b: any) => s + b.questions.length, 0),
  });
});

// ── POST /api/sets/:id/generate-paper ────────────────────────────────────────
// Generate a full structured paper using a PaperStructure (from scheme or
// provided in the request body). Fills every question slot and stores the
// filled structure back into the QuestionSet.

const GeneratePaperBodySchema = z.object({
  paperStructure: z.record(z.unknown()),  // validated as PaperStructure below
  chapterIds:     z.array(z.string()).min(1),
  tone:           ToneOption.optional(),
});

router.post('/:id/generate-paper', requireRole('teacher'), async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  const set = await QuestionSet.findById(req.params.id);
  if (!set) { res.status(404).json({ error: 'Question set not found.' }); return; }
  if (set.teacherId.toString() !== userId) {
    res.status(403).json({ error: "You don't have permission to generate for this set." }); return;
  }

  const bodyResult = GeneratePaperBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues[0]?.message ?? 'Invalid request body.' }); return;
  }

  const structureResult = PaperStructureSchema.safeParse(bodyResult.data.paperStructure);
  if (!structureResult.success) {
    res.status(400).json({ error: 'Invalid paperStructure: ' + (structureResult.error.issues[0]?.message ?? 'validation failed') }); return;
  }

  const { chapterIds, tone } = bodyResult.data;
  const validIds = chapterIds.filter(id => mongoose.isValidObjectId(id));
  if (validIds.length === 0) {
    res.status(400).json({ error: 'No valid chapter IDs provided.' }); return;
  }

  const docs = await TextbookChapter.find({ _id: { $in: validIds }, teacherId: userId }).lean();
  if (docs.length === 0) {
    res.status(400).json({ error: 'No accessible chapters found for the provided IDs.' }); return;
  }

  docs.sort((a, b) => a.chapterNumber - b.chapterNumber);
  const resolvedChapters: ChapterInput[] = docs.map(c => ({
    id: c._id.toString(), name: c.title, weightPercent: c.weightPercent,
    sourceText: c.sourceText, highValueSnippets: c.highValueSnippets,
  }));

  const hasBudget = await checkAndReserveBudget(userId);
  if (!hasBudget) { res.status(429).json({ error: 'Daily token budget exceeded.' }); return; }

  const startTime = Date.now();

  let result;
  try {
    result = await generatePaper(
      structureResult.data,
      resolvedChapters,
      { teacherId: userId, tone: tone ?? 'formal-board-exam', requestId: (req as any).requestId },
    );
  } catch {
    res.status(503).json({ error: 'AI service unavailable. Please try again.' }); return;
  }

  const durationMs = Date.now() - startTime;

  (set as any).paperStructure = result.structure;
  set.chapterIds = resolvedChapters.map(c => c.id) as any;
  if (tone) set.tone = tone as any;
  set.status = 'draft';
  set.markModified('paperStructure');
  await set.save();

  logger.info('paper_generation_complete', {
    requestId:   (req as any).requestId,
    userId,
    setId:       set._id.toString(),
    totalSlots:  result.totalSlots,
    filledSlots: result.filledSlots,
    failedSlots: result.failedSlots,
    durationMs,
  });

  res.status(200).json({
    paperStructure: result.structure,
    totalSlots:     result.totalSlots,
    filledSlots:    result.filledSlots,
    failedSlots:    result.failedSlots,
  });
});

// ── GET /api/sets/:id/export/paper ────────────────────────────────────────────
// Generates and downloads a .docx question paper from the filled PaperStructure.
// Contains two parts: student-facing question paper (no answers) + answer key.

router.get('/:id/export/paper', requireRole('teacher'), async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  const set = await QuestionSet.findById(req.params.id);
  if (!set) { res.status(404).json({ error: 'Question set not found.' }); return; }
  if (set.teacherId.toString() !== userId) {
    res.status(403).json({ error: 'Access denied.' }); return;
  }

  const structure = (set as any).paperStructure as object | null;
  if (!structure) {
    res.status(404).json({ error: 'No generated paper found. Generate a paper first.' }); return;
  }

  const structureResult = PaperStructureSchema.safeParse(structure);
  if (!structureResult.success) {
    res.status(500).json({ error: 'Stored paper structure is invalid.' }); return;
  }

  try {
    const buffer = await buildQuestionPaperDoc(structureResult.data);
    const safeTitle = (structureResult.data.title || 'question-paper')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.docx"`);
    res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('paper_export_failed', { userId, setId: req.params.id, error: msg });
    res.status(500).json({ error: 'Failed to generate Word document.' });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// For large source documents, extract N evenly-spaced windows and concatenate
// them with section markers. This ensures the LLM sees material from across the
// whole document rather than fixating on examples repeated near the beginning.
// Small documents (< 10 000 chars) are returned as-is.
function diverseExcerpt(sourceText: string, typeCount: number): string {
  const MIN_LENGTH_TO_WINDOW = 10_000;
  if (sourceText.length <= MIN_LENGTH_TO_WINDOW) return sourceText;

  // Skip front matter (title page, TOC) — typically first 5% of the document
  const bodyStart  = Math.min(5000, Math.floor(sourceText.length * 0.05));
  const body       = sourceText.slice(bodyStart);

  // Pick N windows spread evenly across the body; N scales with question type
  // count so more types → slightly more coverage, capped at 6 sections.
  const n          = Math.min(6, Math.max(3, typeCount + 1));
  const windowSize = 3000;
  const usable     = Math.max(0, body.length - windowSize);
  const step       = n > 1 ? Math.floor(usable / (n - 1)) : 0;

  const sections = Array.from({ length: n }, (_, i) => {
    const start = Math.min(i * step, usable);
    return `[SECTION ${i + 1}]\n${body.slice(start, start + windowSize).trim()}`;
  });

  return sections.join('\n\n');
}

export default router;
