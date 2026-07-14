import { spawn }        from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger }        from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// server/figureExtractor.py — same relative path whether running from
// src/ai/ (tsx dev) or dist/ai/ (compiled prod): both resolve to server/
const SCRIPT_PATH = join(__dirname, '../../figureExtractor.py');

// Windows ships 'python'; Linux/Mac (and Render) ship 'python3'
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

export interface RenderedPage {
  pageNum:  number;
  base64:   string;
  width:    number;
  height:   number;
  isFigure: boolean;
}

export async function renderFigurePages(
  pdfBuffer: Buffer,
  maxPages = 200,
): Promise<RenderedPage[]> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_CMD, [SCRIPT_PATH, String(maxPages)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

    child.on('close', (code) => {
      if (code !== 0) {
        logger.warn('pdf_figure_python_failed', {
          code,
          error: Buffer.concat(err).toString().slice(0, 500),
        });
        resolve([]);
        return;
      }
      try {
        const pages = JSON.parse(Buffer.concat(out).toString()) as RenderedPage[];
        resolve(pages);
      } catch (parseErr) {
        logger.warn('pdf_figure_parse_failed', {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
        resolve([]);
      }
    });

    child.on('error', (spawnErr) => {
      logger.warn('pdf_figure_spawn_failed', { error: spawnErr.message });
      resolve([]);
    });

    child.stdin.write(pdfBuffer);
    child.stdin.end();
  });
}
