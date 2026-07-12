# figureBased Implementation Notes

Branch: `imageQues`

---

## What Was Built

The `figureBased` question type lets teachers upload a textbook chapter PDF. The system detects pages with vector diagrams, crops the diagram region tightly, stores the image, and sends it to the Groq vision model to generate MCQ or short-answer questions based on the figure.

---

## Commits on This Branch

### `c139c8c` — figureBased image pipeline, math rendering, generation reliability

**Image pipeline**
- `ChapterFigurePage` model stores rendered diagram crops per chapter, with optional `mimeType` field (default `image/png`) so JPEG/WebP manually uploaded figures preserve their type through the DB round-trip.
- Strip-then-inject pattern: `figurePageId` is kept in MongoDB docs; the actual image buffer is stripped before save and re-injected from `ChapterFigurePage` at export time.
- `/generate` endpoint now accepts `figureImages` in the request body. Manually uploaded images are persisted to `ChapterFigurePage` (with `pageNum: -1` sentinel) before calling `generateSet`, so they always have real IDs for the export step.
- `/generate-paper` fetches `ChapterFigurePage` docs in parallel with chapters and passes them as `autoFigures`.
- `readImageDimensions()` reads actual PNG IHDR bytes (offset 16–23) and JPEG SOF markers to get real width/height, then scales to fit 480pt max width. No more hardcoded dimensions.

**Math rendering**
- `latexToDocx.ts`: full LaTeX-to-OMML converter covering fractions (`\frac`), radicals (`\sqrt`), super/subscripts, Greek letters, trig functions, and bracket pairs.
- `splitOnMathDollar()`: character-by-character scanner that splits text on `$...$` math spans while skipping currency amounts like `$8000` or `$500`.
- `renderTextWithMath()`: replaces all `r(text)` calls for math-bearing fields across MCQ, fillInBlanks, assertionReason, matchTheFollowing, shortAnswer, longAnswer, mapSkill, and figureBased exports.
- Prompts preamble now includes MATH/LATEX ENCODING RULES and an explicit rule: never use `$` as currency — write `₹8000` instead.

**Generation reliability**
- `runTypeLoop` now returns partial results when `received > 0` instead of discarding them on retry failure.
- `generateTypeViaSlots` collects questions from all fulfilled batches, not just `status === 'success'` ones.
- `figureBased` confirmed in `VALID_TYPES` (sets route) and `ALL_QUESTION_TYPES` (client types).

**Frontend**
- `useGeneration.generate` passes `figureImages` from state in the `/generate` request body.
- Figure upload panel now shows in type-config mode whenever `figureBased` is selected (previously only in paper mode).

---

### `7ec9be0` — pdfRenderer: vector-only diagram extraction with pixel-level tightening

**Core rule: only vector drawings are diagrams.**
`paintImageXObject` (raster images) is never processed. Photos, QR codes, and decorative pictures are skipped at the source — they never enter the pipeline.

**`extractFigureBounds()`**
- Walks the PDF operator list maintaining the CTM stack.
- Tracks `moveTo` position separately; on `lineTo`, checks the segment length in canvas coords.
- Skips long axis-aligned segments: `dy < 4px AND dx > 15% of page width` (horizontal) or `dx < 4px AND dy > 15% of page height` (vertical). These are page borders, answer-box frames, and table rules — not diagram strokes.
- Already filtered: rectangles spanning > 80% of page in either dimension.

**`tightenBoundsByPixels()`**
- After rendering the full page, called with the rough vector bounds.
- Calls `ctx.getImageData` on that region and scans inward from each of the 4 edges.
- A row/column counts as content only if it has ≥ 3 non-white pixels (`MIN_DENSITY`). This ignores 1–2px hairlines (e.g., a thin page border) that would otherwise anchor the edge too early.
- Returns the tightest `[x, y, w, h]` that still contains all non-white content.

**`looksLikeQRCode()`**
- Safety net for pages where a figure phrase ("in the figure", "the diagram", etc.) appears near a QR code.
- Rejects if: width AND height < 600px canvas AND aspect ratio 0.75–1.33 AND > 85% of sampled pixels are near-black or near-white.

**Full-page guard**
- After tightening, rejects if `tight_w × tight_h > page_w × page_h × 0.65` (covers > 65% of page area).

**Page detection**
- `isFigurePage = hasPhrase || hasVectorDrawing` — same as original, raster images intentionally excluded.
- `hasVectorDrawing`: ≥ 25 draw ops (stroke, fill, curveTo, rectangle, etc.).

**`testFigureDetection.ts` — visual test, zero API cost**
- `npm run test:figures` in the `server/` directory.
- Runs `renderFigurePages` on PDFs, saves each crop as a PNG to `server/src/test/fig_output/<pdf-name>/`.
- No Groq calls. Inspect the PNGs manually to verify only diagrams are extracted.
- Pass a custom PDF path as an argument: `npx tsx src/test/testFigureDetection.ts "../your-chapter.pdf"`

---

## Known Limitation

**Two-column PDF layout (e.g., exam papers with an answer box beside the diagram):**
The answer box frame's left border expands `extractFigureBounds` to include the blank answer area. The crop contains the correct diagram but with extra whitespace on one side. Root cause: the frame is drawn as short line segments (under the 15% filter threshold) or as a rectangle op (under the 80% rectangle threshold).

**Fix planned:** Split a single page crop into multiple crops when there is a large horizontal content gap in the middle — the answer box and the diagram would become two separate regions, and only the diagram region would pass the QR/photo/size filters.

---

## File Map

| File | Purpose |
|------|---------|
| `server/src/ai/pdfRenderer.ts` | PDF page rendering, vector bounds extraction, pixel tightening, QR filter |
| `server/src/ai/latexToDocx.ts` | LaTeX string → OMML XML nodes for Word math |
| `server/src/ai/wordExporter.ts` | Word export; uses `renderTextWithMath` for all math-bearing fields |
| `server/src/ai/prompts.ts` | Generation prompts; includes math encoding rules preamble |
| `server/src/ai/generator.ts` | `generateSet`, `runTypeLoop`, partial result acceptance |
| `server/src/ai/paperGenerator.ts` | Paper mode generation with figure support |
| `server/src/models/ChapterFigurePage.ts` | Mongoose model for diagram crop storage |
| `server/src/routes/chapters.ts` | Chapter upload; calls `renderFigurePages`, stores `ChapterFigurePage` docs |
| `server/src/routes/sets.ts` | `/generate` and `/generate-paper`; accepts and persists `figureImages` |
| `server/src/test/testFigureDetection.ts` | Visual test script — saves crops as PNGs |
| `client/src/hooks/useGeneration.ts` | Passes `figureImages` in generate request; `applyScheme` updated |
| `client/src/pages/DashboardPage.tsx` | Figure upload panel shown in type-config mode for figureBased |
| `client/src/types/index.ts` | `figureBased` added to `ALL_QUESTION_TYPES` |
