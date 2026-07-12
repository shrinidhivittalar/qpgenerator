import { createCanvas } from 'canvas';
import { logger } from '../lib/logger.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const RENDER_SCALE    = 2.08;
const CROP_PADDING    = 24;   // px of whitespace kept around detected figure
const MIN_FIG_PX      = 80;   // crop must be at least this many px wide AND tall
const WHITE_THRESHOLD = 242;  // pixel luminance ≥ this is treated as white background
const QR_MAX_PX       = 600;  // QR codes in textbooks are never larger than this (canvas px)

const FIGURE_PHRASES = [
  'in the figure', 'in figure', 'the given figure',
  'refer to the diagram', 'as shown', 'the following figure',
  'the diagram', 'the picture', 'the graph', 'the chart',
  'using the figure', 'from the figure',
];

export interface RenderedPage {
  pageNum:  number;
  base64:   string;
  width:    number;
  height:   number;
  isFigure: boolean;
}

// ── Canvas factory ────────────────────────────────────────────────────────────
class NodeCanvasFactory {
  create(w: number, h: number) {
    const canvas = createCanvas(w, h);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(pair: { canvas: ReturnType<typeof createCanvas> }, w: number, h: number) {
    pair.canvas.width  = w;
    pair.canvas.height = h;
  }
  destroy(pair: { canvas: ReturnType<typeof createCanvas> }) {
    pair.canvas.width  = 0;
    pair.canvas.height = 0;
  }
}

// ── Matrix helpers ────────────────────────────────────────────────────────────
// PDF matrix [a, b, c, d, e, f] represents:
//   | a  c  e |
//   | b  d  f |
//   | 0  0  1 |
type Matrix = [number, number, number, number, number, number];

function matMul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0]*b[0] + a[2]*b[1],
    a[1]*b[0] + a[3]*b[1],
    a[0]*b[2] + a[2]*b[3],
    a[1]*b[2] + a[3]*b[3],
    a[0]*b[4] + a[2]*b[5] + a[4],
    a[1]*b[4] + a[3]*b[5] + a[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
}

// ── Text-gap figure detection ─────────────────────────────────────────────────
// For pages where figures are pure vector drawings (no raster image XObjects),
// the figure occupies a rectangular gap between text blocks.
// Strategy: divide the page into horizontal bands; bands with no text are the
// figure region. Returns the canvas-pixel bounding box of the largest gap.
function findFigureByTextGap(
  textItems: Array<{ transform: number[]; width: number; height: number }>,
  viewport:  { transform: number[] },
  canvasW:   number,
  canvasH:   number,
): [number, number, number, number] | null {
  if (textItems.length === 0) return null;

  const vt = viewport.transform;

  // Canvas-space bounding box of each text item
  const textBoxes: [number, number, number, number][] = [];
  for (const item of textItems) {
    const [, , , , pdfX, pdfY] = item.transform;
    const pdfW = item.width  || 0;
    const pdfH = item.height || 12;
    const cx = vt[0]*pdfX + vt[2]*pdfY + vt[4];
    const cy = vt[1]*pdfX + vt[3]*pdfY + vt[5];
    const cx2 = vt[0]*(pdfX+pdfW) + vt[2]*(pdfY-pdfH) + vt[4];
    const cy2 = vt[1]*(pdfX+pdfW) + vt[3]*(pdfY-pdfH) + vt[5];
    const x = Math.min(cx, cx2), y = Math.min(cy, cy2);
    const w = Math.abs(cx2 - cx), h = Math.abs(cy2 - cy);
    if (w > 0 && h > 0) textBoxes.push([x, y, w, h]);
  }

  if (textBoxes.length < 5) return null; // too few text items — probably not a mixed page

  // Mark 10 px bands that contain text
  const BAND = 10;
  const nBands = Math.ceil(canvasH / BAND);
  const hasText = new Uint8Array(nBands);
  let textMinX = Infinity, textMaxX = -Infinity;

  for (const [bx, by, bw, bh] of textBoxes) {
    const s = Math.max(0, Math.floor(by / BAND));
    const e = Math.min(nBands - 1, Math.floor((by + bh) / BAND));
    for (let i = s; i <= e; i++) hasText[i] = 1;
    if (bx < textMinX) textMinX = bx;
    if (bx + bw > textMaxX) textMaxX = bx + bw;
  }

  // Find largest contiguous gap (run of bands with no text)
  let bestStart = -1, bestEnd = -1, bestLen = 0;
  let runStart = -1;

  for (let i = 0; i <= nBands; i++) {
    if (i < nBands && !hasText[i]) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        const len = i - runStart;
        if (len > bestLen) { bestLen = len; bestStart = runStart; bestEnd = i; }
        runStart = -1;
      }
    }
  }

  if (bestStart === -1) return null;

  const figY1 = Math.max(0, bestStart * BAND);
  const figY2 = Math.min(canvasH, bestEnd * BAND);
  const figH  = figY2 - figY1;
  const figX1 = Math.max(0, textMinX);
  const figX2 = Math.min(canvasW, textMaxX);
  const figW  = figX2 - figX1;

  if (figW < MIN_FIG_PX || figH < MIN_FIG_PX) return null;
  // If the gap is the top/bottom 10% of the page it's likely a header/footer gap — skip
  if (figY1 < canvasH * 0.1 && figY2 < canvasH * 0.2) return null;
  if (figY1 > canvasH * 0.8 && figY2 > canvasH * 0.9) return null;

  return [figX1, figY1, figW, figH];
}

