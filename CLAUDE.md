# Question Generator — Project Guide

## What This Project Is

An assessment authoring platform that converts source PDFs into structured, schema-compliant question sets across seven question types. Supports four roles: Teacher (authors), HOD (reviews/approves), Principal (analytics), Student (takes approved assessments).

Full documentation is in `docs/`. Start there before making changes.

| Doc | What it covers |
|-----|---------------|
| `docs/architecture.md` | System diagram, stack, generation pipeline, role enforcement |
| `docs/appflow.md` | All role flows and screen inventory |
| `docs/data_API.md` | Every API endpoint with request/response shapes |
| `docs/schema.md` | MongoDB collections, indexes, embedded sub-schemas |
| `docs/requirements.md` | Numbered requirements (GEN-01…, EXP-01…, ROLE-01…) |
| `docs/phase_scope.md` | 9 implementation phases with deliverable checklists |
| `docs/adr.md` | 12 architecture decision records — read before making structural changes |
| `docs/test_cases.md` | 52 test cases across all feature areas |
| `docs/edge_cases.md` | 40 edge/corner cases with implementation notes |

---

## Project Structure

```
qpgenerator/
├── client/                  # React 18 + Vite + TypeScript frontend
│   └── src/
│       ├── pages/           # LoginPage, DashboardPage, ReviewPage, AnalyticsPage, AssessmentPage
│       ├── components/      # UploadPanel, TypeConfigurator, QuestionBlock, ExportButton, etc.
│       ├── hooks/           # useGeneration, useQuestionSet, useAuth
│       ├── lib/             # api.ts, auth.ts
│       └── types/           # index.ts
│
├── server/                  # Express 5 + TypeScript backend
│   └── src/
│       ├── ai/
│       │   ├── generator.ts         # generateSet(), regenerateType(), runTypeLoop()
│       │   ├── prompts.ts           # Per-type system prompts
│       │   ├── schemeParser.ts      # parseScheme(rawText) — LLM extracts typeConfig from scheme text
│       │   └── extractor.ts         # PDF text extraction (pdf-parse), Word extraction (mammoth)
│       ├── validation/
│       │   ├── index.ts             # validateQuestionBlock(), validateExportSet(), assignGlobalIds()
│       │   └── schemas/             # Zod schema per question type (7 files)
│       ├── routes/                  # auth, source, sets, schemes, analytics, assessments, health
│       ├── models/                  # User, QuestionSet, Scheme, GenerationRun, RefreshToken, PasswordResetToken
│       ├── middleware/              # auth.ts, requireRole.ts, requestId.ts
│       ├── auth/tokens.ts
│       ├── services/                # tokenBudget.ts, email.ts
│       ├── db/connect.ts
│       └── lib/                     # logger.ts, retry.ts, validateEnv.ts
│
├── docs/                    # All documentation (see table above)
└── CLAUDE.md                # This file
```

---

## Running the Project

```bash
# Install all dependencies (run from root)
npm install

# Start client + server concurrently
npm run dev

# Build for production
npm run build

# Client only
npm run dev:client

# Server only
npm run dev:server
```

Client runs at `http://localhost:5173`  
Server runs at `http://localhost:3001`

---

## Environment Variables

Create `server/.env` before running the server. All variables are required unless marked optional.

```env
# MongoDB
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/qpgenerator

# JWT
JWT_ACCESS_SECRET=<random-string-min-32-chars>
JWT_REFRESH_SECRET=<random-string-min-32-chars>

# Groq
GROQ_API_KEY=<your-groq-api-key>
GROQ_MODEL=llama-4-maverick-17b-128e-instruct

# CORS
CLIENT_URL=http://localhost:5173

# Email (for password reset)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your-email>
SMTP_PASS=<your-app-password>
EMAIL_FROM=noreply@qpgenerator.com

# Limits (optional — these are the defaults)
DAILY_TOKEN_LIMIT=100000
MAX_PDF_SIZE_MB=10
```

