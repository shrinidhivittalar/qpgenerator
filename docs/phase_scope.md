# Question Generator — Phase Scope & Roadmap

**Version**: 2.0  
**Last Updated**: July 2026

---

## Overview

The Question Generator platform is a **board-agnostic exam paper generator**. A teacher provides three kinds of input — pattern documents, textbook content, and reference exemplars — and the system generates a question paper that matches the detected pattern using the provided content.

```
Three input channels:

  [Scheme / Past Paper / Model Paper]  →  Blueprint Inference  →  Exam structure
  [Textbook PDF]                       →  Chapter Extraction   →  Source content
  [Previous Year Papers]               →  Reference Bank       →  Style exemplars

                        ↓ (all three feed into)

              Generation Pipeline  →  Question Paper
```

The platform is planned across **13 phases**:

```
Phase 1:   Project Foundation & Auth
Phase 2:   Role-Based Access & User Management
Phase 3:   PDF Upload & Source Extraction
Phase 4:   Blueprint Inference (Scheme / Past Paper / Model Paper → Exam Structure)
Phase 5:   Per-Type Question Generation (Count Enforcement)
Phase 6:   Textbook Upload & Chapter Management
Phase 7:   Reference Bank — Past Papers & Model Papers
Phase 8:   Connected Generation Pipeline (Wire all three inputs)
Phase 9:   Question Editing & Regeneration
Phase 10:  JSON Export with Schema Validation
Phase 11:  HOD Review & Approval Workflow
Phase 12:  Principal Analytics & Student Assessment View
Phase 13:  Security Hardening & Audit Logging
```

Phases 1–5 are complete. Phase 6 and 7 are partially built (backend upload done, not wired into generation). Phase 8 connects everything. Phases 9–13 are not yet started.

---

## Phase 1 — Project Foundation & Auth ✓

**Goal**: Monorepo, dev tooling, Express backend, MongoDB connection, and JWT authentication running locally.

### Deliverables

#### Infrastructure & Tooling
- [x] Monorepo workspace: `client/` (Vite + React) + `server/` (Express + TypeScript)
- [x] TypeScript configured across client and server
- [x] Tailwind CSS + shadcn/ui installed and themed
- [x] ESLint, Prettier configured
- [x] `npm run dev` starts both client and server concurrently from root

#### Backend
- [x] Express 5 server with TypeScript
- [x] MongoDB connection via Mongoose
- [x] `GET /api/health` endpoint returning `{ status: "ok" }`
- [x] `User` model: email, hashedPassword, name, role, department, timestamps
- [x] `POST /api/auth/register` — validation, bcrypt hash (12 rounds), JWT + refresh cookie
- [x] `POST /api/auth/login` — bcrypt compare, JWT + refresh cookie
- [x] `POST /api/auth/refresh` — rotate refresh token, issue new access token
- [x] `POST /api/auth/logout` — delete refresh token, clear cookie
- [x] `GET /api/auth/me` — return current user
- [x] `requireAuth` middleware — verify JWT, attach `req.userId` and `req.role`
- [x] `validateEnv()` — exit on startup if required variables missing
- [x] `tokens.ts` — signAccessToken, verifyAccessToken, createRefreshToken, rotateRefreshToken
- [x] `RefreshToken` model with TTL index

#### Frontend
- [x] Login page (`/login`)
- [x] Register page (`/register`) with role selector and department field
- [x] Token stored in memory (not localStorage)
- [x] Fetch interceptor: silent token refresh on 401; redirect to login if refresh fails
- [x] Route guards: unauthenticated users redirected to `/login`

---

## Phase 2 — Role-Based Access & User Management ✓

**Goal**: Role enforcement middleware in place. Each role routes to its correct landing page. Forgot-password flow complete.

### Deliverables

