import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { extractText } from '../ai/extractor.js';
import { parsePaperIntoQuestions } from '../ai/paperParser.js';
import { ReferenceExemplar } from '../models/ReferenceExemplar.js';
import { logger } from '../lib/logger.js';

const router = Router();

// ── Multer ────────────────────────────────────────────────────────────────────

const MAX_PDF_BYTES = (parseInt(process.env.MAX_PDF_SIZE_MB ?? '10', 10)) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_PDF_BYTES },
  fileFilter(_req, file, cb) {
    file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('NON_PDF'));
  },
});

function handleMulterUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, err => (err ? reject(err) : resolve()));
  });
}

// ── Validation ────────────────────────────────────────────────────────────────

const UploadBodySchema = z.object({
  bankId:       z.string().optional(),
  subject:      z.string().optional(),
  sourceYear:   z.coerce.number().int().min(1900).max(2100).optional(),
  chapterId:    z.string().optional(),
  questionType: z.enum([
    'fillInBlanks', 'multipleChoice', 'multiSelect', 'matchTheFollowing',
    'reordering', 'sorting', 'trueFalse',
  ]).optional(),
});

// ── GET /api/reference-bank ───────────────────────────────────────────────────
// Returns distinct bankIds the teacher has uploaded exemplars for.
// Full ReferenceBank model is deferred — for now, a bank is any string
// `bankId` that appears on at least one of the teacher's exemplars.

router.get('/', async (req: Request, res: Response) => {
  const bankIds = await ReferenceExemplar.distinct('bankId', {
    teacherId: req.userId,
    bankId:    { $ne: null },
  });

  res.json(
    (bankIds as string[]).map(id => ({ id, name: id })),
  );
});

// ── POST /api/reference-bank/upload ──────────────────────────────────────────
// Accepts a PDF of a past paper, extracts text, uses an LLM to split it into
// individual questions, and stores each as a ReferenceExemplar.
// Optional body fields:
//   bankId       — group label (e.g. "CBSE-2023")
//   subject      — subject tag
//   sourceYear   — year of the paper; absent = treated as "recent" by strategyPicker
//   chapterId    — links all questions to a specific TextbookChapter
//   questionType — if provided, only store questions of this type (filter)

router.post('/upload', async (req: Request, res: Response) => {
  try {
    await handleMulterUpload(req, res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'NON_PDF') {
      res.status(400).json({ error: 'Only PDF files are accepted.' });
      return;
    }
    if (msg.includes('File too large') || (err as any)?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: `File size exceeds ${process.env.MAX_PDF_SIZE_MB ?? 10} MB limit.` });
      return;
    }
    res.status(400).json({ error: 'File upload failed.' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return;
  }

  const parsed = UploadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues });
    return;
  }

  const { bankId, subject, sourceYear, chapterId, questionType } = parsed.data;

  let sourceText: string;
  try {
    sourceText = await extractText(req.file.buffer);
  } catch {
    res.status(422).json({ error: 'Could not extract text from this PDF. Try a text-based PDF.' });
    return;
  }

  let questions;
  try {
    questions = await parsePaperIntoQuestions(sourceText);
  } catch {
    res.status(422).json({ error: 'Could not parse questions from the uploaded paper.' });
    return;
  }

  // Filter by questionType if the teacher specified one
  if (questionType) {
    questions = questions.filter(q => q.questionType === questionType);
  }

  if (questions.length === 0) {
    res.status(422).json({ error: 'No recognisable questions found in the uploaded paper.' });
    return;
  }

  // Shared metadata applied to all questions from this upload
  const sharedMeta = {
    teacherId:  req.userId,
    bankId:     bankId   ?? null,
    subject:    subject  ?? null,
    sourceYear: sourceYear ?? null,
    chapterId:  chapterId ?? null,
  };

  await ReferenceExemplar.insertMany(
    questions.map(q => ({ ...sharedMeta, questionType: q.questionType, rawText: q.rawText })),
  );

  logger.info('reference_bank_uploaded', {
    requestId:      req.requestId,
    userId:         req.userId,
    bankId:         bankId ?? null,
    sourceYear:     sourceYear ?? null,
    chapterId:      chapterId ?? null,
    questionsStored: questions.length,
  });

  res.status(201).json({
    questionsStored: questions.length,
    breakdown: Object.fromEntries(
      ['fillInBlanks','multipleChoice','multiSelect','matchTheFollowing','reordering','sorting','trueFalse']
        .map(t => [t, questions.filter(q => q.questionType === t).length])
        .filter(([, n]) => (n as number) > 0),
    ),
  });
});

// ── DELETE /api/reference-bank/:bankId ───────────────────────────────────────
// Removes all exemplars in a bank owned by the requesting teacher.

router.delete('/:bankId', async (req: Request, res: Response) => {
  const { bankId } = req.params;
  const result = await ReferenceExemplar.deleteMany({
    teacherId: req.userId,
    bankId,
  });

  if (result.deletedCount === 0) {
    res.status(404).json({ error: 'Bank not found or no exemplars to delete.' });
    return;
  }

  logger.info('reference_bank_deleted', {
    requestId:    req.requestId,
    userId:       req.userId,
    bankId,
    deletedCount: result.deletedCount,
  });

  res.status(200).json({ deleted: result.deletedCount });
});

export default router;
