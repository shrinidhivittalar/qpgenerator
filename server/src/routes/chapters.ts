import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Types } from 'mongoose';

import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { extractText } from '../ai/extractor.js';
import { renderFigurePages } from '../ai/pdfRenderer.js';
import TextbookChapter from '../models/TextbookChapter.js';
import ChapterFigurePage from '../models/ChapterFigurePage.js';
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

  // Render figure pages and store each as its own document — keeps the
  // chapter document small regardless of how large the source PDF is.
  try {
    const figurePages = await renderFigurePages(req.file.buffer);
    if (figurePages.length > 0) {
      await ChapterFigurePage.insertMany(
        figurePages.map(p => ({
          chapterId: chapter._id,
          teacherId: req.userId,
          pageNum:   p.pageNum,
          base64:    p.base64,
          width:     p.width,
          height:    p.height,
        })),
      );
    }
    logger.info('figure_pages_stored', {
      requestId: req.requestId,
      userId: req.userId,
      chapterId: chapter._id.toString(),
      count: figurePages.length,
    });
  } catch (err) {
    logger.warn('figure_pages_render_failed', {
      requestId: req.requestId,
      chapterId: chapter._id.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }

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

  const [chapters, figureCounts] = await Promise.all([
    TextbookChapter.find(filter)
      .select('title chapterNumber weightPercent subject updatedAt')
      .sort({ chapterNumber: 1 })
      .lean(),
    ChapterFigurePage.aggregate([
      { $match: { teacherId: new Types.ObjectId(req.userId) } },
      { $group: { _id: '$chapterId', count: { $sum: 1 } } },
    ]),
  ]);

  const figureCountMap = new Map(
    (figureCounts as Array<{ _id: unknown; count: number }>)
      .map(f => [f._id?.toString() ?? '', f.count]),
  );

  const totalWeightPercent = chapters.reduce((sum, c) => sum + c.weightPercent, 0);

  res.json({
    chapters: chapters.map(c => ({
      _id:             c._id.toString(),
      chapterName:     c.title,
      chapterNumber:   c.chapterNumber,
      weightPercent:   c.weightPercent,
      subject:         c.subject,
      figurePageCount: figureCountMap.get(c._id.toString()) ?? 0,
    })),
    totalWeightPercent,
  });
});

router.post('/:id/scan-figures', async (req: Request, res: Response) => {
  try {
    await handleMulterUpload(req, res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'NON_PDF') {
      res.status(400).json({ error: 'Only PDF files are accepted.' });
      return;
    }
    res.status(400).json({ error: 'File upload failed.' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return;
  }

  const chapter = await TextbookChapter.findById(req.params.id).lean();
  if (!chapter) {
    res.status(404).json({ error: 'Chapter not found.' });
    return;
  }
  if (chapter.teacherId.toString() !== req.userId) {
    res.status(403).json({ error: "You don't have permission to do this." });
    return;
  }

  try {
    const figurePages = await renderFigurePages(req.file.buffer);
    await ChapterFigurePage.deleteMany({ chapterId: chapter._id });
    if (figurePages.length > 0) {
      await ChapterFigurePage.insertMany(
        figurePages.map(p => ({
          chapterId: chapter._id,
          teacherId: req.userId,
          pageNum:   p.pageNum,
          base64:    p.base64,
          width:     p.width,
          height:    p.height,
        })),
      );
    }
    logger.info('figure_pages_rescanned', {
      requestId: req.requestId,
      userId: req.userId,
      chapterId: chapter._id.toString(),
      count: figurePages.length,
    });
    res.json({ figurePageCount: figurePages.length });
  } catch (err) {
    logger.warn('figure_pages_render_failed', {
      requestId: req.requestId,
      chapterId: chapter._id.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Figure detection failed.' });
  }
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

  await Promise.all([
    TextbookChapter.deleteOne({ _id: chapter._id }),
    ChapterFigurePage.deleteMany({ chapterId: chapter._id }),
  ]);

  logger.info('chapter_deleted', {
    requestId: req.requestId,
    userId: req.userId,
    chapterId: req.params.id,
  });

  res.status(200).json({ success: true });
});

export default router;