#### Backend
- [x] `requireRole(...roles)` middleware — returns 403 if `req.role` not in allowed set
- [x] `PasswordResetToken` model — stores SHA-256 hash of token with 1-hour TTL
- [x] `POST /api/auth/forgot-password` — always returns 200; emails reset link if email exists
- [x] `POST /api/auth/reset-password` — verifies hashed token, updates bcrypt hash, deletes record
- [x] `email.ts` service — sends reset email via nodemailer (SMTP)
- [x] `requestId` middleware — attaches UUID to every request for log correlation
- [x] Structured JSON logger with level, event, requestId, userId, role, durationMs

#### Frontend
- [x] Role-aware redirect after login: teacher → `/dashboard`, hod → `/review`, principal → `/analytics`, student → `/assessment`
- [x] Forgot password page (`/forgot-password`)
- [x] Reset password page (`/reset-password?token=<raw>`)

---

## Phase 3 — PDF Upload & Source Extraction ✓

**Goal**: Teachers can upload a source PDF. Extracted text is stored as a draft QuestionSet. Teachers can see their set list.

### Deliverables

#### Backend
- [x] `pdf-parse` installed and integrated
- [x] `extractor.ts` — `extractText(buffer): string` — throws if no text found
- [x] `multer` configured for PDF uploads (10 MB limit, PDF MIME type only)
- [x] `POST /api/source/upload` — extract text → create draft `QuestionSet` → return `setId` + preview
- [x] `QuestionSet` model: teacherId, department, fileName, sourceText, status, typeConfig, questionBlocks, generationErrors, exportHistory, hodId, hodComment, typesUnderRevision, approvedAt, submittedAt
- [x] `GET /api/sets` — list sets (teacher: own; hod: dept; principal: all)
- [x] `GET /api/sets/:id` — full set (teacher: own only)

#### Frontend
- [x] Teacher dashboard skeleton at `/dashboard`
- [x] Upload panel: drag-and-drop + browse, shows file name and word count on success
- [x] My Sets sidebar: list of sets with status chips

---

## Phase 4 — Blueprint Inference ✓ (backend), ⬜ (wiring to schemes route)

**Goal**: Teachers upload any exam-pattern document — a marking scheme, a previous year paper, or a model paper from any board. The system infers a structured exam blueprint (question types, counts, marks, difficulty, chapter weights) and pre-fills the type configurator. No board is assumed; everything is derived from the document.

This is the core of the board-agnostic design. A teacher from CBSE, ICSE, Maharashtra State Board, IB, or any university uploads their pattern document and the system learns the structure automatically.

### Deliverables

#### Backend
- [x] `mammoth` installed for Word (.docx) text extraction
- [x] `blueprintInferencer.ts` — `inferExamBlueprint(rawText, metadata): ExamBlueprint`
  - Calls Groq with a board-agnostic blueprint prompt
  - Extracts: examBoard, institutionType, subject, standard, tone, difficultyDefault, chapter weights, per-section question types/counts/marks/difficulty distribution/Bloom's distribution
  - Falls back gracefully to legacy `TypeConfig[]` format if full blueprint parse fails
- [x] `ExamBlueprint` Zod schema — validates the full blueprint object
- [x] `blueprintToTypeConfig()` — converts blueprint sections to `TypeConfig[]` for the generator
- [x] `Scheme` model — stores name, subject, standard, examType, rawText, parsedConfig, blueprint, fileType
- [ ] `POST /api/schemes/upload` — upgraded to use `inferExamBlueprint()` instead of legacy `parseScheme()`; returns full blueprint alongside `parsedConfig`
- [x] `GET /api/schemes` — list all schemes for authenticated Teacher
- [x] `GET /api/schemes/:id` — get a single scheme (own only)
- [x] `PATCH /api/schemes/:id/replace` — re-upload file, re-infer blueprint, overwrite
- [x] `DELETE /api/schemes/:id` — delete scheme (does not affect sets that used it)