The server calls `validateEnv()` at startup and **exits immediately** if any required variable is missing.

---

## Nine Question Types

```
fillInBlanks | multipleChoice | multiSelect | matchTheFollowing
reordering   | sorting        | trueFalse   | assertionReason
shortAnswer
```

Each type has:
- Its own Zod schema in `server/src/validation/schemas/<type>.ts`
- Its own generation prompt in `server/src/ai/prompts.ts`
- Its own section in `docs/data_API.md` (§6.2) defining the exact JSON shape

When adding or modifying a type, update all three. They must stay in sync.

---

## Four Roles

| Role | Landing page | Key server permission |
|------|--------------|-----------------------|
| `teacher` | `/dashboard` | generate, edit, regenerate, export (own sets only) |
| `hod` | `/review` | approve, request-regeneration (own department only) |
| `principal` | `/analytics` | read analytics (all departments) |
| `student` | `/assessment` | view approved assessments (answer keys stripped) |

Role is embedded in the JWT at login. It is **never modifiable** via any API call after registration. `requireRole()` middleware enforces it server-side on every sensitive route — client-side hiding is UI only.

---

## Critical Rules (from PRD — do not violate)

**Count enforcement:**
- Every question type is generated independently — no shared question budget.
- If the AI returns more than requested: trim to exact count.
- If the AI returns fewer: retry with the shortfall (max 3 total attempts).
- A per-type failure must never block other types. Use `Promise.allSettled()`.

**IDs:**
- IDs are assigned server-side after all types complete, in `assignGlobalIds()`.
- IDs are globally unique across all types in a set — not just within one type.
- IDs are sequential integers starting at 1.
- After regeneration of any type, `assignGlobalIds()` is called on the full merged set.

**Export:**
- Export only available to the `teacher` role.
- `validateExportSet()` must run before every export. If it fails, return 400 "Invalid question structure detected." — no partial file.
- Validation checks: schema compliance per type, `totalMarks === sum(marks)`, `explanation` present and non-empty on every question, all IDs globally unique.

**Student safety:**
- `correctAnswer` and `alternatives` must be stripped server-side before returning data to students.
- Students can only access sets with `status: "approved"`.

---

## Key Patterns

**Validation — always use Zod, never ad hoc checks:**
```typescript
// In routes — validate request body before any logic
const body = GenerateSchema.parse(req.body)

// After generation — validate before storing
const validQuestions = questions.filter(q => {
  const result = QuestionSchema.safeParse(q)
  return result.success  // invalid questions are discarded, not thrown
})
```

**Role enforcement — always via middleware, never inline:**
```typescript
router.post('/sets/:id/generate',
  requireAuth,
  requireRole('teacher'),
  generateHandler
)
```

**Generation — always parallel, always Promise.allSettled:**
```typescript
const results = await Promise.allSettled(
  typeConfig.map(cfg => runTypeLoop(sourceText, cfg.type, cfg.count, cfg.marksPerQuestion))
)
// results includes both fulfilled and rejected — handle both
```

**Logging — structured JSON, no PII:**
```typescript
logger.info({
  event: 'generation_complete',
  requestId: req.requestId,
  userId: req.userId,
  role: req.role,
  typesSucceeded,
  typesFailed,
  durationMs
})
// Never log: email, password, token, correctAnswer
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 6, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Express 5, TypeScript, Node.js 22 LTS |
| Database | MongoDB 7 (Atlas), Mongoose 8 |
| AI | Groq SDK, llama-4-maverick-17b-128e-instruct |
| PDF parsing | pdf-parse |
| Validation | Zod 3 |
| Auth | jsonwebtoken, bcrypt, nanoid |
| Security | helmet, express-mongo-sanitize, express-rate-limit |
| Email | nodemailer |
| Deployment | Vercel (client), Render (server), MongoDB Atlas (DB) |
