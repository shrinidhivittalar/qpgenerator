import { readFileSync, writeFileSync } from 'fs';
import { renderFigurePages } from '../ai/pdfRenderer.js';

async function main() {
  const buf   = readFileSync('../10th Eng Maths Part - 1 2025-26.pdf');
  const pages = await renderFigurePages(buf);
  const keep  = new Set([24, 25, 26, 27, 28, 30]);
  for (const p of pages) {
    if (keep.has(p.pageNum)) {
      const path = `src/test/crop_p${p.pageNum}.png`;
      writeFileSync(path, Buffer.from(p.base64, 'base64'));
      console.log(`saved ${path}  ${p.width}x${p.height}`);
    }
  }
}
main();