// ── Figure bounds extraction ──────────────────────────────────────────────────
// Walks the PDF.js operator list, maintaining the CTM stack, and records the
// canvas-pixel bounding box of all raster images and vector paths on the page.
// Path ops inside beginText/endText blocks are skipped (font glyph outlines).
// Returns [x, y, w, h] in canvas pixels, or null if nothing meaningful found.
function extractFigureBounds(
  ops:      { fnArray: number[]; argsArray: unknown[][] },
  OPS:      Record<string, number>,
  viewport: { transform: number[] },
  canvasW:  number,
  canvasH:  number,
): [number, number, number, number] | null {
  const vt = viewport.transform; // [sx, shy, shx, sy, tx, ty]

  // PDF page coords → canvas pixels (accounts for Y-flip in the viewport)
  function toCanvas(px: number, py: number): [number, number] {
    return [
      vt[0]*px + vt[2]*py + vt[4],
      vt[1]*px + vt[3]*py + vt[5],
    ];
  }

  let ctm: Matrix  = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let inText = false;
  let curX = 0, curY = 0; // current path position in local (user) space

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function expand(lx: number, ly: number) {
    const [px, py] = applyMatrix(ctm, lx, ly);
    const [cx, cy] = toCanvas(px, py);
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }

  // Convert a user-space point to canvas pixels and return [cx, cy].
  function toCanvasPt(lx: number, ly: number): [number, number] {
    const [px, py] = applyMatrix(ctm, lx, ly);
    return toCanvas(px, py);
  }

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn   = ops.fnArray[i];
    const args = ops.argsArray[i] as number[];

    if      (fn === OPS.save)      { stack.push([...ctm] as Matrix); }
    else if (fn === OPS.restore)   { ctm = stack.pop() ?? [1,0,0,1,0,0]; }
    else if (fn === OPS.transform) { ctm = matMul(ctm, args as Matrix); }
    else if (fn === OPS.beginText) { inText = true; }
    else if (fn === OPS.endText)   { inText = false; }

    // Vector path operators — skip inside text blocks (font glyph outlines)
    else if (!inText) {
      if (fn === OPS.moveTo) {
        // Just update the current path position; don't expand yet.
        // The position will be expanded together with the lineTo if that segment
        // turns out to be a short diagram stroke (not a long border/frame line).
        curX = args[0]; curY = args[1];
      } else if (fn === OPS.lineTo) {
        const [lx, ly] = [args[0], args[1]];
        // Compute the segment (curX,curY)→(lx,ly) in canvas coords
        const [cx1, cy1] = toCanvasPt(curX, curY);
        const [cx2, cy2] = toCanvasPt(lx, ly);
        const dx = Math.abs(cx2 - cx1);
        const dy = Math.abs(cy2 - cy1);
        // Skip long axis-aligned lines — page borders, table rules, answer-box frames.
        // Threshold: > 15 % of page in one direction with < 4 px deviation in the other.
        // Diagram axes (captured separately via curveTo ops) are not harmed by this.
        const isLongHorizontal = dy < 4 && dx > canvasW * 0.15;
        const isLongVertical   = dx < 4 && dy > canvasH * 0.15;
        if (!isLongHorizontal && !isLongVertical) {
          expand(curX, curY);
          expand(lx, ly);
        }
        curX = lx; curY = ly;
      } else if (fn === OPS.rectangle) {
        const [rx, ry, rw, rh] = args;
        // Skip rectangles that span most of the page — these are page borders/frames,
        // not diagram shapes. Check in canvas pixels after applying the CTM.
        const [cx1, cy1] = toCanvasPt(rx, ry);
        const [cx2, cy2] = toCanvasPt(rx + rw, ry + rh);
        const rectW = Math.abs(cx2 - cx1);
        const rectH = Math.abs(cy2 - cy1);
        if (rectW > canvasW * 0.8 || rectH > canvasH * 0.8) continue;
        expand(rx, ry); expand(rx+rw, ry); expand(rx, ry+rh); expand(rx+rw, ry+rh);
      } else if (fn === OPS.curveTo || fn === OPS.curveTo2 || fn === OPS.curveTo3) {
        for (let j = 0; j < args.length; j += 2) expand(args[j], args[j+1]);
      }
    }
  }

  if (!isFinite(minX) || minX >= maxX || minY >= maxY) return null;

  // Normalise (canvas Y-coords can invert depending on page rotation)
  const x1 = Math.max(0, Math.floor(Math.min(minX, maxX)));
  const y1 = Math.max(0, Math.floor(Math.min(minY, maxY)));
  const x2 = Math.min(canvasW, Math.ceil(Math.max(minX, maxX)));
  const y2 = Math.min(canvasH, Math.ceil(Math.max(minY, maxY)));

  const bw = x2 - x1;
  const bh = y2 - y1;

  if (bw < MIN_FIG_PX || bh < MIN_FIG_PX) return null;

  // Reject if bounds still cover most of the page after edge-filtering —
  // something is still expanding them (e.g. axis arrows). Allow up to 80%.
  if (bw > canvasW * 0.8 && bh > canvasH * 0.8) return null;

  return [x1, y1, bw, bh];
}


