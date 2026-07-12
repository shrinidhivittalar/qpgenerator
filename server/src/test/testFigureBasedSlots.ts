/**
 * End-to-end test for figureBased via the generateTypeViaSlots path (the UI
 * "Generate" button hits this path, not generatePaper).
 *
 * Set GROQ_MOCK_FIGURE=true in server/.env to skip the real vision API call.
 * Run with:  npx tsx src/test/testFigureBasedSlots.ts
 * from the server/ directory.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import mongoose from 'mongoose';
import { connectDB } from '../db/connect.js';
import TextbookChapter from '../models/TextbookChapter.js';
import { renderFigurePages } from '../ai/pdfRenderer.js';
import { generateTypeViaSlots } from '../ai/generator.js';
import { buildQuestionBlocksDoc } from '../ai/wordExporter.js';
import { createLimiter } from '../lib/concurrency.js';

async function main() {
  if (process.env.GROQ_MOCK_FIGURE !== 'true') {
    console.warn('GROQ_MOCK_FIGURE is not set — this will make real vision API calls.');
  }

  await connectDB();

  // Pull any existing chapter for teacherId context (figureBased ignores sourceText).
  const chapter = await TextbookChapter.findOne({ sourceText: { $exists: true, $ne: '' } }).lean();
  if (!chapter) {
    console.error('No chapters in DB. Upload one first via the UI.');
    process.exit(1);
  }

  console.log(`\nUsing chapter: "${chapter.title}" for teacherId context`);

  // Render figure pages directly from the local sample PDF.
  console.log('Rendering figure pages from MathsStandard-SQP.pdf...');
  const pdfBuf     = readFileSync('../MathsStandard-SQP.pdf');
  const figurePages = await renderFigurePages(pdfBuf);
  console.log(`  → ${figurePages.length} figure pages detected\n`);

  if (figurePages.length === 0) {
    console.error('No figure pages found in the PDF.');
    process.exit(1);
  }

  // Convert to FigureImage format expected by generateTypeViaSlots.
  const figureImages = figurePages.map(p => ({
    base64:   p.base64,
    mimeType: 'image/png' as const,
  }));

  const limiter = createLimiter(2);
  const chapterInput = {
    id: chapter._id.toString(), name: chapter.title,
    weightPercent: chapter.weightPercent, sourceText: chapter.sourceText,
    highValueSnippets: chapter.highValueSnippets,
  };

  console.log('Calling generateTypeViaSlots(figureBased, count=2, 3 marks each)...\n');
  const result = await generateTypeViaSlots(
    'figureBased',
    2,                            // count
    3,                            // marksPerQuestion (≥3 → shortAnswer subtype)
    [chapterInput],
    undefined,                    // difficulty
    chapter.teacherId.toString(),
    'formal-board-exam',
    undefined,                    // bankId
    limiter,
    0,                            // typeIndex
    undefined,                    // mapItems
    figureImages,
  );

  console.log(`Requested: ${result.requested}, Received: ${result.received}\n`);

  if (result.questions.length === 0) {
    console.error('No questions generated.');
    process.exit(1);
  }

  result.questions.forEach((q, i) => {
    console.log(`Question ${i + 1}:`);
    const displayQ = { ...(q as any) };
    if (displayQ.imageBase64) displayQ.imageBase64 = `[PNG ~${Math.round(displayQ.imageBase64.length * 0.75 / 1024)} KB]`;
    console.log(JSON.stringify(displayQ, null, 2));
    console.log();
  });

  // Build Word doc with embedded images.
  console.log('Building Word document...');
  try {
    const blocks = [{
      questionType: 'figureBased',
      totalMarks:   result.questions.reduce((s, q: any) => s + (q.marks ?? 3), 0),
      questions:    result.questions,
    }];
    const buffer  = await buildQuestionBlocksDoc('FigureBasedSlots_test', blocks);
    const outPath = 'src/test/figureBasedSlots_test_output.docx';
    writeFileSync(outPath, buffer);
    console.log(`Word export OK — ${buffer.byteLength} bytes → ${outPath}`);
  } catch (err) {
    console.error('Word export FAILED:', err instanceof Error ? err.message : String(err));
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
