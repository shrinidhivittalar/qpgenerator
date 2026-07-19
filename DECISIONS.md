# QP Builder — Project Decisions & Direction

## Product Summary
A Question Paper Builder for Karnataka SSLC teachers.
Reduces paper-setting time from 3–3.5 hours to ~15–20 minutes.
Teacher-validated prototype — single-page UI confirmed as the right approach.

---

## Key Decisions (from teacher interview + team discussion — 2026-07-19)

### 1. AI Question Generation from Textbooks — SCRAPPED
**Original plan:** Parse textbook PDFs with an LLM to generate new questions from raw prose.

**Why scrapped:**
- The board tests from a finite, known question pool — not from random textbook content
- Textbook parsing is expensive, noisy, and largely irrelevant to what actually gets asked
- The teacher confirmed: previous years' papers + model papers + official question bank is all you need

### 2. Real Dataset — What Actually Matters
- Previous years' question papers ✅ (already parsed and in DB)
- Textbook exercise questions ✅ (already parsed and in DB)
- Official board question bank ⬅ **next priority** (PDFs available, not yet parsed)
- Model papers (board releases 3 per year) ⬅ worth ingesting

### 3. Blueprint — Chapter-Wise Weightage Rules
- The board mandates how many marks must come from each chapter (e.g. 4 marks from Ch1, 2 marks from Ch2)
- Blueprint is released as a PDF by the board — NOT fixed every year, changes occasionally
- When it changes: teacher uploads the new PDF → we parse it → store it → auto-generate respects it
- **Need a sample blueprint PDF to design the parser** (user to provide by 2026-07-20)

### 4. UI Direction — Single Page Confirmed
- Teacher reviewed the prototype and confirmed the single-page layout feels easy and natural
- No separate pages needed — keep everything in one view

### 5. The 95/5 Rule
- Tool should handle 95% of the work automatically
- Teacher does the final 5–10% manually (review, minor edits, personal tweaks)
- This is the right bar — don't over-automate, give the teacher control at the end

### 6. "No questions available" scenario — NOT a real concern
- Raised as a hypothetical by a colleague
- In practice, every institution has questions — and even if they didn't, the board itself publishes question banks
- Not worth building for

---

## What Is Already Built (Module 1 — Complete)
- Flask backend + React frontend (single page)
- MongoDB question bank (science QP, science textbook, maths QP)
- PDF upload → Groq parse → review modal → save to DB
- PDF image extraction using figure-region rendering (captures vector graphics too)
- Supabase Storage for question images
- Question bank UI: filter, sort, expand, edit, delete individual questions
- Auto-generate paper from bank: blueprint modal, Fisher-Yates random selection
- Paper builder: drag-and-drop, rephrase via Groq, marks editing, export
- LaTeX rendering via KaTeX (math + chemistry)
- One-time migration scripts: latexify existing questions, migrate images to Supabase

---

## What Comes Next (Pending team + boss sign-off)

### Next Immediate Step
- Get sample blueprint PDF from board
- Parse official board question bank PDF and load into DB (same pipeline, add chapter tagging)

### Module 2 — Blueprint-Aware Generation
1. **Blueprint loader** — upload board's blueprint PDF, parse into chapter → marks → question type rules, review and save
2. **Blueprint-aware auto-generate** — extend existing modal to respect chapter constraints (not just type/marks)
3. **Official question bank ingestion** — tag each question with chapter number on upload

### Deferred / Out of Scope (for now)
- AI generation of brand new questions from topics
- Textbook prose parsing
- PU (Pre-University) board support — after SSLC is complete
- OCR for scanned PDFs
- Virtual scrolling for large banks

---

## Technical Stack
- **Backend:** Flask, PyMuPDF (fitz), Groq (llama-3.1-8b-instant), MongoDB Atlas, Supabase Storage
- **Frontend:** React + TypeScript + Vite, Tailwind CSS, KaTeX, dnd-kit
- **Key env vars:** MONGODB_URI, GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY (server only), VITE_SUPABASE_IMAGES_URL (frontend)
- **Git branch:** module1

---

## Open Questions (to resolve with team)
1. Is the product direction (question bank + blueprint → paper) signed off?
2. Do we have all the official question bank PDFs ready to ingest?
3. Who provides the blueprint PDF — teacher, institution, or is it publicly available?
4. Any PU board requirement in scope or strictly SSLC for now?
