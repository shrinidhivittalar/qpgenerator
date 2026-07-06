import { Router, Request, Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';

import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { extractSchemeText } from '../ai/extractor.js';
import { parseSchemeBlueprint, TypeConfig } from '../ai/schemeParser.js';
import Scheme from '../models/Scheme.js';
import { logger } from '../lib/logger.js';
import { ExamBlueprint, blueprintToTypeConfig } from '../validation/schemas/examBlueprint.js';

const router = Router();

router.use(requireAuth, requireRole('teacher'));

const MAX_SCHEME_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIMES: Record<string, true> = {
  'application/pdf': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SCHEME_BYTES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES[file.mimetype]) cb(null, true);
    else cb(new Error('INVALID_FILE_TYPE'));
  },
});

function toPreviewSections(parsedConfig: TypeConfig[]): string[] {
  return parsedConfig.map(
    tc => `${tc.type} (${tc.count} x ${tc.marksPerQuestion} mark${tc.marksPerQuestion !== 1 ? 's' : ''})`,
  );
}

function handleMulterUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return resolve();
      reject(err);
    });
  });
}

async function runUpload(req: Request, res: Response): Promise<
  { rawText: string; fileType: 'pdf' | 'docx' } | null
> {
  try {
    await handleMulterUpload(req, res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'INVALID_FILE_TYPE') {
      res.status(400).json({ error: 'Only PDF and Word (.docx) files are accepted.' });
      return null;
    }
    if ((err as any)?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File size exceeds 5 MB limit.' });
      return null;
    }
    res.status(400).json({ error: 'File upload failed.' });
    return null;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return null;
  }

  try {
    const { text, fileType } = await extractSchemeText(req.file.buffer, req.file.mimetype);
    return { rawText: text, fileType };
  } catch {
    res.status(422).json({ error: 'Could not extract text from this file.' });
    return null;
  }
}

function mergeDuplicateTypes(config: TypeConfig[]): TypeConfig[] {
  const merged = new Map<string, TypeConfig>();
  for (const tc of config) {
    const key = `${tc.type}:${tc.marksPerQuestion}`;
    if (merged.has(key)) merged.get(key)!.count += tc.count;
    else merged.set(key, { ...tc });
  }
  return Array.from(merged.values());
}

async function runParseScheme(
  rawText: string,
  res: Response,
  metadata: { name?: string; subject?: string; standard?: string; examType?: string },
): Promise<{ parsedConfig: TypeConfig[]; examBlueprint: ExamBlueprint } | null> {
  try {
    const examBlueprint = await parseSchemeBlueprint(rawText, metadata);
    const parsedConfig = mergeDuplicateTypes(blueprintToTypeConfig(examBlueprint));
    if (parsedConfig.length === 0) throw new Error('SCHEME_PARSE_FAILED');
    return { parsedConfig, examBlueprint };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'SCHEME_PARSE_FAILED') {
      res.status(422).json({ error: 'Could not parse a valid question configuration from this scheme.' });
    } else {
      res.status(503).json({ error: 'AI service unavailable. Please try again.' });
    }
    return null;
  }
}

router.post('/upload', async (req: Request, res: Response) => {
  const extracted = await runUpload(req, res);
  if (!extracted) return;
  const { rawText, fileType } = extracted;

  const { name, subject, standard, examType } = req.body as Record<string, string>;
  if (!name?.trim() || !subject?.trim() || !standard?.trim()) {
    res.status(400).json({ error: 'name, subject, and standard are required.' });
    return;
  }

  const metadata = {
    name: name.trim(),
    subject: subject.trim(),
    standard: standard.trim(),
    examType: examType?.trim() ?? '',
  };
  const parsed = await runParseScheme(rawText, res, metadata);
  if (!parsed) return;
  const { parsedConfig, examBlueprint } = parsed;

  const scheme = await Scheme.create({
    teacherId: (req as any).userId,
    name: metadata.name.slice(0, 100),
    subject: metadata.subject,
    standard: metadata.standard,
    examType: metadata.examType,
    rawText,
    parsedConfig,
    examBlueprint,
    fileType,
  });

  logger.info('scheme_uploaded', {
    requestId: (req as any).requestId,
    userId: (req as any).userId,
    schemeId: scheme._id.toString(),
    fileType,
    typesFound: parsedConfig.length,
    sectionsFound: examBlueprint.sections.length,
  });

  res.status(201).json({
    schemeId: scheme._id.toString(),
    name: scheme.name,
    subject: scheme.subject,
    standard: scheme.standard,
    examType: scheme.examType,
    parsedConfig,
    examBlueprint,
    previewSections: toPreviewSections(parsedConfig),
  });
});

