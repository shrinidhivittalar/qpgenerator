# Module 1 — Question Bank Spec

## What This Module Does

Teacher uploads a past paper PDF (scanned or digital). The server extracts text
(OCR if scanned), an LLM splits it into individual questions with confidence
scores. High-confidence questions go straight to the bank; low-confidence ones
go to a verify queue. Teacher reviews the queue, then browses the full bank with
filters to select questions for a paper.

---

## Three Flows

```
Upload PDF → (OCR if needed) → AI parse → auto-accept high conf
                                        → needs_review queue → Teacher verifies
                                                                      ↓
                                               Question Bank (accepted only)
                                                      ↓
                                          Filter / Search → Browse
```

---

## Data Model — ReferenceExemplar (updated)

```ts
{
  // existing
  _id:          ObjectId
  teacherId:    ObjectId           // owner
  questionType: string             // multipleChoice | fillInBlanks | etc.
  rawText:      string             // full question text including options as-is
  subject:      string | null      // e.g. "Physics"
  sourceYear:   number | null      // e.g. 2023
  bankId:       string | null      // group label e.g. "CBSE-2023" (deprecated MVP — use uploadId)

  // new fields
  uploadId:     string             // nanoid — links all questions from one upload
  status:       'accepted' | 'needs_review' | 'rejected'
  confidence:   number             // 0–1, returned by LLM
  marks:        number | null      // extracted by LLM from question text
  class:        string | null      // e.g. "Grade 10", provided by teacher at upload
  chapter:      string | null      // e.g. "Chapter 3", provided by teacher at upload

  createdAt:    Date
  updatedAt:    Date
}
```

**Indexes to add:**
```
{ teacherId: 1, status: 1 }
{ teacherId: 1, uploadId: 1, status: 1 }
{ teacherId: 1, subject: 1, class: 1, questionType: 1, status: 1 }
```

**Confidence threshold:** ≥ 0.75 → `accepted`, < 0.75 → `needs_review`

---

## OCR Strategy

Most Indian school papers are scanned. Detection + fallback:

1. Try `pdf-parse` to extract text.
2. If extracted text < 100 meaningful characters → treat as scanned.
3. For scanned: convert PDF pages to images (`pdf2pic`) → run `tesseract.js`
   on each page → concatenate text.
4. Either path produces `sourceText: string` — everything downstream is the same.

Supported upload formats (from wireframe): **PDF, JPG, PNG**, max **20 MB**.
For JPG/PNG: run Tesseract directly, no pdf-parse step.

---

## Updated AI Parse Prompt

`parsePaperIntoQuestions` returns per question:
```json
{
  "questionType": "multipleChoice",
  "rawText": "What is the SI unit of force?\nA) Joule\nB) Newton\nC) Watt\nD) Pascal",
  "marks": 1,
  "confidence": 0.92
}
```

Prompt additions over current:
- Ask LLM to extract `marks` from inline cues like `[1 Mark]`, `(2 marks)`,
  section headers like `Section A — 1 mark each`.
- Ask LLM to return `confidence` (0–1) reflecting how certain it is that this
  is a complete, well-formed question.
- If marks cannot be determined, return `null`.

---

## API Endpoints

### Existing (unchanged)
```
GET    /api/reference-bank                   list banks (distinct bankIds)
DELETE /api/reference-bank/:bankId           delete all exemplars in a bank
```

### Modified
```
POST /api/reference-bank/upload
```
**Body (multipart/form-data):**
| Field       | Type   | Required | Notes |
|-------------|--------|----------|-------|
| file        | File   | yes      | PDF, JPG, or PNG |
| subject     | string | no       | e.g. "Physics" |
| class       | string | no       | e.g. "Grade 10" |
| chapter     | string | no       | e.g. "Chapter 3 — Motion" |
| sourceYear  | number | no       | e.g. 2023 |

**Response 201:**
```json
{
  "uploadId": "abc123",
  "totalExtracted": 45,
  "autoAccepted": 38,
  "needsReview": 7
}
```
Teacher is redirected to `/verify/:uploadId` if `needsReview > 0`, else to `/bank`.

---

### New Endpoints

```
GET /api/reference-bank/uploads/:uploadId/review
```
Returns all `needs_review` questions for this upload (for the verify screen).
```json
[
  {
    "_id": "...",
    "questionType": "multipleChoice",
    "rawText": "...",
    "marks": 1,
    "confidence": 0.61,
    "subject": "Physics",
    "class": "Grade 10"
  }
]
```

---

```
PATCH /api/reference-bank/questions/:id
```
Accept, reject, or edit a single question.

**Body:**
```json
{
  "action": "accept" | "reject",
  "rawText": "...",      // optional — only if teacher edited
  "marks": 2,            // optional — only if teacher edited
  "questionType": "..."  // optional — only if teacher corrected the type
}
```
**Response 200:** updated question object.

---

```
POST /api/reference-bank/questions/bulk-accept
```
Accept all remaining needs_review questions for an upload in one click.

**Body:**
```json
{ "uploadId": "abc123" }
```
**Response 200:**
```json
{ "accepted": 7 }
```

