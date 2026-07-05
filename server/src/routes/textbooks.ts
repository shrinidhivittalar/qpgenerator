import { Router, Request, Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';

import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { extractTextPerPage } from '../ai/pdfStructure.js';
import { extractOutline } from '../ai/pdfStructure.js';
import { detectHeadingsHeuristic } from '../ai/chapterHeuristics.js';
import { detectHeadingsViaLLM } from '../ai/chapterLlmDetection.js';
import TextbookUploadDraft from '../models/TextbookUploadDraft.js';
import TextbookChapter from '../models/TextbookChapter.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.use(requireAuth, requireRole('teacher'));

const MAX_TEXTBOOK_BYTES = 50 * 1024 * 1024; // 50 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_TEXTBOOK_BYTES },
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
});

function handleMulterUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return resolve();
      reject(err);
    });
  });
}

// Returns the character offset in `pages.join('\n\n')` where page `pageIndex` begins.
function pageIndexToCharOffset(pages: string[], pageIndex: number): number {
  let offset = 0;
  for (let i = 0; i < pageIndex && i < pages.length; i++) {
    offset += pages[i].length + 2; // +2 for the '\n\n' page separator
  }
  return offset;
}

// ── POST /api/textbooks/upload ───────────────────────────────────────────────
router.post('/upload', async (req: Request, res: Response) => {
  try {
    await handleMulterUpload(req, res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'INVALID_FILE_TYPE') {
      res.status(400).json({ error: 'Only PDF files are accepted for textbook upload.' });
      return;
    }
    if ((err as any)?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File size exceeds 50 MB limit.' });
      return;
    }
    res.status(400).json({ error: 'File upload failed.' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return;
  }

  const { subject } = req.body as Record<string, string>;
  if (!subject?.trim()) {
    res.status(400).json({ error: 'subject is required.' });
    return;
  }

  let pages: string[];
  try {
    pages = await extractTextPerPage(req.file.buffer);
  } catch {
    res.status(422).json({ error: 'Could not extract text from this PDF.' });
    return;
  }

  const fullText = pages.join('\n\n');

  if (fullText.trim().length < 100) {
    res.status(422).json({
      error:
        'Could not extract readable text from this PDF. ' +
        'It may be a scanned image. Try a PDF with a real text layer.',
    });
    return;
  }

  let candidates: { title: string; startOffset: number }[];
  let method: 'bookmark' | 'heuristic' | 'llm';

  const outline = await extractOutline(req.file.buffer);
  if (outline) {
    method = 'bookmark';
    candidates = outline.map(o => ({
      title:       o.title,
      startOffset: pageIndexToCharOffset(pages, o.pageNumber - 1),
    }));
  } else {
    const heuristic = detectHeadingsHeuristic(pages);
    if (heuristic.length >= 2) {
      method = 'heuristic';
      candidates = heuristic.map(h => {
        const pageStart   = pageIndexToCharOffset(pages, h.pageIndex);
        // Find the heading's exact byte position within this page's text so
        // the preview and word-count slices start at the heading itself, not
        // at the top of the page (which may contain pre-heading instructions).
        const titleInPage = pages[h.pageIndex].indexOf(h.title);
        return {
          title:       h.title,
          startOffset: titleInPage !== -1 ? pageStart + titleInPage : pageStart,
        };
      });
    } else {
      method = 'llm';
      const llmDetected = await detectHeadingsViaLLM(fullText);
      candidates = llmDetected.map(d => ({ title: d.title, startOffset: d.approxCharOffset }));
    }
  }

  if (candidates.length === 0) {
    res.status(422).json({
      error:
        'Could not detect any chapter structure in this textbook. ' +
        'Try uploading chapters individually instead.',
    });
    return;
  }

  // endOffset = start of the next candidate (or end of fullText for the last).
  // Content before the first detected heading (front matter, TOC, preface) is
  // discarded — it's not exam-relevant material.
  const withEndOffsets = candidates.map((c, i) => ({
    ...c,
    endOffset: i + 1 < candidates.length ? candidates[i + 1].startOffset : fullText.length,
  }));

  const draft = await TextbookUploadDraft.create({
    teacherId:  (req as any).userId,
    subject:    subject.trim(),
    fullText,
    candidates: withEndOffsets.map((c, i) => ({
      tempId:          `draft-${i}`,
      suggestedTitle:  c.title,
      suggestedNumber: i + 1,
      startOffset:     c.startOffset,
      endOffset:       c.endOffset,
      detectionMethod: method,
    })),
  });

  logger.info('textbook_uploaded', {
    requestId:       (req as any).requestId,
    userId:          (req as any).userId,
    draftId:         draft._id.toString(),
    detectionMethod: method,
    candidateCount:  draft.candidates.length,
  });

  res.status(201).json({
    draftId:         draft._id,
    detectionMethod: method,
    chapters:        draft.candidates.map(c => ({
      tempId:          c.tempId,
      suggestedTitle:  c.suggestedTitle,
      suggestedNumber: c.suggestedNumber,
      preview:         fullText.slice(c.startOffset, c.startOffset + 300),
      wordCount:       fullText.slice(c.startOffset, c.endOffset).split(/\s+/).length,
    })),
  });
});

// ── POST /api/textbooks/:draftId/confirm ────────────────────────────────────

interface ConfirmChapterEntry {
  tempId:            string;
  title:             string;
  chapterNumber:     number;
  weightPercent:     number;
  mergeWithTempIds?: string[];
  highValueSnippets?: string[];
}

interface ConfirmBody {
  chapters:          ConfirmChapterEntry[];
  excludedTempIds?:  string[];
}

router.post('/:draftId/confirm', async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.draftId)) {
    res.status(404).json({ error: 'Draft not found.' });
    return;
  }

  const draft = await TextbookUploadDraft.findById(req.params.draftId);
  if (!draft) {
    res.status(404).json({ error: 'Draft not found.' });
    return;
  }
  if (draft.teacherId.toString() !== (req as any).userId) {
    res.status(403).json({ error: "You don't have permission to confirm this draft." });
    return;
  }

  const { chapters, excludedTempIds = [] } = req.body as ConfirmBody;

  if (!Array.isArray(chapters) || chapters.length === 0) {
    res.status(400).json({ error: 'chapters must be a non-empty array.' });
    return;
  }

  const excluded = new Set(excludedTempIds);
  const active   = chapters.filter(c => !excluded.has(c.tempId));

  if (active.length === 0) {
    res.status(400).json({ error: 'No chapters remain after applying excludedTempIds.' });
    return;
  }

  // Index draft candidates by tempId for O(1) lookup during merge resolution
  const candidateMap = new Map(draft.candidates.map(c => [c.tempId, c]));

  const created: string[] = [];

  for (const entry of active) {
    const primary = candidateMap.get(entry.tempId);
    if (!primary) continue; // tempId not in draft — skip silently

    // Collect segments: primary + any merges, then sort by startOffset so the
    // concatenated text reads in document order regardless of array order.
    const segments = [primary];
    for (const mergeTempId of entry.mergeWithTempIds ?? []) {
      const extra = candidateMap.get(mergeTempId);
      if (extra) segments.push(extra);
    }
    segments.sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));

    const sourceText = segments
      .map(s => draft.fullText.slice(s.startOffset ?? 0, s.endOffset ?? draft.fullText.length))
      .join('\n\n');

    const chapter = await TextbookChapter.create({
      teacherId:         (req as any).userId,
      subject:           draft.subject,
      title:             entry.title,
      chapterNumber:     entry.chapterNumber,
      weightPercent:     entry.weightPercent,
      sourceText,
      highValueSnippets: entry.highValueSnippets ?? [],
    });

    created.push(chapter._id.toString());
  }

  // Soft-warn — not blocking — if weights don't sum to ~100
  const totalWeight  = active.reduce((sum, c) => sum + (c.weightPercent ?? 0), 0);
  const weightWarning =
    Math.abs(totalWeight - 100) > 1
      ? `Chapter weights sum to ${totalWeight.toFixed(1)}%, not 100%. You can adjust them later.`
      : undefined;

  logger.info('textbook_confirmed', {
    requestId:    (req as any).requestId,
    userId:       (req as any).userId,
    draftId:      draft._id.toString(),
    chaptersCreated: created.length,
    totalWeight,
  });

  await draft.deleteOne();

  const response: Record<string, unknown> = { chapterIds: created, count: created.length };
  if (weightWarning) response.weightWarning = weightWarning;
  res.status(201).json(response);
});

export default router;
