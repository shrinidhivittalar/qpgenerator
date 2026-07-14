# Session Notes — 2026-07-14

## Context
Reviewed the existing reference bank / blueprint / exemplar infrastructure and identified gaps that prevent questions from feeling exactly like the target board (CBSE, VTU, etc.).

## What Already Exists (do not rebuild)
- `POST /api/reference-bank/upload` — past paper PDF → parsed into individual questions → stored in `ReferenceExemplar` model
- `exemplarRetrieval.ts` → `getExemplars()` — fetches past questions, injected into `buildPrompt()` as style examples
- `strategyPicker.ts` → `pickStrategy()` — 30% chance of drawing from history (rephrase / variant / reuse based on paper age)
- `blueprintInferencer.ts` → `inferExamBlueprint()` — reads any document and extracts examBoard, subject, tone, Bloom's distribution, marks structure
- `paperParser.ts` — splits a past paper PDF into individual typed questions

## Completed This Session
- `generateFigureQuestion()` in `paperGenerator.ts` switched from Groq (Llama 4 Scout → Maverick) to Gemini 2.0 Flash
- `GEMINI_API_KEY` added to `.env`
- `GROQ_MODEL` updated from Scout to Maverick
- **Gap 1 complete** — style extraction pipeline built and wired in

---

## Six Gaps — Build in This Order

### Gap 1 — Style patterns never extracted from past papers
**Status: DONE ✅**
Files created/modified:
- `server/src/models/BankStyleGuide.ts` — new model, stores one StyleGuide per teacher+bankId
- `server/src/ai/styleExtractor.ts` — LLM analyzes all questions in a bank, extracts command words / marks format / tone / prefer+avoid patterns / Bloom's summary / answer style
- `server/src/routes/referenceBank.ts` — fires style extraction in background after every past paper upload
- `server/src/ai/prompts.ts` — `buildPrompt()` fetches StyleGuide in parallel with exemplars, injects `BOARD STYLE GUIDE` block into every system prompt

### Gap 2 — Blueprint fields don't reach generation prompts
**Status: DONE ✅**
Files modified:
- `server/src/ai/prompts.ts` — added `globalInstructions` and `expectedAnswerStyle` to `PromptContext`; injected both as new blocks in `buildPrompt()` system prompt
- `server/src/ai/generator.ts` — added `blueprintContext?: Partial<PromptContext>` parameter to `generateTypeViaSlots()`; spread it into every `buildPrompt()` call (per-slot batch and shortfall retry)
- `server/src/routes/sets.ts` — fetch scheme blueprint **before** generation; build `schemeBlueprintContext` (board-level: `examBoard`, `institutionType`, `globalInstructions`) and per-type `typeBlueprint` map (`bloomsDistribution`, `expectedAnswerStyle` per section); thread into both the chapter slot path and non-chapter `generateSet()` path; same for the regenerate handler using stored `set.schemeId`; request `tone` wins over blueprint tone with correct precedence chain

### Gap 3 — Multi-paper synthesis missing
**Status: DONE ✅**
Files modified:
- `server/src/ai/styleExtractor.ts` — added `SYNTHESIZE_PROMPT` + private `synthesizeStyleGuides()`; added public `runBankStyleExtraction()` that groups docs by `sourceYear`, runs `extractStyleGuide()` per-year in parallel (≤40 q each), then synthesises — falls back to single-pass when ≤1 known year
- `server/src/routes/referenceBank.ts` — fire-and-forget now calls `runBankStyleExtraction` (passes `sourceYear`) instead of `extractStyleGuide`

### Gap 4 — Paper mode has zero style awareness
**Status: DONE ✅**
Files modified:
- `server/src/ai/prompts.ts` — added `examBoard`, `bloomsDistribution`, `globalInstructions`, `expectedAnswerStyle`, `styleGuide` to `LongAnswerPromptContext`; added `{{styleBlock}}` to `LONG_ANSWER_SYSTEM` template; `buildLongAnswerPrompt()` assembles the style block (command words, prefer/avoid, answer style, Bloom's, instructions) and injects it
- `server/src/ai/paperGenerator.ts` — imported `getStyleGuide`/`StyleGuide`; added `examBoard`, `bankId`, `bloomsDistribution`, `globalInstructions`, `expectedAnswerStyle` to `PaperGenerateOptions`; added internal `SlotStyleContext` interface; extended `buildSlotSystemPrompt()` with board persona + style lines (command words, marks format, prefer/avoid, cognitive level, instructions, answer style); passed `style` down through `generateObjectiveQuestion` and `generateLongAnswerQuestion`; `generatePaper()` fetches StyleGuide once via `getStyleGuide(teacherId, bankId)` and builds a `SlotStyleContext` reused for all slots
- `server/src/routes/sets.ts` — `generate-paper` handler reads `set.schemeId`/`set.bankId`, fetches blueprint from stored scheme, passes `examBoard`, `bankId`, `bloomsDistribution`, `expectedAnswerStyle`, `globalInstructions` into `PaperGenerateOptions`

### Gap 5 — Gemini figure prompt is board-agnostic
**Status: DONE ✅**
Files modified:
- `server/src/ai/paperGenerator.ts` — exported `FigureStyleHint` interface (`examBoard?`, `styleGuide?`); `generateFigureQuestion()` now accepts `style?: FigureStyleHint` and injects board persona + command words + preferred phrasing patterns + answer style (for shortAnswer subType) into the Gemini system prompt; `generateFigureQuestionForSlot()` accepts and forwards the same hint; `generatePaper()` passes `slotStyle` (already built in Gap 4) to figure calls
- `server/src/ai/generator.ts` — imports `FigureStyleHint` and `getStyleGuide`; in `generateTypeViaSlots` figure branch, fetches StyleGuide once using `teacherId + bankId` before the `Promise.allSettled`, builds `figStyle: FigureStyleHint` from blueprint context + fetched guide, passes to each `generateFigureQuestionForSlot` call

### Gap 6 — Historical draw probability too low (30%)
**Status: DONE ✅**
Files modified:
- `server/src/ai/historicalRetrieval.ts` — added `countExemplarsForType(teacherId, type)` using `.countDocuments()`
- `server/src/ai/strategyPicker.ts` — replaced single constant with three named constants: `MIN_EXEMPLARS_FOR_HIGH_DRAW=5`, `HISTORICAL_DRAW_PROBABILITY_LOW=0.30`, `HISTORICAL_DRAW_PROBABILITY_HIGH=0.55`; `pickStrategy()` accepts `exemplarCount: number = 0` and picks probability accordingly (< 5 exemplars → 30%, ≥ 5 → 55%)
- `server/src/ai/generator.ts` — calls `countExemplarsForType(teacherId, type)` once before the batch slot loop; passes `exemplarCount` to both `pickStrategy()` call sites
- `server/src/ai/__tests__/strategyPicker.test.ts` — updated all 6 existing tests to pass `exemplarCount` as 4th arg; added test 7 (adaptive branching: same `Math.random=0.40` gives `fresh` on low-bank and draws from history on high-bank) and test 8 (default `exemplarCount=0` preserved low-draw behaviour)

---

## All Six Gaps Complete ✅
All style gaps 1–6 are implemented. The board-specific question quality pipeline is fully wired end-to-end.
