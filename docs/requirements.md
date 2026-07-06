# Question Generator — Functional & Non-Functional Requirements

**Version**: 1.0  
**Last Updated**: June 2026

---

## 1. Overview

This document specifies the complete functional and non-functional requirements for the Question Generator platform, including validation rules, edge cases, and acceptance criteria. Requirements are grouped by feature area and assigned unique IDs for traceability.

---

## 2. Authentication Requirements

### 2.1 Registration

| ID | Requirement |
|----|-------------|
| AUTH-01 | The system shall accept name, email, password, role, and department to create a new user account |
| AUTH-02 | Email must match the pattern `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| AUTH-03 | Password must be a minimum of 8 characters |
| AUTH-04 | Email must be stored in lowercase and trimmed of whitespace |
| AUTH-05 | Password must be hashed with bcrypt at 12 rounds before storage |
| AUTH-06 | Role must be one of: `principal`, `hod`, `teacher`, `student` |
| AUTH-07 | Department is required for `hod`, `teacher`, and `student` roles |
| AUTH-08 | If the email is already registered, the server shall return HTTP 409 |
| AUTH-09 | On successful registration, the server shall issue a JWT access token and set a refresh token httpOnly cookie |

**Edge Cases:**
- Email with mixed case (`User@Example.COM`) is normalised to lowercase before the uniqueness check
- A `principal` registering without a department is allowed — department is optional for that role
- Concurrent registrations with the same email — MongoDB unique index guarantees only one succeeds; the other receives 409

---

### 2.2 Login

| ID | Requirement |
|----|-------------|
| AUTH-10 | The system shall authenticate a user by email and password |
| AUTH-11 | The server shall compare the submitted password against the stored bcrypt hash |
| AUTH-12 | If either the email does not exist or the password does not match, the server shall return HTTP 401 with a generic message — email existence shall not be disclosed |
| AUTH-13 | On successful login, the server shall issue a new JWT access token (containing `userId` and `role`) and set a new refresh token httpOnly cookie |
| AUTH-14 | The client shall redirect the user to the role-appropriate landing page after login |

---

### 2.3 JWT Access Token

| ID | Requirement |
|----|-------------|
| AUTH-15 | Access tokens shall be signed using `JWT_ACCESS_SECRET` (validated present at startup) |
| AUTH-16 | Access tokens shall expire after 15 minutes |
| AUTH-17 | Access tokens shall contain the user's `id` and `role` in the payload |
| AUTH-18 | Access tokens shall be sent by the client in the `Authorization: Bearer <token>` header |
| AUTH-19 | The `requireAuth` middleware shall reject requests with missing, malformed, or expired tokens with HTTP 401 |
| AUTH-20 | If `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` are not set, the server shall exit at startup |

---

### 2.4 Refresh Tokens

| ID | Requirement |
|----|-------------|
| AUTH-21 | Refresh tokens shall be a 64-character nanoid |
| AUTH-22 | Refresh tokens shall be stored in MongoDB with a 7-day TTL index |
| AUTH-23 | Refresh tokens shall be delivered via an httpOnly, Secure (in production), SameSite cookie |
| AUTH-24 | On use, the old refresh token shall be deleted immediately and a new one issued (rotation) |
| AUTH-25 | If the refresh token is missing or expired, the server shall return HTTP 401 |

**Edge Cases:**
- Token reuse after rotation: the old token no longer exists in MongoDB — returns 401, client redirects to login
- Concurrent refresh calls: the first call consumes the token; the second returns 401

---

### 2.5 Password Reset

| ID | Requirement |
|----|-------------|
| AUTH-26 | The forgot-password endpoint shall always return HTTP 200 regardless of whether the email exists |
| AUTH-27 | If the email exists, a SHA-256-hashed reset token shall be stored with a 1-hour expiry |
| AUTH-28 | Any existing reset tokens for the user shall be deleted before creating a new one |
| AUTH-29 | The raw token (not the hash) shall be included in the emailed reset link |
| AUTH-30 | On reset-password submission, the server shall hash the submitted token and compare to the stored hash |
| AUTH-31 | If the token is not found or has expired, the server shall return HTTP 400 |
| AUTH-32 | On successful reset, the token record shall be deleted and the user's password hash updated |

---

## 3. Role & Access Control Requirements

| ID | Requirement |
|----|-------------|
| ROLE-01 | The server shall enforce role checks on every sensitive endpoint using the `requireRole()` middleware |
| ROLE-02 | Role is read from the verified JWT payload — never from the request body or query string |
| ROLE-03 | A `403 Forbidden` response shall be returned when a user's role is not in the allowed set for an endpoint |
| ROLE-04 | Client-side hiding of buttons and routes is a UX convenience only — it does not substitute for server-side enforcement |
| ROLE-05 | Teachers may only access, generate, edit, and export their own question sets |
| ROLE-06 | HODs may only review and approve sets from teachers within their own department |
| ROLE-07 | Principals may view analytics for all departments but shall never access raw question content or export files |
| ROLE-08 | Students may only view question sets that are in `approved` status and assigned to them; answer keys shall never be returned |
| ROLE-09 | The `role` field on the User document shall not be modifiable via any API endpoint after registration |

---

## 4. Source PDF Requirements

| ID | Requirement |
|----|-------------|
| SRC-01 | `POST /api/source/upload` shall accept only PDF files |
| SRC-02 | Maximum file size shall be 10 MB; files exceeding this limit shall be rejected client-side and server-side |
| SRC-03 | The server shall extract text from the PDF using `pdf-parse` |
| SRC-04 | If the PDF contains no extractable text (e.g. a scanned image PDF), the server shall return HTTP 422 with the message: "Could not extract text from this PDF. Try a text-based PDF." |
| SRC-05 | On successful upload, the server shall create a draft `QuestionSet` document containing the extracted text and return the `setId` |
| SRC-06 | The original PDF binary shall not be stored in the database — only the extracted text is persisted |

---

## 5. Blueprint Inference Requirements

The scheme upload is the primary mechanism for blueprint inference. A "scheme" can be any pattern document — a formal marking scheme, a previous year paper, a model paper, a syllabus, or any institutional exam instruction document. The system infers the exam structure from it without assuming any specific board.

| ID | Requirement |
|----|-------------|
| SCH-01 | `POST /api/schemes/upload` shall accept PDF and Word (.docx) files only |
| SCH-02 | Maximum scheme file size shall be 5 MB |
| SCH-03 | The server shall extract text from the scheme file (`pdf-parse` for PDF, `mammoth` for .docx) |
| SCH-04 | If text extraction yields no content, the server shall return HTTP 422: "Could not extract text from this file." |
| SCH-05 | The extracted text shall be passed to `inferExamBlueprint()` — a board-agnostic LLM prompt that infers the full exam structure without assuming CBSE or any specific board |
| SCH-06 | The inferred blueprint shall include: examBoard, institutionType, subject, standard, examType, durationMinutes, totalMarks, tone, difficultyDefault, chapter list with weights, and per-section question type/count/marks/difficulty/Bloom's distribution |
| SCH-07 | The blueprint shall be converted to `TypeConfig[]` via `blueprintToTypeConfig()` for pre-filling the type configurator |
| SCH-08 | If full blueprint parsing fails, the system shall fall back to legacy `TypeConfig[]` parsing; if that also fails, return HTTP 422: "Could not parse a valid question configuration from this scheme." |
| SCH-09 | A saved scheme shall be associated with the Teacher who uploaded it; no other user may access or modify it |
| SCH-10 | A Teacher may save multiple schemes; they are listed and selectable when creating a new question set |
| SCH-11 | A saved scheme shall persist until the Teacher explicitly replaces it or deletes it — the Teacher is never prompted to re-upload automatically |
| SCH-12 | When a Teacher creates a new question set, saved schemes shall be listed as a picker; selecting one pre-fills the type configurator with the blueprint's `parsedConfig` without any upload prompt |
| SCH-13 | Pre-filled values from a scheme are always editable by the Teacher before generation is triggered |
| SCH-14 | The `schemeId` of the selected scheme shall be stored on the `QuestionSet` document for audit purposes |
| SCH-15 | Deleting a scheme shall not affect `QuestionSet` documents that previously used it — those sets retain their own `typeConfig` |
| SCH-16 | Scheme upload and management is available only to the `teacher` role |

**Edge Cases:**
- Teacher uploads a scheme with section headings but no explicit marks: LLM returns best-effort blueprint; Teacher reviews and adjusts before generating
- Teacher skips saving the scheme: used to pre-fill the current set only; no `Scheme` document created; `schemeId` on the `QuestionSet` is null
- Two Teachers upload schemes with the same name: no conflict — schemes are scoped per `teacherId`
- Document is from an unrecognised board: `examBoard` field populated with whatever the LLM infers; no error if board is unknown

---

## 5a. Textbook & Chapter Requirements

| ID | Requirement |
|----|-------------|
| TBK-01 | `POST /api/textbooks/upload` shall accept PDF files up to 50 MB |
| TBK-02 | The server shall extract text page-by-page using `pdf-parse` to enable boundary detection |
| TBK-03 | Chapter detection shall use three methods in priority order: (1) PDF bookmark outline, (2) heuristic heading detection, (3) LLM-based detection. The highest-confidence method available shall be used |
| TBK-04 | If no chapter structure can be detected, the server shall return HTTP 422: "Could not detect any chapter structure in this textbook. Try uploading chapters individually instead." |
| TBK-05 | Detected chapters shall be stored as a `TextbookUploadDraft` with candidate entries (tempId, suggestedTitle, suggestedNumber, startOffset, endOffset, detectionMethod) |
| TBK-06 | `POST /api/textbooks/:draftId/confirm` shall accept a teacher-reviewed list of chapters with final titles, numbers, and weight percentages; optional merge and exclude operations are supported |
| TBK-07 | On confirm, a `TextbookChapter` document shall be created for each active chapter, storing: teacherId, subject, title, chapterNumber, weightPercent, sourceText, highValueSnippets |
| TBK-08 | The `TextbookUploadDraft` document shall be deleted after successful confirmation |
| TBK-09 | `POST /api/chapters/upload` shall accept a single-chapter PDF (bypasses the draft/confirm flow) with subject, title, chapterNumber, and weightPercent supplied directly |
| TBK-10 | A Teacher may store multiple chapters across multiple subjects |
| TBK-11 | When generating, if `chapterIds[]` is provided, the server shall concatenate the `sourceText` of those chapters (in chapter-number order) and use the result as the generation source instead of the set's uploaded `sourceText` |
| TBK-12 | Chapter weight percentages shall influence question distribution when multiple chapters are selected: chapters with higher weight receive proportionally more questions |
| TBK-13 | Textbook upload and chapter management is available only to the `teacher` role |

**Edge Cases:**
- Textbook has no bookmarks and no clear heading pattern: LLM detection used as last resort
- Teacher excludes all detected chapters: server returns 400 "No chapters remain after applying excludedTempIds."
- Teacher selects chapters from different subjects for one generation run: allowed; generation uses the concatenated text regardless of subject tags
- Chapter weights do not sum to 100%: a warning is returned but the operation is not blocked

---

## 5b. Reference Bank Requirements

| ID | Requirement |
|----|-------------|
| REFB-01 | `POST /api/reference-bank/upload` shall accept PDF files containing previous year papers or model papers |
| REFB-02 | The server shall extract text from the uploaded paper and pass it to `parsePaperIntoQuestions()` — an LLM call that segments the paper into individual question objects, each tagged with a `questionType` |
| REFB-03 | Each parsed question shall be stored as a `ReferenceExemplar` with: teacherId, bankId, questionType, rawText, subject, sourceYear, chapterId |
| REFB-04 | If no recognisable questions are found after parsing, the server shall return HTTP 422: "No recognisable questions found in the uploaded paper." |
| REFB-05 | A teacher may group exemplars under a named bank using the `bankId` field (e.g. "CBSE-2023", "Maharashtra-Board") |
| REFB-06 | A teacher may upload multiple papers to the same bank; exemplars accumulate |
| REFB-07 | When generating with a `bankId` provided, the generator shall retrieve up to 3 exemplars per question type from that bank and inject them into the type's generation prompt as format examples |
| REFB-08 | Exemplar injection shall use this format in the prompt: "Here are examples of how [type] questions appear in this exam pattern:" followed by the raw exemplar text |
| REFB-09 | If no exemplars of a given type exist in the selected bank, that type's prompt is generated without exemplar context — no error |
| REFB-10 | Reference bank upload and management is available only to the `teacher` role |
| REFB-11 | A teacher's exemplars are private — not visible to or usable by other teachers |

---

## 6. Question Generation Requirements

### 6.0 Generation Inputs

| ID | Requirement |
|----|-------------|
| GEN-IN-01 | `POST /api/sets/:id/generate` shall accept all three input channels in a single request: `typeConfig` (from blueprint or manual), `chapterIds[]` (from textbook), and `bankId` (from reference bank) |
| GEN-IN-02 | All three inputs are optional individually — the teacher may provide any combination: all three, two, one, or none (falls back to set's uploaded sourceText with manual typeConfig) |
| GEN-IN-03 | When `chapterIds[]` is provided, the chapter sourceTexts shall be concatenated in chapter-number order and used as the generation source for all types in this run |
| GEN-IN-04 | When `bankId` is provided, the generator shall retrieve relevant exemplars per type before calling the LLM, and inject them into each type's prompt |
| GEN-IN-05 | `tone` (formal-board-exam | neutral | conversational) and `difficultyDefault` (easy | moderate | hard) shall be accepted as top-level generation parameters and passed to each type's prompt |
| GEN-IN-06 | Individual types in `typeConfig` may override `difficultyDefault` with their own `difficulty` field |
| GEN-IN-07 | The `QuestionSet` document shall record which `chapterIds`, `bankId`, `tone`, and `difficultyDefault` were used for each generation run |

### 6.1 Count Enforcement

| ID | Requirement |
|----|-------------|
| GEN-01 | Each question type must be generated independently — no shared question budget across types |
| GEN-02 | Generation must strictly follow the Teacher-supplied count per type |
| GEN-03 | No global or default count shall exist anywhere in the system |
| GEN-04 | If the generator returns more questions than requested for a type, the excess shall be trimmed to exactly the requested count before storage |
| GEN-05 | If the generator returns fewer questions than requested, the system shall retry with the shortfall count |
| GEN-06 | A maximum of 3 generation attempts shall be made per type (initial + 2 retries) |
| GEN-07 | If the type still returns fewer questions after all retries, the system shall record a `GenerationError` for that type with `requested`, `received`, and an error message |
| GEN-08 | A per-type failure shall not block or delay the generation of types that succeeded |
| GEN-09 | Types with count = 0 shall be excluded entirely — not sent to the generator, not present in output |
| GEN-10 | The system shall prevent duplicate questions both within a type and across different types |

**Edge Cases:**
- Source text is too short to produce the requested count: a `GenerationError` is recorded after 3 retries with `received: N` where N is what was generated
- Teacher requests a count of 0 for all types: server returns 400 "Select at least one question type with a count greater than 0."
- Groq returns JSON with syntax errors: the response is discarded, the attempt counted as failed, retry triggered

---

### 5.2 ID Assignment

| ID | Requirement |
|----|-------------|
| GEN-11 | Question IDs shall be assigned server-side after all types are generated |
| GEN-12 | IDs shall be globally unique across all types in a combined set — not just within one type |
| GEN-13 | IDs shall be sequential integers starting at 1 |
| GEN-14 | ID assignment order shall follow the order types were declared in the Teacher's `typeConfig` |

---

### 5.3 Schema Compliance

| ID | Requirement |
|----|-------------|
| GEN-15 | Every generated question must strictly conform to its type's Zod schema before being stored |
| GEN-16 | Questions failing schema validation shall be discarded and counted as not generated (triggering retry logic) |
| GEN-17 | `explanation` must be a non-empty string on every question, every type — questions missing it are invalid |
| GEN-18 | No extra fields beyond the defined schema for each type shall be persisted |
| GEN-19 | The `marks` field must be a positive number on every question |

---

### 5.4 Performance & Reliability

| ID | Requirement |
|----|-------------|
| GEN-20 | All selected types shall be processed in parallel, not sequentially |
| GEN-21 | Every Groq API call shall be wrapped in `withRetry(3)` with exponential backoff |
| GEN-22 | Every Groq API call shall be wrapped in `withTimeout(30000)` (30 seconds) |
| GEN-23 | Retries shall trigger on: rate limit errors (429), timeouts, and 503 responses |
| GEN-24 | Token usage shall be recorded per generation run in the `GenerationRun` collection |

---

## 7. Question Editing Requirements

| ID | Requirement |
|----|-------------|
| EDIT-01 | Teachers shall be able to edit any field of an individual question inline |
| EDIT-02 | Edited questions must be validated against the type's schema before being saved |
| EDIT-03 | An edit that would make the question schema-invalid shall be rejected with HTTP 400 |
| EDIT-04 | Editing one question shall not affect other questions in the set |
| EDIT-05 | Only the Teacher who owns the set may edit its questions |

---

## 8. Regeneration Requirements

| ID | Requirement |
|----|-------------|
| REGEN-01 | Teachers shall be able to regenerate a specific type within an existing set |
| REGEN-02 | Regeneration replaces only the questions for the specified type; all other types are unaffected |
| REGEN-03 | After regeneration, global IDs shall be reassigned across the full set to maintain uniqueness |
| REGEN-04 | HODs may request that the Teacher regenerate specific types as part of the review flow |
| REGEN-05 | A HOD regeneration request shall update the set status to `revision_requested` and record which types require regeneration |

---

## 9. Export Requirements

| ID | Requirement |
|----|-------------|
| EXP-01 | Export is available only to the `teacher` role |
| EXP-02 | The export endpoint shall run a full schema validation pass before generating the file |
| EXP-03 | `totalMarks` for each block must equal the sum of `marks` across all questions in that block; if not, export is blocked |
| EXP-04 | All IDs in the export must be globally unique; if duplicates are found, export is blocked |
| EXP-05 | `explanation` must be present and non-empty on every question; if missing, export is blocked |
| EXP-06 | If validation fails for any reason, the system shall return the error message "Invalid question structure detected." and produce no file |
| EXP-07 | A valid export shall be returned as a file download with `Content-Disposition: attachment; filename="questions_<timestamp>.json"` |
| EXP-08 | The exported JSON must be a valid, parseable JSON array conforming to the top-level structure in PRD §6.1 |
| EXP-09 | Only types that were actually generated are included; types not selected or with count = 0 are never present in the export |
| EXP-10 | Every successful export shall be appended to the set's `exportHistory` array |
| EXP-11 | HODs and Principals may view export history metadata but shall not be able to trigger or download an export |

---

## 10. HOD Approval Requirements

| ID | Requirement |
|----|-------------|
| HOD-01 | HODs shall only see question sets from teachers within their own department |
| HOD-02 | HODs may approve a set in `review_pending` status; approval changes status to `approved` |
| HOD-03 | HODs may request regeneration of specific types; this changes status to `revision_requested` |
| HOD-04 | A regeneration request shall record the types to be regenerated and an optional comment |
| HOD-05 | An approved set shall be made visible to Students |
| HOD-06 | HODs shall never be able to export a question set |
| HOD-07 | HODs shall never see answer keys in a stripped or sanitised form — full question data including answers is visible during review |

---

## 11. Principal Analytics Requirements

| ID | Requirement |
|----|-------------|
| ANA-01 | Principals shall see institution-wide metrics: total sets generated, approval rate, export count, questions generated |
| ANA-02 | Metrics shall be filterable by department and date range |
| ANA-03 | Principals may drill into a department to see teacher-level activity |
| ANA-04 | Principals shall never see raw question content or answer keys |
| ANA-05 | HODs shall see the same analytics view scoped to their own department only |
| ANA-06 | Analytics data is read-only — no modifications to question sets are possible from the analytics view |

---

## 12. Student Assessment Requirements

| ID | Requirement |
|----|-------------|
| STU-01 | Students shall only see question sets in `approved` status |
| STU-02 | The assessment endpoint shall strip all `correctAnswer` and `alternatives` fields before returning data to students |
| STU-03 | Students shall never be able to trigger generation, submit, export, or approve any question set |
| STU-04 | Raw JSON, draft sets, and pre-approval content shall never be accessible to students |
| STU-05 | Answer keys shall never be exposed to students before assessment submission |

---

## 13. Non-Functional Requirements

### 12.1 Performance

| Metric | Target |
|--------|--------|
| Single-type generation (p95) | < 15 seconds per type |
| Full multi-type generation (3 types, 10 each) | < 30 seconds |
| PDF text extraction | < 5 seconds for a 10 MB PDF |
| Export validation + file download trigger | < 2 seconds |
| Page load (initial, cold) | < 2 seconds on standard broadband |

---

### 12.2 Reliability

| Requirement | Detail |
|-------------|--------|
| AI call retry | 3 attempts with exponential backoff on 429, 503, and timeout |
| AI call timeout | 30 seconds per type per attempt |
| Per-type independence | A failed type never blocks or delays other types |
| Database connection | Mongoose reconnects automatically on transient loss |

---

### 12.3 Security

| ID | Requirement |
|----|-------------|
| SEC-01 | `helmet()` shall be applied as the first middleware |
| SEC-02 | CORS shall only allow origins listed in the `CLIENT_URL` environment variable |
| SEC-03 | All request bodies shall be sanitised by `express-mongo-sanitize` to strip `$` and `.` keys |
| SEC-04 | All `/api/auth/*` routes shall be rate-limited to 10 requests per 15 minutes per IP |
| SEC-05 | Input to all routes shall be validated against a Zod schema before any business logic executes |
| SEC-06 | JWT secrets shall be validated as present and non-empty at server startup; the process shall exit if missing |
| SEC-07 | The `role` field shall never be user-modifiable via any API call after registration |
| SEC-08 | No PII (email addresses, passwords, tokens) shall appear in structured log output |

---

### 12.4 Auditability

| ID | Requirement |
|----|-------------|
| AUD-01 | Every generation run shall create a `GenerationRun` document with: userId, role, setId, typesRequested, typesSucceeded, typesFailed, tokensUsed, durationMs |
| AUD-02 | Every export shall be appended to the set's `exportHistory` with exportedAt, fileName, and question count |
| AUD-03 | Every HOD approval and regeneration request shall be recorded on the `QuestionSet` document |
| AUD-04 | Audit data shall be accessible to HODs (own dept) and Principals (all depts) via the analytics endpoint |

---

### 12.5 Compatibility

| Requirement | Detail |
|-------------|--------|
| Browser support | Chrome 90+, Edge 90+, Safari 15+, Firefox 90+ |
| PDF compatibility | Text-based PDFs only; scanned-image PDFs are rejected with a clear error |
| Device | Desktop and laptop browsers; mobile not supported at this scope |
