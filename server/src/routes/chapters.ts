import { Router, Request, Response } from 'express';
import multer from 'multer';

import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { extractTextPerPage } from '../ai/pdfStructure.js';
import TextbookChapter from '../models/TextbookChapter.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.use(requireAuth, requireRole('teacher'));

const MAX_CHAPTER_BYTES = 20 * 1024 * 1024; // 20 MB for a single chapter

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_CHAPTER_BYTES },
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('INVALID_FILE_TYPE'));
  },
});

function handleUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, err => {
      if (!err) resolve();
      else reject(err);
    });
  });
}

// POST /api/chapters/upload
// Manual single-chapter upload — workaround for the case where the textbook
// detector splits incorrectly and the Teacher needs to add 1-2 chapters by hand.
router.post('/upload', async (req: Request, res: Response) => {
  try {
    await handleUpload(req, res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'INVALID_FILE_TYPE') {
      res.status(400).json({ error: 'Only PDF files are accepted.' });
      return;
    }
    if ((err as any)?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File size exceeds 20 MB limit.' });
      return;
    }
    res.status(400).json({ error: 'File upload failed.' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return;
  }

  const { subject, title, chapterNumber, weightPercent } = req.body as Record<string, string>;
  if (!subject?.trim() || !title?.trim() || !chapterNumber || !weightPercent) {
    res.status(400).json({ error: 'subject, title, chapterNumber, and weightPercent are required.' });
    return;
  }

  const chapterNum = parseInt(chapterNumber, 10);
  const weight     = parseFloat(weightPercent);
  if (isNaN(chapterNum) || isNaN(weight)) {
    res.status(400).json({ error: 'chapterNumber and weightPercent must be numbers.' });
    return;
  }

  let pages: string[];
  try {
    pages = await extractTextPerPage(req.file.buffer);
  } catch {
    res.status(422).json({ error: 'Could not extract text from this PDF.' });
    return;
  }

  const chapter = await TextbookChapter.create({
    teacherId:         (req as any).userId,
    subject:           subject.trim(),
    title:             title.trim(),
    chapterNumber:     chapterNum,
    weightPercent:     weight,
    sourceText:        pages.join('\n\n'),
    highValueSnippets: [],
  });

  logger.info('chapter_uploaded_manually', {
    requestId: (req as any).requestId,
    userId:    (req as any).userId,
    chapterId: chapter._id.toString(),
  });

  res.status(201).json({ chapterId: chapter._id.toString() });
});

// GET /api/chapters
router.get('/', async (req: Request, res: Response) => {
  const chapters = await TextbookChapter
    .find({ teacherId: (req as any).userId })
    .select('-sourceText -highValueSnippets')
    .sort({ subject: 1, chapterNumber: 1 })
    .lean();

  res.json(chapters.map(c => ({
    chapterId:     c._id.toString(),
    subject:       c.subject,
    title:         c.title,
    chapterNumber: c.chapterNumber,
    weightPercent: c.weightPercent,
  })));
});

export default router;