router.get('/', async (req: Request, res: Response) => {
  const schemes = await Scheme
    .find({ teacherId: (req as any).userId })
    .select('-rawText')
    .sort({ updatedAt: -1 })
    .lean();

  res.json(
    schemes.map(s => ({
      schemeId: s._id.toString(),
      name: s.name,
      subject: s.subject,
      standard: s.standard,
      examType: s.examType,
      fileType: s.fileType,
      parsedConfig: s.parsedConfig,
      examBlueprint: s.examBlueprint ?? null,
      updatedAt: s.updatedAt,
    })),
  );
});

router.get('/:id', async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Scheme not found.' });
    return;
  }

  const scheme = await Scheme.findById(req.params.id).lean();
  if (!scheme) {
    res.status(404).json({ error: 'Scheme not found.' });
    return;
  }
  if (scheme.teacherId.toString() !== (req as any).userId) {
    res.status(403).json({ error: "You don't have permission to view this scheme." });
    return;
  }

  res.json({
    schemeId: scheme._id.toString(),
    name: scheme.name,
    subject: scheme.subject,
    standard: scheme.standard,
    examType: scheme.examType,
    fileType: scheme.fileType,
    parsedConfig: scheme.parsedConfig,
    examBlueprint: scheme.examBlueprint ?? null,
    rawText: scheme.rawText,
    updatedAt: scheme.updatedAt,
  });
});

router.patch('/:id/replace', async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Scheme not found.' });
    return;
  }

  const existing = await Scheme.findById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Scheme not found.' });
    return;
  }
  if (existing.teacherId.toString() !== (req as any).userId) {
    res.status(403).json({ error: "You don't have permission to update this scheme." });
    return;
  }

  const extracted = await runUpload(req, res);
  if (!extracted) return;
  const { rawText, fileType } = extracted;

  const { name, subject, standard, examType } = req.body as Record<string, string>;
  const metadata = {
    name: name?.trim() || existing.name,
    subject: subject?.trim() || existing.subject,
    standard: standard?.trim() || existing.standard,
    examType: examType !== undefined ? examType?.trim() ?? '' : existing.examType,
  };

  const parsed = await runParseScheme(rawText, res, metadata);
  if (!parsed) return;
  const { parsedConfig, examBlueprint } = parsed;

  existing.name = metadata.name.slice(0, 100);
  existing.subject = metadata.subject;
  existing.standard = metadata.standard;
  existing.examType = metadata.examType;
  existing.rawText = rawText;
  existing.parsedConfig = parsedConfig as any;
  existing.examBlueprint = examBlueprint as any;
  existing.fileType = fileType;
  await existing.save();

  res.json({
    schemeId: existing._id.toString(),
    name: existing.name,
    subject: existing.subject,
    standard: existing.standard,
    examType: existing.examType,
    fileType: existing.fileType,
    parsedConfig,
    examBlueprint,
    updatedAt: existing.updatedAt,
  });
});

router.delete('/:id', async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Scheme not found.' });
    return;
  }

  const scheme = await Scheme.findById(req.params.id);
  if (!scheme) {
    res.status(404).json({ error: 'Scheme not found.' });
    return;
  }
  if (scheme.teacherId.toString() !== (req as any).userId) {
    res.status(403).json({ error: "You don't have permission to delete this scheme." });
    return;
  }

  await scheme.deleteOne();
  res.json({ success: true });
});

export default router;
