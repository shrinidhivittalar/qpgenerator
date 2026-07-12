/**
 * Visual test for pdfRenderer — zero API calls, zero token cost.
 * Saves every extracted figure crop as a PNG so you can open and inspect them.
 *
 * Usage:
 *   npx tsx src/test/testFigureDetection.ts [path/to/file.pdf]
 *
 * Default PDFs (relative to /server):
 *   ../10th Eng Maths Part - 1 2025-26.pdf
 *   ../MathsStandard-SQP.pdf
 *
 * Output:  server/src/test/fig_output/<pdf-name>/page<N>_crop<K>.png
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { renderFigurePages } from '../ai/pdfRenderer.js';

const DEFAULT_PDFS = [
  '../10th Eng Maths Part - 1 2025-26.pdf',
  '../MathsStandard-SQP.pdf',
];

const OUT_ROOT = join(__dirname, 'fig_output');

async function testPdf(pdfPath: string) {
  if (!existsSync(pdfPath)) {
    console.log(`SKIP  ${pdfPath} — file not found`);
    return;
  }

  const label = basename(pdfPath, '.pdf');
  const outDir = join(OUT_ROOT, label);
  mkdirSync(outDir, { recursive: true });

  console.log(`\nProcessing: ${pdfPath}`);
  const buf = readFileSync(pdfPath);

  const start = Date.now();
  const pages = await renderFigurePages(buf);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (pages.length === 0) {
    console.log(`  → 0 figures detected (${elapsed}s)`);
    return;
  }

  // Group by pageNum (a page could theoretically yield multiple crops)
  const byPage = new Map<number, typeof pages>();
  for (const p of pages) {
    if (!byPage.has(p.pageNum)) byPage.set(p.pageNum, []);
    byPage.get(p.pageNum)!.push(p);
  }

  for (const [pageNum, crops] of byPage) {
    crops.forEach((crop, k) => {
      const fname = `page${String(pageNum).padStart(3, '0')}_crop${k + 1}.png`;
      const fpath = join(outDir, fname);
      writeFileSync(fpath, Buffer.from(crop.base64, 'base64'));
      const kb = Math.round(crop.base64.length * 0.75 / 1024);
      console.log(`  page ${pageNum}  crop ${k + 1}  ${crop.width}×${crop.height}px  ${kb} KB  → ${fname}`);
    });
  }

  console.log(`  Total: ${pages.length} crop(s) in ${elapsed}s  →  ${outDir}`);
}

async function main() {
  const args = process.argv.slice(2);
  const pdfs = args.length > 0 ? args : DEFAULT_PDFS;

  mkdirSync(OUT_ROOT, { recursive: true });

  for (const pdf of pdfs) {
    await testPdf(pdf).catch(err =>
      console.error(`ERROR  ${pdf}\n  ${err instanceof Error ? err.message : err}`)
    );
  }

  console.log('\nDone. Open the PNG files in fig_output/ to inspect the crops.');
}

main();