#### Frontend
- [ ] Scheme picker in Step 2 of new question set flow
- [ ] Saved scheme list: Name | Subject | Board | [Use] [Replace] [Delete]
- [ ] [Use] pre-fills type configurator with blueprint's parsedConfig
- [ ] Blueprint summary panel: shows detected board, tone, difficulty, chapter list with weights
- [ ] [Upload a different scheme] opens file upload zone (PDF or .docx)
- [ ] Save prompt: "Save this scheme for future use?" with name input
- [ ] My Schemes section in dashboard sidebar

### Success Criteria
- Upload a CBSE Class 12 scheme → blueprint detects CBSE, correct sections, correct marks
- Upload a Maharashtra Board paper → blueprint reflects Maharashtra conventions, not CBSE defaults
- Upload a university mid-sem paper → blueprint infers correct structure without board assumption
- Second question set → scheme picker; selecting saved scheme pre-fills configurator instantly

---

## Phase 5 — Per-Type Question Generation ✓

**Goal**: Teachers configure types and counts; the system generates exactly the right number of questions per type, in parallel and independently.

### Deliverables

#### Backend
- [x] `prompts.ts` — per-type system prompts for all 9 question types
- [x] `generator.ts` — `generateSet()`: parallel per-type generation with `Promise.allSettled()`
- [x] `runTypeLoop()` — single-type loop: initial attempt + up to 2 retries on shortfall
- [x] Zod schemas for all 9 question types in `validation/schemas/`
- [x] `validateQuestionBlock()` — validates and discards invalid questions
- [x] `assignGlobalIds()` — sequential unique IDs across all type blocks
- [x] `withRetry(3)` + `withTimeout(30000)` on every Groq call
- [x] `POST /api/sets/:id/generate` — calls `generateSet()`, stores results
- [x] `GenerationRun` model for audit logging
- [x] `tokenBudget.ts` — daily per-user Groq token limit

#### Nine Supported Question Types
```
fillInBlanks      multipleChoice    multiSelect       matchTheFollowing
reordering        sorting           trueFalse         assertionReason
shortAnswer
```

`assertionReason` and `shortAnswer` are included because real exam patterns across boards use them. All 9 types have Zod schemas and generation prompts.

#### Frontend
- [x] Type configurator: 9 toggle cards, each with count and marks-per-question inputs
- [x] Running total: "X questions, Y total marks"
- [x] [Generate] button — disabled until at least one type has count > 0
- [x] Per-type loading, success, and failure states
- [x] Question display: collapsible blocks per type

---

## Phase 6 — Textbook Upload & Chapter Management ⬜ (upload done, wiring pending)

**Goal**: Teachers upload a full textbook PDF. The system auto-detects chapter boundaries and stores each chapter's content separately. Chapters become the primary source material for question generation — teachers select which chapters to draw from, and the blueprint's chapter weight distribution guides how many questions come from each.

### Deliverables

#### Backend
- [x] `pdfStructure.ts` — `extractTextPerPage()` and `extractOutline()` (PDF bookmark-based chapter detection)
- [x] `chapterHeuristics.ts` — `detectHeadingsHeuristic()` — heading pattern detection as fallback
- [x] `chapterLlmDetection.ts` — `detectHeadingsViaLLM()` — LLM-based chapter detection as last resort
- [x] Detection priority: bookmarks → heuristics (≥ 2 headings) → LLM
- [x] `POST /api/textbooks/upload` — extract pages → detect chapters → create `TextbookUploadDraft` with candidates
- [x] `POST /api/textbooks/:draftId/confirm` — teacher confirms/edits/merges/excludes candidates → creates `TextbookChapter` documents
- [x] `POST /api/chapters/upload` — single-chapter PDF upload (bypass draft flow for individual chapters)
- [x] `GET /api/chapters` — list teacher's stored chapters (filterable by subject)
- [x] `GET /api/chapters/:id` — get single chapter (own only)
- [x] `DELETE /api/chapters/:id` — delete chapter
- [x] `TextbookChapter` model: teacherId, subject, title, chapterNumber, weightPercent, sourceText, highValueSnippets
- [x] `TextbookUploadDraft` model: temporary candidate store during upload review
- [ ] `POST /api/sets/:id/generate` updated to accept `chapterIds[]` — uses selected chapters' `sourceText` concatenated as the generation source instead of the set's `sourceText`