---

```
GET /api/reference-bank/questions
```
Browse the bank with filters. Returns paginated accepted questions.

**Query params:**
| Param        | Type   | Notes |
|--------------|--------|-------|
| subject      | string | filter |
| class        | string | filter |
| chapter      | string | filter |
| questionType | string | filter |
| marksMin     | number | filter |
| marksMax     | number | filter |
| page         | number | default 1 |
| limit        | number | default 20, max 50 |

**Response 200:**
```json
{
  "questions": [ { "_id", "questionType", "rawText", "marks", "subject", "class", "chapter", "sourceYear" } ],
  "total": 142,
  "page": 1,
  "pages": 8
}
```
Only returns `status: "accepted"` questions owned by the requesting teacher.

---

```
GET /api/reference-bank/stats
```
For the dashboard total count card.

**Response 200:**
```json
{ "totalAccepted": 1250 }
```

---

## Frontend — Screen Inventory

### 1. Dashboard (`/dashboard`)
- Sidebar: Dashboard, Question Bank, My Papers (disabled for now), Settings (disabled)
- Stats card: total accepted questions count (from `/api/reference-bank/stats`)
- Two action cards: "Upload Past Paper" → `/upload` | "Create New Paper" → disabled (Module 3)
- Recent Papers list: placeholder / hidden for Module 1

### 2. Upload Past Paper (`/upload`)
- Drag-and-drop zone, accepts PDF/JPG/PNG, max 20MB
- 3-step progress indicator: **Uploading** → **Reading Paper** → **Extracting Questions**
- Progress is shown after file is picked (client-side upload progress + polling or SSE)
- On success: redirect to `/verify/:uploadId` if needsReview > 0, else `/bank`
- "Return to Dashboard" link always visible

### 3. Verify Extracted Questions (`/verify/:uploadId`)
- Two view modes: **List View** (default) and **One by One** toggle
- Header: "X of Y verified" progress
- **One by One mode:** shows one question card at a time — question text, type
  badge, marks badge, confidence indicator. Actions: Edit | Skip | Accept.
  "Skip" leaves it as needs_review. "Accept" → PATCH + advance to next.
- **List View mode:** table of all needs_review questions, checkbox each row,
  "Bulk Accept Selected" button, "Accept All" button.
- Edit inline: teacher can correct rawText, marks, questionType before accepting.
- "Save to Bank" / "Done" button at end → redirect to `/bank`

### 4. Question Bank Browser (`/bank`)
- Left panel: filter sidebar
  - Subject (dropdown, populated from distinct values in teacher's bank)
  - Class / Grade (dropdown)
  - Chapter / Topic (dropdown)
  - Question Type (checkboxes)
  - Marks range (min–max inputs)
  - "Clear All" link
- Right panel: question cards
  - Tags row: Subject, Class, Question Type, Marks
  - Question rawText (truncated at ~100 chars, expand on click)
  - "View Options & Answer" toggle (for MCQ)
  - "+ Add to Paper" button (disabled for Module 1 — Module 3)
- Search bar at top (text filter on rawText for MVP — no semantic search yet)
- Pagination

---

## What Is Explicitly OUT of Scope for Module 1

- Semantic / vector search (MVP uses text filter + DB query filters only)
- "Add to Paper" / paper builder (Module 3)
- HOD approval flow
- AI generation fallback (Module 2)
- Student and Principal roles
- Word / PDF export

---

## File Changes Needed

### Backend
| File | Change |
|------|--------|
| `server/src/models/ReferenceExemplar.ts` | Add `uploadId`, `status`, `confidence`, `marks`, `class`, `chapter` fields + new indexes |
| `server/src/ai/paperParser.ts` | Update prompt to return `confidence` and `marks`; update `ParsedQuestion` type |
| `server/src/ai/extractor.ts` | Add OCR path: detect scanned → `pdf2pic` + `tesseract.js` |
| `server/src/routes/referenceBank.ts` | Update upload handler; add 5 new endpoints above |
| `server/src/lib/validateEnv.ts` | No new env vars needed for Tesseract (runs locally) |

### Frontend
| File | Change |
|------|--------|
| `client/src/App.tsx` | Add routes: `/upload`, `/verify/:uploadId`, `/bank` |
| `client/src/pages/DashboardPage.tsx` | New — stats card, two action cards |
| `client/src/pages/UploadPage.tsx` | New — drag-drop + 3-step progress |
| `client/src/pages/VerifyPage.tsx` | New — list + one-by-one verify |
| `client/src/pages/BankPage.tsx` | New — filter sidebar + question cards |
| `client/src/lib/api.ts` | Add API call functions for all new endpoints |
| `client/src/types/index.ts` | `BankQuestion` type already added |

---

## Build Order

1. Update `ReferenceExemplar` model (foundation everything else needs)
2. OCR in `extractor.ts`
3. Update `paperParser.ts` prompt + types
4. Update `referenceBank.ts` upload route (now returns `uploadId`, sets `status`)
5. Add 5 new API endpoints
6. Dashboard page
7. Upload page
8. Verify page
9. Bank browser page
