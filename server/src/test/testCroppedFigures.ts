/**
 * Saves cropped figure pages as PNG files so we can visually inspect them.
 * Run: npx tsx src/test/testCroppedFigures.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { renderFigurePages } from '../ai/pdfRenderer.js';

async function main() {
  const buf   = readFileSync('../10th Eng Maths Part - 1 2025-26.pdf');
  const pages = await renderFigurePages(buf);

  // Save first 5 cropped figures
  const toSave = pages.slice(0, 5);
  for (const p of toSave) {
    const outPath = `src/test/fig_page${p.pageNum}.png`;
    writeFileSync(outPath, Buffer.from(p.base64, 'base64'));
    console.log(`Saved ${outPath}  ${p.width}×${p.height}px`);
  }
}

main();
