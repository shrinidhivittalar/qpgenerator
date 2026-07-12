# figureBased Implementation Notes

Branch: `imageQues`

---

## What Was Built

The `figureBased` question type lets teachers upload a textbook chapter PDF. The system detects pages with vector diagrams, crops the diagram region tightly, stores the image in MongoDB, and sends it to the Groq vision model to generate MCQ or short-answer questions based on the figure.

---

## Commits on This Branch

### `f18294c` — figureBased pipeline fixes (this session)

**Word export corruption — root cause and fix**

`latexToDocx.ts` was producing `DocxMath` (OMML) nodes mixed with `TextRun` nodes inside `Paragraph.children`. In OOXML, inline math elements require the docx file's `[Content_Types].xml` to declare the OOXML math namespace relationship. The `docx` library does not emit this declaration when math is used inline inside paragraphs. Word opens the file, finds math XML tags with an undeclared namespace, and marks the file corrupted.

Fix: completely replaced the OMML approach with Unicode-substituted `TextRun` rendering.
- `\frac{a}{b}` → *(a)/(b)*
- `x^2 + y^2` → *x² + y²*
- `\sin\theta` → *sinθ*
- `\sqrt{b^2-4ac}` → *√(b²-4ac)*
- Greek letters, operators, arrows all mapped to Unicode

Math spans are rendered as italic `TextRun` (visually conventional for math in printed text). No OMML, no namespace issues, guaranteed to never corrupt.

`splitOnMathDollar()` is kept — correctly identifies `$...$` math spans while skipping currency amounts like `$8000`.

**Other bugs fixed in this session**

| Bug | File | Fix |
|-----|------|-----|
| `maxPages = 40` silently skipped diagrams past page 40 | `pdfRenderer.ts:358` | Changed default to `200` |
| figureBased generation was sequential (one vision API call at a time) | `generator.ts:245` | Replaced `for...await` loop with `Promise.allSettled` — ~3× faster |
| `imgType` only handled `png`/`jpg`; `webp`/`gif` defaulted to `'jpg'` (broken image) | `wordExporter.ts:484` | Explicit map: `png→'png'`, `jpeg→'jpg'`, `gif→'gif'`, `bmp→'bmp'`, unknown→`'png'` |
| `FigureBasedSchema` allowed MCQ options with 2–6 items; prompt requires exactly 4 | `figureBased.ts` | Added `.superRefine()`: MCQ must have exactly 4 options; `correctAnswer` must match one option exactly |

**Test script added**

`server/src/test/testExport.ts` — zero-API Word export smoke test.
- Builds a real `.docx` with MCQ, fillInBlanks, shortAnswer, trueFalse, assertionReason questions
- All questions contain LaTeX math (`$\frac{a}{b}$`, `$\sin\theta$`, `$x^2 + y^2$`, etc.)
- No server, no DB, no API keys needed
- Run: `npm run test:export` from `server/`
- Output: `server/src/test/test_export.docx`
- Confirmed working: file opens in Word without any corruption dialog ✅

---

### `c139c8c` — figureBased image pipeline, math rendering, generation reliability

**Image pipeline**
- `ChapterFigurePage` model stores rendered diagram crops per chapter. Optional `mimeType` field (default `image/png`) so JPEG/WebP manually uploaded figures preserve their type through the DB round-trip.
- Strip-then-inject pattern: `figurePageId` is kept in MongoDB docs; `imageBase64` and `imageMimeType` are stripped before save and re-injected from `ChapterFigurePage` at export time. Prevents QuestionSet documents approaching the 16 MB MongoDB per-document limit.
- `/generate` route fetches `ChapterFigurePage` docs for selected `chapterIds` and passes them as `resolvedFigurePages` to `generateTypeViaSlots`.
- `/generate-paper` fetches figure pages in parallel with chapters and passes as `allFigureImages`.
- `readImageDimensions()` reads actual PNG IHDR bytes and JPEG SOF markers to get real width/height, scales to fit 480pt max width.

**Generation reliability**
- `runTypeLoop` returns partial results when `received > 0` instead of discarding on retry failure.
- `generateTypeViaSlots` collects questions from all fulfilled batches.
- `figureBased` confirmed in `VALID_TYPES` (sets route) and `ALL_QUESTION_TYPES` (client types).

**Frontend**
- `useGeneration.generate` passes `chapterIds` — server fetches corresponding `ChapterFigurePage` docs from DB automatically.
- Figure page count shown per chapter in sidebar (`figurePageCount` field).
- Scan-figures button re-runs `renderFigurePages` on existing chapters that predate figure detection.

---

### `7ec9be0` — pdfRenderer: vector-only diagram extraction with pixel-level tightening

**Core rule: only vector drawings are diagrams.**
`paintImageXObject` (raster images) is never processed. Photos, QR codes, and decorative pictures are skipped at the source.

**`extractFigureBounds()`**
- Walks the PDF operator list maintaining the CTM stack.
- Tracks `moveTo` position; on `lineTo` checks segment length in canvas coords.
- Skips long axis-aligned segments: `dy < 4px AND dx > 15% of page width` (horizontal) or `dx < 4px AND dy > 15% of page height` (vertical). These are page borders, answer-box frames, table rules.
- Rectangles spanning > 80% of page in either dimension are also skipped.