// ── Pixel-level content-boundary tightening ───────────────────────────────────
// Given a loose bounding box within an already-rendered canvas, scans inward
// from each edge until it hits a non-white pixel. Returns the tightest possible
// [x, y, w, h] that still contains all the content, or null if the region is
// blank / too small after trimming.
function tightenBoundsByPixels(
  ctx:    any,
  canW:   number,
  canH:   number,
  bx: number, by: number, bw: number, bh: number,
): [number, number, number, number] | null {
  // Clamp to canvas
  bx = Math.max(0, bx);  by = Math.max(0, by);
  bw = Math.min(canW - bx, bw);  bh = Math.min(canH - by, bh);
  if (bw <= 0 || bh <= 0) return null;

  const id = ctx.getImageData(bx, by, bw, bh);
  const d  = id.data as Uint8ClampedArray;

  const isWhite = (px: number, py: number): boolean => {
    const i = (py * bw + px) * 4;
    return d[i] >= WHITE_THRESHOLD && d[i+1] >= WHITE_THRESHOLD && d[i+2] >= WHITE_THRESHOLD;
  };

  // Minimum non-white pixels per row/column to count as real content (ignores hairlines).
  const MIN_DENSITY = 3;

  let top = -1, bottom = -1, left = -1, right = -1;

  // Scan from top edge — row must have ≥ MIN_DENSITY non-white pixels
  for (let y = 0; y < bh && top === -1; y++) {
    let count = 0;
    for (let x = 0; x < bw; x++) if (!isWhite(x, y) && ++count >= MIN_DENSITY) { top = y; break; }
  }
  if (top === -1) return null;

  // Scan from bottom edge
  for (let y = bh - 1; y >= 0 && bottom === -1; y--) {
    let count = 0;
    for (let x = 0; x < bw; x++) if (!isWhite(x, y) && ++count >= MIN_DENSITY) { bottom = y; break; }
  }
  if (bottom === -1) return null;

  // Scan from left edge (within top–bottom band)
  for (let x = 0; x < bw && left === -1; x++) {
    let count = 0;
    for (let y = top; y <= bottom; y++) if (!isWhite(x, y) && ++count >= MIN_DENSITY) { left = x; break; }
  }

  // Scan from right edge (within top–bottom band)
  for (let x = bw - 1; x >= 0 && right === -1; x--) {
    let count = 0;
    for (let y = top; y <= bottom; y++) if (!isWhite(x, y) && ++count >= MIN_DENSITY) { right = x; break; }
  }

  if (left === -1 || right === -1) return null;

  const cw = right - left + 1;
  const ch = bottom - top + 1;
  if (cw < MIN_FIG_PX || ch < MIN_FIG_PX) return null;

  return [bx + left, by + top, cw, ch];
}

// ── QR code / barcode detector ────────────────────────────────────────────────
// A QR code or barcode is:
//   • small (under QR_MAX_PX in both dimensions)
//   • roughly square (aspect ratio 0.75–1.33)
//   • predominantly black-and-white (>85 % of sampled pixels)
// If all three hold, we skip the region — it is not a useful diagram.
function looksLikeQRCode(
  ctx: any,
  x: number, y: number, w: number, h: number,
): boolean {
  if (w > QR_MAX_PX || h > QR_MAX_PX) return false;
  const ratio = w / h;
  if (ratio < 0.75 || ratio > 1.33) return false;

  const id   = ctx.getImageData(x, y, w, h);
  const d    = id.data as Uint8ClampedArray;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
  let bwCount = 0, total = 0;

  for (let py = 0; py < h; py += step)
    for (let px = 0; px < w; px += step) {
      const i = (py * w + px) * 4;
      const r = d[i], g = d[i+1], b = d[i+2];
      if ((r > 200 && g > 200 && b > 200) || (r < 55 && g < 55 && b < 55)) bwCount++;
      total++;
    }

  return total > 0 && bwCount / total > 0.85;
}