#### Frontend
- [ ] "My Textbooks" section in dashboard sidebar
- [ ] Textbook upload modal: drag-and-drop, 50 MB limit
- [ ] Chapter review screen: list detected candidates with title, page range, word count preview
- [ ] Merge, rename, exclude, reorder controls on each candidate
- [ ] [Confirm chapters] → creates stored chapters, closes modal
- [ ] Chapter picker when creating a new set: select which chapters to draw from
- [ ] Selected chapters shown as tags on the type configurator

### Success Criteria
- Upload a 400-page textbook → chapters detected; teacher reviews and confirms
- Chapter bookmarks present → detected immediately via PDF outline, no LLM call needed
- No bookmarks → heuristic heading detection used; LLM as final fallback
- Select 3 chapters → generation uses only those chapters' text as source material
- Blueprint chapter weights influence question distribution across selected chapters

---

## Phase 7 — Reference Bank — Past Papers & Model Papers ⬜ (upload done, wiring pending)

**Goal**: Teachers upload previous year papers and model papers. The system parses them into individual exemplar questions (by type) and stores them in the teacher's reference bank. During generation, the system retrieves relevant exemplars and uses them as style and format context — the generator is shown "here is how questions of this type look in this exam pattern" before generating new ones.

### Deliverables

#### Backend
- [x] `paperParser.ts` — `parsePaperIntoQuestions()` — LLM parses a past paper into individual question objects, each tagged with a `questionType`
- [x] `ReferenceExemplar` model: teacherId, bankId, questionType, rawText, subject, sourceYear, chapterId
- [x] `POST /api/reference-bank/upload` — extract text → parse into exemplars → store
- [x] `GET /api/reference-bank` — list teacher's banks (distinct bankIds)
- [ ] `GET /api/reference-bank/:bankId/exemplars` — list exemplars in a bank (filterable by type, chapter)
- [ ] `DELETE /api/reference-bank/:bankId` — delete all exemplars in a bank
- [ ] `generator.ts` updated: when `bankId` is provided, retrieve up to 3 exemplars per type from the bank and inject them into the type's generation prompt as format examples
- [ ] Exemplar injection format: "Here are examples of how this question type appears in this exam pattern: [exemplar 1] ... [exemplar 2] ..."

#### Frontend
- [ ] "Reference Banks" section in dashboard sidebar
- [ ] Upload past paper: drag-and-drop + year + subject + optional bankId label
- [ ] Bank list: bank name | question count | year range | [Delete]
- [ ] Exemplar count breakdown per type shown on bank card
- [ ] Bank picker on type configurator: "Use style from [bank name]" selector

### Success Criteria
- Upload 3 previous year CBSE papers → exemplars parsed and stored; bank shows correct type breakdown
- Upload 2 Maharashtra board papers as a separate bank → two distinct banks available
- Select a bank on generation → Groq receives exemplar context for each type; output style matches the uploaded papers
- No bank selected → generation proceeds without exemplar context (no regression)

---

## Phase 8 — Connected Generation Pipeline ⬜

**Goal**: Wire all three input channels into the generation pipeline. After this phase, a teacher can select a blueprint (from a scheme), select chapters (from a textbook), select a reference bank (from past papers), and generate a question paper that matches the detected pattern in content and style.

This is the phase that makes the tool a complete, board-agnostic system.

### Deliverables

