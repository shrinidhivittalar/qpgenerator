# Full Context — Product Pivot & Decision Log
**Date:** 2026-07-15
**Written by:** Shrinidhi + Claude

---

## 1. Where We Started Today

The codebase had a complex AI question generator with:
- 12 question types
- 3 input channels (scheme PDF + textbook PDF + reference bank)
- Multiple AI providers (Groq for text, OpenRouter for vision)
- Python subprocess for PDF parsing (PyMuPDF)
- 4 roles (teacher, HOD, principal, student)
- 13 planned phases

Shrinidhi felt something was fundamentally wrong and said "whatever we are doing isn't feasible at all."

---

## 2. What Was Actually Wrong

We identified 4 real problems:

**Problem 1 — Technical fragility**
- Two AI providers (Groq + OpenRouter) + Python subprocess = 3 things that break independently
- Python dependency means Render deployment needs custom buildpack
- PyMuPDF, pdf-parse, pdfjs-dist all doing overlapping things
- 10 documented bugs in SESSION_NOTES.md already

**Problem 2 — AI output quality**
- LLM-generated MCQ distractors are obviously wrong
- Short/long answer model answers are generic
- No teacher would submit AI output to HOD without heavy rewriting
- The more question types added, the worse average quality gets
- Zod validation discarding questions → retry loops → still fails sometimes

**Problem 3 — Cost and rate limits**
- Groq free tier has 30k TPM limit
- Parallel generation hits this fast
- Solvable with production API keys but that costs money

**Problem 4 — UX complexity (the biggest one)**
A teacher had to:
1. Upload scheme PDF → wait for blueprint inference
2. Upload textbook PDF (50MB) → wait for chapter detection → review candidates → confirm
3. Upload past papers for reference bank
4. Then finally configure and generate

4 steps before seeing a single question. Most teachers would drop off at step 2.

---

## 3. The Core Insight — What Teachers Actually Want

Shrinidhi mentioned this to his boss and the boss revealed:

**Smart Guru** — their previous pre-AI product was a structured question bank where teachers could select questions via dropdowns and filters (sections, headers, question types etc). Teachers liked it.

**The lesson:** Teachers don't want AI to write questions. They want to select good questions faster. They want the mechanical parts (searching, formatting, marks tallying) to be faster — not their judgment replaced.

Current system philosophy: AI generates → teacher reviews
What actually works: Teacher browses bank → teacher selects → paper assembles

These are completely opposite product philosophies. The current system was solving the wrong problem.

---

## 4. The "What If Bank Is Empty" Problem

Senior asked this exact question. Solutions discussed:

- **Option 1:** Company maintains starter bank (business burden)
- **Option 2:** AI generation as fallback when bank insufficient ✓
- **Option 3:** Cross-institution sharing (privacy concerns)
- **Option 4:** Seed with public past papers (CBSE/ICSE publish publicly)

**Decision:** Option 4 + Option 2 combined. Public past papers seed the bank. AI generation fills gaps when bank is insufficient. Generation pipeline isn't thrown away — it becomes secondary/fallback.

---

## 5. The 3 Module Architecture

Senior suggested splitting into 3 clean modules:

### Module 1 — Question Bank (PRIMARY)
**Purpose:** Build and maintain the question bank

Flow:
```
Teacher uploads past paper (PDF)
↓
OCR extracts text (handles scanned papers)
↓
AI parses text into individual questions
↓
Each question gets a confidence score
↓
High confidence (>85%) → auto marked Accepted (green)
Low confidence (<85%) → marked Needs Review (orange)
↓
Teacher sees all questions in list view
↓
Bulk accepts green ones, edits/rejects orange ones
↓
Verified questions saved to private question bank
```

### Module 2 — AI Generation (FALLBACK)
**Purpose:** Fill gaps when bank doesn't have enough questions

Flow:
```
Teacher identifies gap (e.g. need 5 more MCQs on Chapter 3)
↓
AI generates questions
↓
Teacher verifies (same verify screen as Module 1)
↓
Verified questions go into bank
↓
Then used in paper creation
```

**CRITICAL RULE:** AI NEVER generates directly into the paper. Always → bank → verify → paper.

### Module 3 — Paper Creation
**Purpose:** Assemble question paper from bank

Two modes:
1. **AI assisted:** Teacher says "give me 10 MCQs 2 marks each from Chapter 3" → AI picks from bank
2. **Manual:** Teacher browses bank, selects/drags questions themselves

Then:
```
Questions assembled with marks tally and sections
↓
HOD reviews and approves
↓
Export to Word or PDF
```

---

## 6. The Core Principle (Non Negotiable)

