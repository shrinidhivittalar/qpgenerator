import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { extractText } from '../ai/extractor.js';
import TextbookChapter from '../models/TextbookChapter.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.use(requireAuth, requireRole('teacher'));

const MAX_PDF_BYTES = (parseInt(process.env.MAX_PDF_SIZE_MB ?? '10', 10)) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('NON_PDF'));
    }
  },
});

function handleMulterUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

const UploadBodySchema = z.object({
  subject: z.string().min(1, 'subject is required'),
  chapterName: z.string().optional(),
  title: z.string().optional(),
  chapterNumber: z.coerce.number().int().min(1),
  weightPercent: z.coerce.number().min(0).max(100),
  highValueSnippets: z.string().optional(),
});

function parseSnippets(raw: string): string[] {
  const byNewline = raw.split('\n').map(s => s.trim()).filter(Boolean);
  if (byNewline.length > 1) return byNewline;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

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

  const { subject, chapterName, title, chapterNumber, weightPercent, highValueSnippets } = parsed.data;
  const resolvedTitle = chapterName?.trim() || title?.trim();
  if (!resolvedTitle) {
    res.status(400).json({ error: 'chapterName is required.' });
    return;
  }

  let sourceText: string;
  try {
    sourceText = await extractText(req.file.buffer);
  } catch {
    res.status(422).json({ error: 'Could not extract text from this PDF. Try a text-based PDF.' });
    return;
  }

  const snippets = highValueSnippets ? parseSnippets(highValueSnippets) : [];

  const chapter = await TextbookChapter.create({
    teacherId: req.userId,
    subject: subject.trim(),
    title: resolvedTitle,
    chapterNumber,
    weightPercent,
    sourceText,
    highValueSnippets: snippets,
  });

  logger.info('chapter_uploaded', {
    requestId: req.requestId,
    userId: req.userId,
    chapterId: chapter._id.toString(),
    subject,
    chapterNumber,
    weightPercent,
    snippetCount: snippets.length,
    wordCount: sourceText.split(/\s+/).filter(Boolean).length,
  });

  res.status(201).json({
    chapterId: chapter._id.toString(),
    chapterName: chapter.title,
    title: chapter.title,
    chapterNumber: chapter.chapterNumber,
    weightPercent: chapter.weightPercent,
  });
});

router.get('/', async (req: Request, res: Response) => {
  const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : undefined;

  const filter: Record<string, unknown> = { teacherId: req.userId };
  if (subject) filter.subject = subject;

  const chapters = await TextbookChapter.find(filter)
    .select('title chapterNumber weightPercent subject updatedAt')
    .sort({ chapterNumber: 1 })
    .lean();

  const totalWeightPercent = chapters.reduce((sum, c) => sum + c.weightPercent, 0);

  res.json({
    chapters: chapters.map(c => ({
      _id:           c._id.toString(),
      chapterName:   c.title,
      chapterNumber: c.chapterNumber,
      weightPercent: c.weightPercent,
      subject:       c.subject,
    })),
    totalWeightPercent,
  });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const chapter = await TextbookChapter.findById(req.params.id).lean();

  if (!chapter) {
    res.status(404).json({ error: 'Chapter not found.' });
    return;
  }

  if (chapter.teacherId.toString() !== req.userId) {
    res.status(403).json({ error: "You don't have permission to do this." });
    return;
  }

  await TextbookChapter.deleteOne({ _id: chapter._id });

  logger.info('chapter_deleted', {
    requestId: req.requestId,
    userId: req.userId,
    chapterId: req.params.id,
  });

  res.status(200).json({ success: true });
});

export default router;