#### Backend
- [ ] `POST /api/sets/:id/generate` — accepts and uses all three inputs together:
  - `chapterIds[]` → concatenate chapter sourceTexts as the generation source
  - `bankId` → retrieve exemplars per type; inject into each type's prompt
  - `schemeId` → use stored blueprint's parsedConfig as typeConfig (teacher can override)
  - `difficultyDefault` + per-type `difficulty` → passed to per-type prompts
  - `tone` → passed to per-type prompts (formal-board-exam | neutral | conversational)
- [ ] `generator.ts` — `generateSet()` updated to accept `ExemplarContext` and `tone`/`difficulty` per type
- [ ] Per-type prompts in `prompts.ts` updated to include: tone instruction, difficulty instruction, exemplar block (when provided)
- [ ] Blueprint chapter weights applied when multiple chapters are selected: questions per chapter proportional to `weightPercent`
- [ ] `QuestionSet` model updated: stores `chapterIds[]` used for this generation run

#### Frontend
- [ ] Step 3 of dashboard flow: "Configure Generation" panel shows
  - Active blueprint summary (board, tone, difficulty)
  - Selected chapters with word count
  - Active reference bank name
  - Final type configurator (editable even if pre-filled from blueprint)
- [ ] [Generate] uses all three inputs in the API call
- [ ] Generation result shows which chapters and bank were used (as metadata on the result panel)

### Success Criteria
- Upload ICSE scheme + ICSE textbook (3 chapters) + 2 past ICSE papers → generate → output matches ICSE question style, uses textbook content, follows detected pattern
- Same textbook, different scheme (university) → output structure matches university pattern
- Teacher overrides blueprint count for one type → override respected; other types use blueprint values
- No textbook selected → falls back to source PDF text (Phase 3 behaviour)
- No reference bank selected → generates without exemplar context

---

## Phase 9 — Question Editing & Regeneration ⬜

**Goal**: Teachers can edit individual questions inline and regenerate a specific type without affecting others.

### Deliverables

#### Backend
- [ ] `PATCH /api/sets/:id/questions/:questionId` — update individual question fields; validate against type schema before saving; ownership check
- [ ] `POST /api/sets/:id/regenerate` — re-run `runTypeLoop()` for a single type using the same chapter sources and exemplar context as the original generation; replace that block; reassign global IDs

#### Frontend
- [ ] [Edit] button on each question card
- [ ] Inline editor: fields shown match the question type's schema
- [ ] [Save] triggers PATCH; [Cancel] discards changes
- [ ] [Regenerate Type] button per question block
- [ ] Per-type loading state during regeneration
- [ ] Toast: "Type regenerated — X questions replaced."

### Success Criteria
- Edit a question's text → saved and reflected immediately
- Edit breaks schema (missing explanation) → error returned, question not saved
- Regenerate multipleChoice → only MCQ block replaced; all other types unchanged
- IDs remain globally unique after regeneration

---

## Phase 10 — JSON Export with Schema Validation ⬜

**Goal**: Teachers can download a fully schema-validated JSON file. Export is blocked if any validation rule fails.

### Deliverables

#### Backend
- [ ] `validateExportSet(blocks)` — full validation: schema per type, totalMarks check, ID uniqueness, explanation presence
- [ ] `GET /api/sets/:id/export` — runs validation, builds JSON array, returns as file attachment
- [ ] File name format: `questions_<timestamp>.json`
- [ ] `Content-Disposition: attachment` header set correctly
- [ ] Append `ExportEvent` to `QuestionSet.exportHistory` on every successful export
- [ ] `requireRole('teacher')` enforced — HOD/Principal/Student → 403

#### Frontend
- [ ] [Export Questions] button visible only after at least one type has succeeded
- [ ] Button click → GET /api/sets/:id/export → browser auto-downloads file
- [ ] If validation fails → toast: "Invalid question structure detected."
- [ ] Export disabled while generation is in progress

### Success Criteria
- Export a valid set → `.json` file downloaded
- Manually corrupt `totalMarks` in DB → export blocked, error shown
- Export as HOD → 403 returned, button not visible in UI
- File name follows `questions_<timestamp>.json` format exactly

