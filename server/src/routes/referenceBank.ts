import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { nanoid } from 'nanoid';

import { extractText } from '../ai/extractor.js';
import { parsePaperIntoQuestions } from '../ai/paperParser.js';
import { ReferenceExemplar } from '../models/ReferenceExemplar.js';
import { logger } from '../lib/logger.js';

const CONFIDENCE_THRESHOLD = 0.75;
const MAX_FILE_BYTES = (parseInt(process.env.MAX_PDF_SIZE_MB ?? '20', 10)) * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_BYTES },
  fileFilter(_req, file, cb) {
    ACCEPTED_TYPES.has(file.mimetype) ? cb(null, true) : cb(new Error('UNSUPPORTED_TYPE'));
  },
});

function handleUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, err => (err ? reject(err) : resolve()));
  });
}

const UploadBodySchema = z.object({
  subject:    z.string().optional(),
  class:      z.string().optional(),
  chapter:    z.string().optional(),
  sourceYear: z.coerce.number().int().min(1900).max(2100).optional(),
});

// ── POST /api/reference-bank/upload ──────────────────────────────────────────

router.post('/upload', async (req: Request, res: Response) => {
  try {
    await handleUpload(req, res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'UNSUPPORTED_TYPE') {
      res.status(400).json({ error: 'Only PDF, JPG, and PNG files are accepted.' });
      return;
    }
    if ((err as any)?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: `File exceeds ${process.env.MAX_PDF_SIZE_MB ?? 20} MB limit.` });
      return;
    }
    res.status(400).json({ error: 'File upload failed.' });
    return;
  }

  if (!req.file) { res.status(400).json({ error: 'No file uploaded.' }); return; }

  const parsed = UploadBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: parsed.error.issues }); return; }

  const { subject, class: cls, chapter, sourceYear } = parsed.data;

  let sourceText: string;
  try {
    sourceText = await extractText(req.file.buffer, req.file.mimetype);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'SCANNED_PDF') {
      res.status(422).json({ error: 'This PDF appears to be scanned. Please upload the pages as JPG or PNG images instead.' });
      return;
    }
    res.status(422).json({ error: 'Could not extract text from this file.' });
    return;
  }

  let questions;
  try {
    questions = await parsePaperIntoQuestions(sourceText);
  } catch {
    res.status(422).json({ error: 'Could not parse questions from the uploaded paper.' });
    return;
  }

  if (questions.length === 0) {
    res.status(422).json({ error: 'No recognisable questions found in the uploaded paper.' });
    return;
  }

  const uploadId = nanoid();
  const sharedMeta = {
    teacherId: req.userId,
    uploadId,
    subject:    subject    ?? null,
    class:      cls        ?? null,
    chapter:    chapter    ?? null,
    sourceYear: sourceYear ?? null,
  };

  await ReferenceExemplar.insertMany(
    questions.map(q => ({
      ...sharedMeta,
      questionType: q.questionType,
      rawText:      q.rawText,
      marks:        q.marks,
      confidence:   q.confidence,
      status:       q.confidence >= CONFIDENCE_THRESHOLD ? 'accepted' : 'needs_review',
    })),
  );

  const autoAccepted = questions.filter(q => q.confidence >= CONFIDENCE_THRESHOLD).length;
  const needsReview  = questions.length - autoAccepted;

  logger.info('reference_bank_uploaded', {
    requestId: req.requestId,
    userId:    req.userId,
    uploadId,
    total:     questions.length,
    autoAccepted,
    needsReview,
  });

  res.status(201).json({ uploadId, totalExtracted: questions.length, autoAccepted, needsReview });
});

// ── GET /api/reference-bank/stats ────────────────────────────────────────────

router.get('/stats', async (req: Request, res: Response) => {
  const totalAccepted = await ReferenceExemplar.countDocuments({
    teacherId: req.userId,
    status:    'accepted',
  });
  res.json({ totalAccepted });
});

// ── GET /api/reference-bank/questions ────────────────────────────────────────

router.get('/questions', async (req: Request, res: Response) => {
  const { subject, chapter, questionType, marksMin, marksMax, page = '1', limit = '20' } = req.query as Record<string, string>;
  const cls = req.query.class as string | undefined;

  const filter: Record<string, unknown> = { teacherId: req.userId, status: 'accepted' };
  if (subject)      filter.subject      = subject;
  if (cls)          filter.class        = cls;
  if (chapter)      filter.chapter      = chapter;
  if (questionType) filter.questionType = questionType;
  if (marksMin || marksMax) {
    const marksFilter: Record<string, number> = {};
    if (marksMin) marksFilter.$gte = Number(marksMin);
    if (marksMax) marksFilter.$lte = Number(marksMax);
    filter.marks = marksFilter;
  }

  const p = Math.max(1, parseInt(page));
  const l = Math.min(50, Math.max(1, parseInt(limit)));

  const [questions, total] = await Promise.all([
    ReferenceExemplar.find(filter).skip((p - 1) * l).limit(l).lean(),
    ReferenceExemplar.countDocuments(filter),
  ]);

  res.json({ questions, total, page: p, pages: Math.ceil(total / l) });
});

// ── GET /api/reference-bank/uploads/:uploadId/review ─────────────────────────

router.get('/uploads/:uploadId/review', async (req: Request, res: Response) => {
  const questions = await ReferenceExemplar.find({
    teacherId: req.userId,
    uploadId:  req.params.uploadId,
    status:    'needs_review',
  }).lean();
  res.json(questions);
});

// ── PATCH /api/reference-bank/questions/:id ───────────────────────────────────

router.patch('/questions/:id', async (req: Request, res: Response) => {
  const { action, rawText, marks, questionType } = req.body;
  if (action !== 'accept' && action !== 'reject') {
    res.status(400).json({ error: 'action must be "accept" or "reject"' });
    return;
  }

  const update: Record<string, unknown> = { status: action === 'accept' ? 'accepted' : 'rejected' };
  if (rawText      != null) update.rawText      = rawText;
  if (marks        != null) update.marks        = marks;
  if (questionType != null) update.questionType = questionType;

  const q = await ReferenceExemplar.findOneAndUpdate(
    { _id: req.params.id, teacherId: req.userId },
    update,
    { new: true },
  );
  if (!q) { res.status(404).json({ error: 'Not found.' }); return; }
  res.json(q);
});

// ── POST /api/reference-bank/questions/bulk-accept ───────────────────────────

router.post('/questions/bulk-accept', async (req: Request, res: Response) => {
  const { uploadId } = req.body;
  if (!uploadId) { res.status(400).json({ error: 'uploadId required.' }); return; }

  const result = await ReferenceExemplar.updateMany(
    { teacherId: req.userId, uploadId, status: 'needs_review' },
    { status: 'accepted' },
  );
  res.json({ accepted: result.modifiedCount });
});

export default router;