// ── Public API ────────────────────────────────────────────────────────────────
export async function renderFigurePages(
  pdfBuffer: Buffer,
  maxPages   = 200,
): Promise<RenderedPage[]> {
  const factory = new NodeCanvasFactory();
  const data    = new Uint8Array(pdfBuffer);

  const pdf = await (pdfjsLib as any).getDocument({
    data,
    useWorkerFetch:  false,
    isEvalSupported: false,
    useSystemFonts:  true,
    canvasFactory:   factory,
  }).promise;

  const totalPages = Math.min((pdf as any).numPages, maxPages);
  const results: RenderedPage[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    try {
      const page     = await (pdf as any).getPage(pageNum);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const w = Math.ceil(viewport.width);
      const h = Math.ceil(viewport.height);

      const textContent = await page.getTextContent();
      const pageText    = (textContent.items as any[])
        .map((item: any) => item.str ?? '')
        .join(' ')
        .toLowerCase();

      const hasPhrase = FIGURE_PHRASES.some(p => pageText.includes(p));

      const ops  = await page.getOperatorList();
      const OPS  = (pdfjsLib as any).OPS;

      const DRAW_OPS = new Set([
        OPS.stroke, OPS.fill, OPS.fillStroke, OPS.eoFill, OPS.eoFillStroke,
        OPS.curveTo, OPS.curveTo2, OPS.curveTo3, OPS.rectangle,
      ]);

      const drawCount        = (ops.fnArray as number[]).filter(fn => DRAW_OPS.has(fn)).length;
      const hasVectorDrawing = drawCount >= 25;

      // Only vector drawings are diagrams. Pages with only raster images (photos,
      // QR codes, decorative pictures) are intentionally skipped here.
      const isFigurePage = hasPhrase || hasVectorDrawing;
      if (!isFigurePage) { page.cleanup(); continue; }

      // Locate the vector diagram's bounding box from the operator list.
      // Fall back to text-gap analysis on figure-phrase pages with no vector content.
      const bounds =
        extractFigureBounds(ops, OPS, viewport, w, h) ??
        (hasPhrase ? findFigureByTextGap(textContent.items as any[], viewport, w, h) : null);

      if (!bounds) { page.cleanup(); continue; }

      // Render the full page so we can do pixel-level analysis
      const fullPair = factory.create(w, h);
      await page.render({ canvasContext: fullPair.context, viewport }).promise;
      const ctx = fullPair.context as any;

      page.cleanup();

      const [bx, by, bw, bh] = bounds;

      // Carve out only the diagram pixels: scan inward from each edge of the rough
      // operator-list bounds until we hit actual non-white content.
      const tight = tightenBoundsByPixels(ctx, w, h, bx, by, bw, bh);
      if (!tight) { factory.destroy(fullPair); continue; }

      const [tx, ty, tw, th] = tight;

      // Reject if the tight region covers > 65 % of the total page area.
      // Using area (not per-dimension) so wide-but-short diagrams aren't dropped.
      if (tw * th > w * h * 0.65) {
        logger.info('pdf_figure_skipped', { pageNum, reason: 'full_page', bounds: [tx, ty, tw, th] });
        factory.destroy(fullPair);
        continue;
      }

      // Safety net: reject QR codes / barcodes that slipped through via figure phrases
      if (looksLikeQRCode(ctx, tx, ty, tw, th)) {
        logger.info('pdf_figure_skipped', { pageNum, reason: 'qrcode', bounds: [tx, ty, tw, th] });
        factory.destroy(fullPair);
        continue;
      }

      // Crop with padding so the diagram isn't flush against the image edge
      const px = Math.max(0, tx - CROP_PADDING);
      const py = Math.max(0, ty - CROP_PADDING);
      const pw = Math.min(w - px, tw + CROP_PADDING * 2);
      const ph = Math.min(h - py, th + CROP_PADDING * 2);

      if (pw < MIN_FIG_PX || ph < MIN_FIG_PX) { factory.destroy(fullPair); continue; }

      const cropPair = factory.create(pw, ph);
      (cropPair.context as any).drawImage(fullPair.canvas, px, py, pw, ph, 0, 0, pw, ph);
      const base64 = (cropPair.canvas as ReturnType<typeof createCanvas>)
        .toBuffer('image/png')
        .toString('base64');
      factory.destroy(cropPair);
      factory.destroy(fullPair);

      results.push({ pageNum, base64, width: pw, height: ph, isFigure: true });
      logger.info('pdf_figure_extracted', {
        pageNum, width: pw, height: ph, hasPhrase, hasVectorDrawing,
      });

    } catch (err) {
      logger.warn('pdf_page_render_failed', {
        pageNum,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