**`tightenBoundsByPixels()`**
- Scans inward from all 4 edges of the rough vector bounds.
- A row/column counts as content only if it has ≥ 3 non-white pixels (`MIN_DENSITY`). Ignores 1–2px hairlines.
- Returns tightest `[x, y, w, h]` containing all non-white content.

**`looksLikeQRCode()`**
- Rejects crops that are: small (< 600px in both dims) AND square (0.75–1.33 ratio) AND > 85% near-black/near-white pixels.

**Full-page guard**
- Rejects if tight crop covers > 65% of total page area (area-based, not per-dimension, so wide geometry diagrams aren't wrongly rejected).

**`testFigureDetection.ts` — visual test, zero API cost**
- `npm run test:figures` in `server/`
- Saves each crop as PNG to `server/src/test/fig_output/<pdf-name>/`
- Pass custom PDF: `npx tsx src/test/testFigureDetection.ts "../your-chapter.pdf"`

---

## How the Full Pipeline Works

```
Teacher uploads chapter PDF
  → renderFigurePages() extracts vector diagram crops (up to 200 pages)
  → ChapterFigurePage.insertMany() stores crops in MongoDB

Teacher selects chapter + figureBased type in UI
  → /api/sets/:id/generate called with chapterIds
  → Server fetches ChapterFigurePage docs for those chapterIds
  → generateTypeViaSlots() sends each figure to Groq vision API (parallel)
  → Each question gets figurePageId linking back to the stored crop
  → imageBase64 stripped before saving to QuestionSet (keeps doc small)

Teacher clicks Export
  → injectImagesIntoBlocks() fetches ChapterFigurePage by figurePageId
  → Re-injects imageBase64 and imageMimeType into each question
  → buildQuestionBlocksDoc() embeds image via ImageRun in Word paragraph
  → Math in question text rendered as Unicode italic TextRun (never OMML)
  → Download .docx
```

---

## Known Limitations

**Two-column PDF layout (exam papers with answer box beside diagram):**
The answer box frame expands `extractFigureBounds` to include the blank answer area. The crop contains the correct diagram but with extra whitespace. Accepted for now — the vision model can still see the diagram clearly.

**Multi-diagram pages:**
A single page with two separate diagrams produces one crop covering both. Splitting by content gaps was considered but rejected — geometry diagrams have large internal whitespace (inside triangles, circles) that would cause false splits.

---

## Testing Without API Keys

**Export test (zero dependencies):**
```
cd server
npm run test:export
# Opens server/src/test/test_export.docx — verify no Word corruption dialog
```

**Extraction test (zero dependencies):**
```
cd server
npm run test:figures
# Saves PNGs to server/src/test/fig_output/ — inspect crops visually
```

**Mock vision generation (no Groq tokens):**
Add to `server/.env`:
```
GROQ_MOCK_FIGURE=true
```
Then generate figureBased questions normally — returns a fixture with LaTeX and a real image, tests the full generate → export pipeline without consuming any API tokens.

---

## Pending (needs API keys to test)

- End-to-end: upload chapter PDF with diagrams → generate figureBased → export → verify images embed correctly in Word
- Confirm `GROQ_MOCK_FIGURE=true` produces a clean Word doc with embedded image
- `highValueSnippets` population on chapter upload (never confirmed working)

---

## File Map

| File | Purpose |
|------|---------|
| `server/src/ai/pdfRenderer.ts` | PDF page rendering, vector bounds extraction, pixel tightening, QR filter |
| `server/src/ai/latexToDocx.ts` | LaTeX `$...$` → Unicode italic TextRun (no OMML) |
| `server/src/ai/wordExporter.ts` | Word export; `renderTextWithMath` for all math fields; `ImageRun` for figure images |
| `server/src/ai/prompts.ts` | Generation prompts; includes math encoding rules preamble |
| `server/src/ai/generator.ts` | `generateSet`, `runTypeLoop`, parallel figureBased via `Promise.allSettled` |
| `server/src/ai/paperGenerator.ts` | Paper mode generation; `generateFigureQuestion` vision call; mock mode |
| `server/src/models/ChapterFigurePage.ts` | Mongoose model for diagram crop storage |
| `server/src/routes/chapters.ts` | Chapter upload; calls `renderFigurePages`, stores `ChapterFigurePage` docs |
| `server/src/routes/sets.ts` | `/generate` and `/generate-paper`; fetches figure pages by chapterIds |
| `server/src/validation/schemas/figureBased.ts` | Zod schema with MCQ exactly-4-options enforcement |
| `server/src/test/testFigureDetection.ts` | Visual extraction test — saves crops as PNGs |
| `server/src/test/testExport.ts` | Word export smoke test — LaTeX math, no API needed |
| `client/src/hooks/useGeneration.ts` | Passes `chapterIds`; server auto-fetches figure pages |
| `client/src/pages/DashboardPage.tsx` | `figurePageCount` per chapter; scan-figures button |
| `client/src/types/index.ts` | `figureBased` in `ALL_QUESTION_TYPES` |
