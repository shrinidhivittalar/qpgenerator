import 'dotenv/config';
import { readFileSync } from 'fs';
import { renderFigurePages } from '../ai/pdfRenderer.js';

async function main() {
  const buf   = readFileSync('../MathsStandard-SQP.pdf');
  const pages = await renderFigurePages(buf);

  console.log('Figure pages detected:', pages.length);
  pages.forEach(p =>
    console.log(`  Page ${p.pageNum} — ${p.width}×${p.height}px — ${Math.round(p.base64.length * 0.75 / 1024)} KB`),
  );
}

main().catch(e => { console.error(e); process.exit(1); });