```
Past papers → parse → verify → BANK
AI generation → verify → BANK
                              ↓
                         Paper creation
```

**Everything goes through the bank. Always. Nothing reaches the paper without human verification first.**

This solves the quality problem completely. You're not trusting AI output. You're trusting the teacher's verified bank.

---

## 7. Why The Verify Screen Is The Most Critical UI

If verification is tedious → teachers rubber stamp everything → bank fills with garbage → product fails

If verification is fast and easy → teachers engage → bank quality stays high → product succeeds

**Solution designed:**
- Default: List view showing all questions at once as a table
- Each row: checkbox, question text (truncated), tags (subject/type/marks), status badge, edit button
- Select all → Accept all in one click
- Edit only the ones marked Needs Review
- Toggle to One by One mode for careful review
- Progress counter: "45 extracted, 12 accepted"
- Save to Bank button shows count

**Analogy:** Like Gmail — you don't open every email one by one. You see the list, select all, mark as read. Open only ones that need attention.

---

## 8. OCR Explanation

Most Indian school past papers are scanned PDFs — physical papers scanned back to PDF. pdf-parse gets nothing from these (just images, no text layer).

OCR (Optical Character Recognition) reads the image pixels and converts to readable text.

Without OCR: Teacher uploads scanned paper → system sees blank → can't parse
With OCR: Teacher uploads scanned paper → OCR reads image → converts to text → AI parses

OCR is essential for Indian schools. Without it Module 1 barely works for real schools.

**Options evaluated:**
- Google Cloud Vision OCR (paid, very high quality)
- AWS Textract (paid, great with tables)
- Tesseract (free, open source, decent)
- OpenRouter vision model (already have access, understands context)

Decision: Use existing OpenRouter vision model for OCR — one less external dependency.

---

## 9. Confidence Score Logic

When AI extracts questions from paper it also returns a confidence score (0-1) alongside each question.

```json
{
  "question": "What is the SI unit of force?",
  "type": "MCQ",
  "marks": 1,
  "confidence": 0.95
}
```

- Above 0.85 → Accepted (green badge)
- Below 0.85 → Needs Review (orange badge)

Teacher only has to focus on orange ones. Everything green can be bulk accepted. This is the answer if boss asks "how will it know which questions need review?"

---

## 10. RAG and Agentic Framework Discussion

Shrinidhi correctly identified the semantic search as RAG (Retrieval Augmented Generation).

**What RAG means here:**
- Questions in bank are indexed
- Teacher types "application based questions on photosynthesis"
- System retrieves semantically relevant questions
- Not just keyword match — understands meaning

**What Agentic RAG means (boss mentioned LangChain):**
- An AI agent that understands "give me a Class 10 CBSE Math paper, 80 marks, 3 sections"
- Agent decides what to retrieve, how many times, fills gaps automatically
- This is Module 3's future direction

**Decision on timeline:**
- MVP: Basic filters only (dropdowns for subject/class/chapter/type/marks)
- V1.1: Semantic search (basic RAG)
- V2: Agentic RAG (LangChain agent assembles paper)

Don't over-engineer. Filters cover 80% of what teachers need. They know what chapter they want.

---

## 11. Boss Conversation (2026-07-15)

Shrinidhi sent this to boss:

> "We are planning to build the solution in three modules:
> 1. Question Bank – A centralized repository to store and manage all questions.
> 2. AI Question Generation – Generates questions from textbooks, existing question papers, or other learning materials, and automatically stores them in the question bank.
> 3. Question Paper Builder – Allows users to create question papers either by using drag-and-drop from the question bank or by asking AI to fetch and optionally rephrase questions."

Boss replied: "Are you familiar with agentic frameworks? Like LangChain? Let's think on those lines… maybe one problem at a time"

When asked what to start with, boss said: **"First lets just pull out the questions from the bank and build it first — only Module 1, simple but complete workflow of pulling questions from the question bank."**

Boss only evaluates from UI/UX perspective. Doesn't care about backend implementation.

---

## 12. What Carries Over From Existing Codebase

| Component | Status | Reason |
|---|---|---|
| Auth system (4 roles) | Keep | Fully built, actually needed |
| HOD approval flow | Keep | Institutions need this |
| Word export | Keep | Teachers need Word output |
| ReferenceExemplar model | Keep | This IS the question bank |
| parsePaperIntoQuestions | Keep | The upload→parse step |
| PDF text extraction | Keep | Still needed |
| BankStyleGuide | Keep | Useful later |
| generateSet, runTypeLoop | Remove | Primary flow no longer generation |
| Slot allocator, strategy picker | Remove | Not needed |
| Blueprint inference | Remove | Not primary flow anymore |
| Vision model / figure pipeline | Remove | Out of scope |
| Three input channel complexity | Remove | Replaced by simpler model |