---

## Phase 11 — HOD Review & Approval Workflow ⬜

**Goal**: HODs can view pending question sets from their department, approve them, or request regeneration of specific types.

### Deliverables

#### Backend
- [ ] `POST /api/sets/:id/submit` — Teacher submits set; status → `review_pending`
- [ ] `POST /api/sets/:id/approve` — HOD approves; status → `approved`
- [ ] `POST /api/sets/:id/request-regeneration` — HOD sends revision request; status → `revision_requested`, typesUnderRevision set, hodComment set
- [ ] HOD cannot approve sets from other departments → 403

#### Frontend
- [ ] HOD review queue at `/review`: tabs for Pending | Approved | Revision Requested
- [ ] Set cards: Teacher name, subject, question count, submission date
- [ ] Set detail at `/review/:setId`: read-only question display, full answers visible to HOD
- [ ] [Approve] button → POST approve → toast: "Set approved and published."
- [ ] [Request Regeneration] button → modal to select types and add note

### Success Criteria
- Teacher submits set → appears in HOD queue under "Pending"
- HOD approves → status updates to "Approved"
- HOD requests regeneration → Teacher sees "Revision Requested" chip with comment
- HOD cannot access sets from another department

---

## Phase 12 — Principal Analytics & Student Assessment View ⬜

**Goal**: Principals see institution-wide generation metrics. Students see approved assessments without answer keys.

### Deliverables

#### Backend
- [ ] `GET /api/analytics` — aggregated metrics from `GenerationRun` and `QuestionSet`
  - Summary: totalSetsGenerated, approvalRate, totalExports, totalQuestionsGenerated
  - Breakdown by department and by question type
  - Filterable by `?department=` and `?from=&to=` date range
- [ ] `GET /api/assessments` — list approved sets for the authenticated student
- [ ] `GET /api/assessments/:id` — full question content with `correctAnswer` and `alternatives` stripped server-side

#### Frontend
- [ ] Principal/HOD analytics page at `/analytics`
- [ ] Student assessment list at `/assessment`
- [ ] Student assessment view at `/assessment/:setId` — read-only, no answer key, no export

### Success Criteria
- Principal sees metrics across all departments
- HOD sees analytics scoped to own department only
- Student can view approved questions; `correctAnswer` is absent from every question in the response

---

## Phase 13 — Security Hardening & Audit Logging ⬜

**Goal**: Production-grade security controls and complete audit trail.

### Deliverables

- [ ] `helmet()` confirmed as first middleware on all requests
- [ ] `express-mongo-sanitize` strips `$` and `.` from all request bodies
- [ ] `authLimiter` — 10 requests per 15 minutes on all `/api/auth/*` routes
- [ ] Input validation via Zod confirmed on every route
- [ ] No PII (emails, passwords, tokens) in structured log output confirmed
- [ ] Every generation run creates a `GenerationRun` document (audit)
- [ ] Every export appends to `QuestionSet.exportHistory` (audit)
- [ ] Every HOD approval and regeneration request recorded on the set (audit)

### Security Checklist (Final State)

| Control | Target Status |
|---------|--------------|
| HTTP security headers (helmet) | PRESENT |
| CORS whitelist | PRESENT |
| Auth endpoint rate limiting | PRESENT |
| General API rate limiting | PRESENT |
| NoSQL injection prevention | PRESENT |
| JWT secrets validated at startup | PRESENT |
| No modifiable role field via API | PRESENT |
| bcrypt 12 rounds | PRESENT |
| httpOnly refresh cookies | PRESENT |
| Refresh token rotation | PRESENT |
| Input validation (Zod) on all routes | PRESENT |
| Server-side role enforcement on all sensitive endpoints | PRESENT |
| Student answer key stripping | PRESENT |
| Token budget enforcement | PRESENT |
| Per-type generation audit log | PRESENT |
| Export event log | PRESENT |
