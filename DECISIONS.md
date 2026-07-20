# QP Builder — Project Decisions & Direction

## Product Summary
A Question Paper Builder for Karnataka SSLC teachers.
Reduces paper-setting time from 3–3.5 hours to ~15–20 minutes.
Teacher-validated prototype — single-page UI confirmed as the right approach.

---

## Raw Conversation — Teacher Interview (2026-07-19)

### What the teacher said (exact points as told):

> "if we are planning to upload textbook n all for ai generation then it becomes a real issue"
>
> 1. there is something like chapter wise weightage like there is certain rules which say a teacher can give only X marks from Y lesson (like 4 marks from chapter 1 and 2 marks from chapter 2)
> 2. they release 3 model papers every year in such a way that you cannot form a new model paper in different way with the same blueprint
> 3. apparently the boards are releasing question banks and the questions are being asked only from the question bank (just for analogy if i have the right set of answers for that question bank almost textbook is a waste of time types not exactly but an analogy)
> 4. there are questions behind the lessons of each chapter and from there also its asked
> 5. so basically what i got to know is that we can use this application like an assistant like 95% can be done by this and 5 to 10% can be manually done by teachers themselves
> 6. now if i see this as a developer parsing textbooks is a waste of time and energy because previous 5 year's papers model papers and a question bank per subject is all you need is what i feel, there was a question asked "what if there is no questions itself" i feel its impossible for an institution to not have questions only and even if they don't then we can get questions from the internet because the boards which sets the question papers shall give some questions right?

### Other things confirmed in the same conversation:

- Teacher liked the prototype
- Paper setting takes 3 to 3.5 hours manually
- Single page UI is good and easy — no need for separate pages
- Blueprint is NOT fixed every year — board releases it as a PDF when required (not on a set schedule)
- We DO have access to the official board question banks
- The "what if there are no questions" scenario was raised by a colleague — not a real concern, was confirmed as basically impossible

### My response / what I took away:

> "This is gold. Let me reflect back what I'm hearing because this reshapes the entire product."
>
> - AI generation from textbooks = wrong direction, scrapped
> - Real product: previous years papers + model papers + official question bank → blueprint-aware selection
> - The "generate new questions" AI feature becomes a much smaller edge case — only needed when the pool runs dry, which she herself said is basically impossible
> - The pipeline is mostly already built — remaining work is connecting the right data to the right constraints

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

### Immediate Pending (before anything else)
- [ ] Run `py scripts/latexify_questions.py --subject science --source qp` — science QP questions (Q01–Q38) still need LaTeX conversion. Textbook questions are intentionally skipped for now.
- [ ] Get sample blueprint PDF from board (expected 2026-07-20)
- [ ] Team + boss sign-off on product direction
- [ ] Commit DECISIONS.md once direction is confirmed

### Next Immediate Step (after sign-off)
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