---

## 13. Wireframes

Created in Google Stitch. Screenshots in /stitchImages folder.

| File | Screen | Module |
|---|---|---|
| Screenshot 2026-07-15 234345.png | Dashboard | All |
| Screenshot 2026-07-15 234353.png | Upload Past Paper | Module 1 |
| newone.png | Verify Extracted Questions (updated) | Module 1 |
| Screenshot 2026-07-15 234412.png | Question Bank Browser | Module 1 |
| Screenshot 2026-07-15 234432.png | Paper Builder | Module 3 |
| Screenshot 2026-07-15 234438.png | Export | Module 3 |

**Screens 2, 3, 4 = Module 1 (building now)**
**Screens 5, 6 = Module 3 (later)**

### Screen by Screen Notes

**Dashboard:**
- Welcome message with teacher name
- Total questions in bank count
- Two prominent buttons: Upload Past Paper + Create New Paper
- Recent papers list with status (Draft/Finalized)
- Clean sidebar: Dashboard, Question Bank, My Papers, Settings

**Upload Past Paper:**
- Drag and drop + Select File button
- Supports PDF, JPG, PNG (for scanned papers)
- 3 step progress: Uploading → Reading Paper → Extracting Questions
- No technical jargon, reassuring language

**Verify Extracted Questions (the most important screen):**
- Toggle: List View (default) | One by One
- Counter: "45 questions extracted, 12 accepted"
- Accept Selected button (bulk action)
- Table rows: checkbox, question text, tags, status badge, edit icon
- Green = Accepted, Orange = Needs Review (AI confidence based)
- Save to Bank (12) button at bottom

**Question Bank Browser:**
- Left: Filters (Subject, Class/Grade, Chapter/Topic, Question Type checkboxes, Marks min-max)
- Right: Question cards with tags and Add to Paper button
- Top: Semantic search bar "Search for questions naturally..."
- Pagination at bottom

**Paper Builder (Module 3 — later):**
- Left: Paper structure with sections, questions listed, Add Question + Add Section buttons, marks tally
- Right: Live preview of paper taking shape
- Generate PDF button at bottom

**Export (Module 3 — later):**
- Full paper preview with school name, subject, class, marks, time, instructions
- Download as Word + Download as PDF buttons
- Back to Editor option

---

## 14. Business Context

- **Buyer:** School/institution (principal or admin signs contract)
- **User:** Teacher (uses daily)
- **Gatekeeper:** HOD (approves papers)
- **Model:** B2B SaaS — school pays, all teachers in school get access
- **Bank ownership:** Each institution has private bank, not shared
- **Goal:** Commercial product, sell to schools and make money

---

## 15. Tech Stack Decisions for Module 1

- **Platform:** Web app, desktop browser only (not mobile)
- **OCR:** OpenRouter vision model (reuse existing access)
- **Parsing:** LLM parses questions with confidence scores
- **Search MVP:** Basic dropdown filters
- **Search V1.1:** Semantic/RAG search
- **Agent (future):** LangChain for Module 3 paper assembly
- **Export:** Word (already built)

---

## 16. Tomorrow's Plan (2026-07-16)

1. Morning — Show boss pitch message + 6 wireframes
2. Get explicit go ahead
3. Come back and plan build in detail
4. Decide day by day what to build
5. Start coding Module 1 only

**If boss asks how confidence scoring works:**
AI returns a confidence field alongside each extracted question. Above 85% = Accepted, below = Needs Review. Teacher only edits orange ones.

**If boss asks about empty bank:**
Module 2 is the fallback — AI generates questions which go through same verification before entering bank.

**If boss asks about agentic framework:**
That's Module 3's direction — LangChain agent will pick questions from bank based on teacher's requirements. Module 1 first.

---

## 17. Pitch Message (Final Version — Ready to Send)

Sir, after thinking hard I feel the current approach of generating questions from scratch isn't the right direction — AI output isn't exam ready and it's too heavy for teachers to set up.

We're proposing a 3 module approach — first, teachers upload their past papers, AI breaks them into questions and teacher quickly verifies them, and they go into a private question bank. Second, if the bank is empty or insufficient, AI generates questions but again teacher verifies before anything enters the bank. Third, paper creation — teacher either tells AI how many questions of what type and marks and it picks from the bank, or teacher manually selects and drags questions themselves.

Nothing ever goes directly from AI into the paper — everything passes through the bank and teacher verification first.

This is Smart Guru but smarter. Most of what's already built carries over.

Would love your go ahead before I start building.
