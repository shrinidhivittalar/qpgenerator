# Product Pivot Context — Question Paper Generator
**Date:** 2026-07-15

---

## Why We Pivoted

The original system generated exam questions from scratch using AI. Three core problems:
1. AI output isn't exam-ready — MCQ distractors weak, answers generic
2. Setup too complex — teachers needed 3 separate inputs before seeing a single question
3. Too fragile — multiple AI providers + Python subprocess + 12 question types

## The Smart Guru Insight

Boss's previous product "Smart Guru" (pre-AI era) was a structured question bank where teachers could select questions via filters. Teachers liked it. The lesson: **teachers don't want AI to write questions, they want to select good questions faster.**

---

## New Direction — 3 Modules

### Module 1 — Question Bank (PRIMARY — building first)
- Teacher uploads past papers (PDF, scanned or digital)
- OCR handles scanned papers (most Indian school papers are scanned)
- AI parses into individual questions with confidence scores
- High confidence → auto marked Accepted
- Low confidence → marked Needs Review
- Teacher verifies in bulk (list view default) or one by one
- Verified questions go into private question bank per institution
- Teacher searches bank semantically and filters by subject/class/chapter/type/marks
- Selects questions for paper

### Module 2 — AI Generation (FALLBACK)
- When bank is empty or insufficient
- AI generates questions
- Teacher verifies before anything enters the bank
- AI NEVER writes directly to paper — always goes through bank + verification first

### Module 3 — Paper Creation
- Two modes:
  1. Tell AI requirements (10 MCQs, 2 marks each, Chapter 3) → AI picks from bank
  2. Teacher manually selects/drags questions from bank
- Paper assembles with marks tally and sections
- HOD reviews and approves
- Export to Word or PDF

---

## Core Principle
**Everything goes through the bank. Always.**

```
Past papers → parse → verify → BANK
AI generation → verify → BANK
                              ↓
                         Paper creation
```

Nothing reaches the paper without passing through human verification first.

---

## Boss Direction (confirmed 2026-07-15)
- Build Module 1 first — simple but complete workflow
- Boss evaluates from UI/UX perspective only, doesn't care about backend
- He mentioned agentic frameworks (LangChain) — future direction
- "One problem at a time" — his exact words
- Senior is aligned on this direction

---

## Business Context
- Sold to schools/institutions (not individual teachers)
- Principal/admin pays, teachers use it, HOD approves papers
- Each institution has their own private question bank
- Based on Smart Guru model which already proved teachers like it

---

## What Carries Over From Existing Codebase
- Auth system (4 roles) — keep as is
- HOD approval flow — keep as is
- Word export — keep as is
- ReferenceExemplar model — this IS the question bank
- parsePaperIntoQuestions — the upload→parse step
- PDF text extraction — keep
- BankStyleGuide — keep

## What Gets Removed
- generateSet, runTypeLoop
- Slot allocator, strategy picker
- Blueprint inference as primary flow
- Vision model / figure pipeline
- Three input channel complexity

---

## Wireframes
6 screens created in Google Stitch, screenshots saved in /stitchImages folder:

| File | Screen | Module |
|---|---|---|
| Screenshot 2026-07-15 234345.png | Dashboard | All |
| Screenshot 2026-07-15 234353.png | Upload Past Paper | Module 1 |
| newone.png | Verify Extracted Questions | Module 1 |
| Screenshot 2026-07-15 234412.png | Question Bank Browser | Module 1 |
| Screenshot 2026-07-15 234432.png | Paper Builder | Module 3 |
| Screenshot 2026-07-15 234438.png | Export | Module 3 |

**Screens 2, 3, 4 = Module 1 (building now)**
**Screens 5, 6 = Module 3 (later)**

### Key UI Decisions
- Verify screen has List View (default) + One by One toggle
- AI auto flags questions as Accepted or Needs Review based on confidence score
- Teacher bulk accepts green ones, only edits orange ones
- Semantic search bar in Question Bank ("application questions on photosynthesis")
- Paper builder has live preview on right side with running marks tally

---

## Tech Decisions
- Web app only, desktop browser, not mobile
- OCR needed for scanned PDFs
- Confidence score returned by LLM alongside each extracted question
- MVP = basic filters only (subject/class/chapter/type/marks)
- Semantic search (RAG) = V1.1, not MVP
- No agentic RAG in MVP — filters first, agent later
- LangChain = future direction for Module 3 agent

---

## Tomorrow's Plan (2026-07-16)
1. Morning — show boss the pitch + wireframes, get go ahead
2. After confirmation — plan the actual build in detail
3. Decide what to keep/remove from existing codebase
4. Plan build day by day
5. Start coding Module 1

---

## Pitch Message (ready to send to boss)

Sir, after thinking hard I feel the current approach of generating questions from scratch isn't the right direction — AI output isn't exam ready and it's too heavy for teachers to set up.

We're proposing a 3 module approach — first, teachers upload their past papers, AI breaks them into questions and teacher quickly verifies them, and they go into a private question bank. Second, if the bank is empty or insufficient, AI generates questions but again teacher verifies before anything enters the bank. Third, paper creation — teacher either tells AI how many questions of what type and marks and it picks from the bank, or teacher manually selects and drags questions themselves.

Nothing ever goes directly from AI into the paper — everything passes through the bank and teacher verification first.

This is Smart Guru but smarter. Most of what's already built carries over.

Would love your go ahead before I start building.
