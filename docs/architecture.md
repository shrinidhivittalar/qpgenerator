# Question Generator — System Architecture Documentation

**Version**: 1.0  
**Last Updated**: June 2026

---

## 1. Architecture Overview

The Question Generator follows a **client-server architecture** with a clear separation between the React frontend, an Express REST API, a per-type AI generation pipeline, a schema validation layer, and MongoDB for persistence. The system is deployed on Vercel (frontend) and Render (backend).

```
┌──────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                               │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │  React 18 + Vite (TypeScript)                                │   │
│   │  Deployed on Vercel                                          │   │
│   │                                                              │   │
│   │  /login    /dashboard    /review/:setId    /analytics        │   │
│   │  /assessment/:setId      /register                           │   │
│   └───────────────────────────┬──────────────────────────────────┘   │
└───────────────────────────────┼──────────────────────────────────────┘
                                │  HTTPS / REST
┌───────────────────────────────┼──────────────────────────────────────┐
│                               │   API LAYER                          │
│   ┌───────────────────────────▼──────────────────────────────────┐   │
│   │  Express 5 + TypeScript                                      │   │
│   │  Deployed on Render                                          │   │
│   │                                                              │   │
│   │  Middleware stack:                                           │   │
│   │    helmet → cors → requestId → json → cookieParser           │   │
│   │    → mongoSanitize → authLimiter / apiLimiter                │   │
│   │    → requireAuth → requireRole                               │   │
│   │                                                              │   │
│   │  Routes:                                                     │   │
│   │    /api/auth      /api/sets       /api/source                │   │
│   │    /api/analytics /api/assessments /api/health               │   │
│   └──────────┬───────────────────────────────────────────────────┘   │
│              │                                                        │
│   ┌──────────▼───────────────────────────────────────────────────┐   │
│   │  GENERATION PIPELINE                                         │   │
│   │                                                              │   │
│   │  generator.ts                                                │   │
│   │    generateSet()  ──────► runTypeLoop()  (per type)          │   │
│   │    regenerateType() ────► runTypeLoop()  (single type)       │   │
│   │                                  │                           │   │
│   │                       ┌──────────▼──────────┐               │   │
│   │                       │   Groq API           │               │   │
│   │                       │   llama-4-maverick   │               │   │
│   │                       └──────────┬──────────┘               │   │
│   │                                  │                           │   │
│   │  ┌───────────────────────────────▼──────────────────────┐   │   │
│   │  │  VALIDATION LAYER  (server/src/validation/)          │   │   │
│   │  │                                                       │   │   │
│   │  │  validateQuestionBlock()                              │   │   │
│   │  │    schemas/fillInBlanks.ts   schemas/multipleChoice.ts│   │   │
│   │  │    schemas/multiSelect.ts    schemas/matchTheFollowing │   │   │
│   │  │    schemas/reordering.ts     schemas/sorting.ts        │   │   │
│   │  │    schemas/trueFalse.ts                                │   │   │
│   │  │                                                       │   │   │
│   │  │  validateExportSet()  — pre-download full-set check   │   │   │
│   │  │  assignGlobalIds()    — unique IDs across all types   │   │   │
│   │  └───────────────────────────────────────────────────────┘   │   │
│   └──────────────────────────────────────────────────────────────┘   │
│              │                                                        │
│   ┌──────────▼───────────────────────────────────────────────────┐   │
│   │  DATA LAYER                                                  │   │
│   │                                                              │   │
│   │  MongoDB (Atlas)                                             │   │
│   │    User  |  QuestionSet  |  GenerationRun                   │   │
│   │    RefreshToken  |  PasswordResetToken                       │   │
│   └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Architecture

### 2.1 Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | React 18 | UI component model |
| Build Tool | Vite 6 | Dev server, hot reload, production bundling |
| Language | TypeScript 5.x | Type safety |
| UI Components | shadcn/ui + Radix UI | Accessible, composable primitives |
| Styling | Tailwind CSS 3 | Utility-first CSS |
| HTTP Client | Fetch API (custom wrapper) | API calls with interceptors for token refresh |
| Auth | Custom hook + interceptor | JWT management, silent refresh, redirect on expiry |
| PDF Handling | Browser FileReader | Client-side file reading before upload |

### 2.2 Directory Structure

```
client/src/
├── pages/
│   ├── LoginPage.tsx
│   ├── RegisterPage.tsx
│   ├── DashboardPage.tsx        # Teacher: upload, configure, generate, review
│   ├── ReviewPage.tsx           # HOD: review and approve question sets
│   ├── AnalyticsPage.tsx        # Principal/HOD: analytics dashboard
│   └── AssessmentPage.tsx       # Student: approved assessment view
│
├── components/
│   ├── UploadPanel.tsx          # PDF upload + drag-and-drop
│   ├── TypeConfigurator.tsx     # Per-type count selection UI
│   ├── GenerationProgress.tsx   # Per-type loading states and results
│   ├── QuestionBlock.tsx        # Collapsible question list per type
│   ├── QuestionEditor.tsx       # Inline question editing form
│   ├── ExportButton.tsx         # Export trigger with validation feedback
│   ├── ApprovalPanel.tsx        # HOD approve/reject interface
│   └── ui/                      # shadcn/ui generated components
│
├── hooks/
│   ├── useGeneration.ts         # Generation state: types, counts, results, errors
│   ├── useQuestionSet.ts        # Set loading, editing, saving
│   └── useAuth.ts               # Token storage, role detection, logout
│
├── lib/
│   ├── api.ts                   # Typed API client
│   └── auth.ts                  # Token storage, silent refresh, logout
│
└── types/
    └── index.ts                 # Shared TypeScript interfaces and types
```

### 2.3 Role-Based Routing

Each role lands on a different default page after login. Client-side route guards read the user's role from the JWT payload and redirect if the route is not permitted for that role.

```
Teacher   → /dashboard         (upload, configure, generate, export)
HOD       → /review            (department question set queue)
Principal → /analytics         (institution-wide metrics)
Student   → /assessment        (list of assigned approved assessments)
```

Route guards are enforced at the React Router level, but all permission checks that matter are enforced server-side.

### 2.4 State Management

Generation state is centralised in `useGeneration.ts`, consumed by `DashboardPage`. No external state library is used.

```
useGeneration.ts owns:
  ├── sourceText          Extracted PDF content
  ├── fileName            Uploaded PDF name
  ├── typeConfig[]        { type, count, marksPerQuestion }
  ├── results{}           Map of type → { status, questions[], error }
  ├── isGenerating        Whether any type is currently in-flight
  ├── setId               MongoDB _id once a set is saved
  └── exportError         Validation failure message for export
```

### 2.5 Token Refresh Interceptor

```
API call made
    │
    ├─ [200–299] ──► Return response
    │
    └─ [401 Unauthorized]
              │
              POST /api/auth/refresh (reads httpOnly cookie)
              │
              ├─ [Success] ──► New access token stored
              │                Original request retried once
              │
              └─ [401 again] ──► clearTokens()
                                  Redirect → /login
```

---

## 3. Backend Architecture

### 3.1 Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 LTS |
| Framework | Express.js 5 |
| Language | TypeScript 5.x |
| ODM | Mongoose 8 |
| Database | MongoDB 7 (Atlas) |
| AI | Groq SDK (llama-4-maverick-17b-128e-instruct) |
| PDF Parsing | pdf-parse |
| Validation | Zod 3 |
| Auth | jsonwebtoken + bcrypt |
| Security | helmet, express-mongo-sanitize, express-rate-limit |
| Logging | Custom structured JSON logger |
| Email | nodemailer |

### 3.2 Directory Structure

```
server/src/
├── index.ts                    # Express app bootstrap, middleware, route mounting
│
├── ai/
│   ├── generator.ts            # generateSet(), regenerateType(), runTypeLoop()
│   ├── prompts.ts              # Per-type system prompts and count-enforcement instructions
│   └── extractor.ts            # PDF text extraction via pdf-parse
│
├── validation/
│   ├── index.ts                # validateQuestionBlock(), validateExportSet(), assignGlobalIds()
│   └── schemas/
│       ├── fillInBlanks.ts     # Zod schema for fillInBlanks questions
│       ├── multipleChoice.ts
│       ├── multiSelect.ts
│       ├── matchTheFollowing.ts
│       ├── reordering.ts
│       ├── sorting.ts
│       └── trueFalse.ts
│
├── routes/
│   ├── auth.ts                 # Register, login, refresh, logout, forgot/reset password
│   ├── source.ts               # POST /api/source/upload — PDF upload and extraction
│   ├── sets.ts                 # Question set CRUD, generate, regenerate, export, submit
│   ├── analytics.ts            # GET /api/analytics — Principal/HOD metrics
│   ├── assessments.ts          # GET /api/assessments — Student-facing approved sets
│   └── health.ts               # GET /api/health
│
├── models/
│   ├── User.ts
│   ├── QuestionSet.ts
│   ├── GenerationRun.ts
│   ├── RefreshToken.ts
│   └── PasswordResetToken.ts
│
├── middleware/
│   ├── auth.ts                 # requireAuth: verifies JWT, attaches req.userId and req.role
│   ├── requireRole.ts          # requireRole(...roles): rejects if role not in allowed list
│   └── requestId.ts            # Attaches a UUID to every request (req.requestId)
│
├── auth/
│   └── tokens.ts               # signAccessToken, verifyAccessToken, createRefreshToken
│
├── services/
│   ├── versions.ts             # (future) Question set version snapshots
│   ├── tokenBudget.ts          # Daily per-user Groq token limit enforcement
│   └── email.ts                # Password reset email via nodemailer
│
├── db/
│   └── connect.ts              # MongoDB connection (Mongoose)
│
└── lib/
    ├── logger.ts               # Structured JSON logger with request ID correlation
    ├── retry.ts                # withRetry (exponential backoff) + withTimeout
    └── validateEnv.ts          # Startup check: exits if required env vars missing
```

### 3.3 Request Lifecycle

```
HTTP Request
    │
    ▼
helmet()               — sets security headers
requestIdMiddleware()  — attaches UUID to req.requestId
cors()                 — checks against CLIENT_URL allowlist
express.json()         — parses body (10 MB limit for PDF text)
cookieParser()         — parses httpOnly refresh token cookie
mongoSanitize()        — strips $ and . from body keys
    │
    ├── /api/auth/*     → authLimiter (10/15min) → authRoutes
    ├── /api/source/*   → apiLimiter → requireAuth → requireRole('teacher') → sourceRoutes
    ├── /api/sets/*     → apiLimiter → requireAuth → setsRoutes
    │                     (individual route handlers check role further)
    ├── /api/analytics  → requireAuth → requireRole('principal','hod') → analyticsRoutes
    ├── /api/assessments→ requireAuth → requireRole('student') → assessmentsRoutes
    └── /api/health     → healthRoutes (public)
    │
    ▼
Route handler
    │
    ▼
Response
```

---

## 4. Generation Pipeline Architecture

### 4.1 Overview — Three Input Channels

The platform is board-agnostic. Generation is driven by three independent input channels that a teacher assembles before triggering generation:

```
 ┌─────────────────────────────┐
 │  Channel 1: Blueprint       │  Scheme / past paper / model paper
 │  blueprintInferencer.ts     │  → inferExamBlueprint()
 │  → ExamBlueprint            │  → typeConfig (types, counts, marks, difficulty, tone)
 │  → TypeConfig[]             │
 └──────────────┬──────────────┘
                │
 ┌─────────────────────────────┐
 │  Channel 2: Textbook        │  Full textbook or individual chapters
 │  pdfStructure.ts            │  → bookmarks → heuristics → LLM detection
 │  chapterHeuristics.ts       │  → TextbookChapter documents
 │  chapterLlmDetection.ts     │
 │  → sourceText (per chapter) │  Selected chapters' text concatenated at generation time
 └──────────────┬──────────────┘
                │
 ┌─────────────────────────────┐
 │  Channel 3: Reference Bank  │  Previous year papers / model papers
 │  paperParser.ts             │  → parsePaperIntoQuestions()
 │  → ReferenceExemplar[]      │  → exemplars injected per-type into Groq prompt
 └──────────────┬──────────────┘
                │
                ▼
 ┌─────────────────────────────────────────────────────────┐
 │  generateSet(sourceText, typeConfig, exemplarContext)    │
 │                                                         │
 │  ├── Per type (parallel, Promise.allSettled):           │
 │  │     runTypeLoop(                                      │
 │  │       sourceText,        ← from chapters             │
 │  │       type, count,       ← from blueprint            │
 │  │       marksPerQuestion,  ← from blueprint            │
 │  │       difficulty,        ← from blueprint            │
 │  │       tone,              ← from blueprint            │
 │  │       exemplars[]        ← from reference bank       │
 │  │     )                                                 │
 │  │                                                       │
 │  └── assignGlobalIds() → return blocks + errors         │
 └─────────────────────────────────────────────────────────┘
```

### 4.2 Per-Type Generation Loop

Each type call goes through the same four-stage loop independently.

```
runTypeLoop(sourceText, type, count, marksPerQuestion, difficulty, tone, exemplars)
    │
    ▼
Build prompt:
  - System: type schema + count enforcement + difficulty + tone instruction
  - If exemplars provided: inject "Here are examples from this exam pattern: ..."
  - User: sourceText (truncated to model context limit)
    │
    ▼
[Groq call] — withRetry(3) + withTimeout(30s)
    │
    ├── Parse and validate returned questions (Zod schema)
    │
    ├── [Count matches requested] ──► Trim to exact count, return
    │
    ├── [Count exceeds requested] ──► Trim to exact count, return
    │
    └── [Count short] ──► Retry with shortfall count (max 2 retries)
                           └── [Still short after retries] ──► FailedType error
```

### 4.2 Per-Type Prompt Design

Each type uses a dedicated system prompt that:
- Embeds the source text as context
- States the exact count required (`"Generate exactly N questions"`)
- Provides the full JSON schema for that type
- Explicitly forbids adding extra fields or omitting required fields
- Requires `explanation` on every question

The AI is instructed to return a raw JSON array — no markdown, no wrapping, no prose.

### 4.3 Retry Logic

```
runTypeLoop(sourceText, type, targetCount)
    │
    Attempt 1: request targetCount questions
    │
    ├─ [received >= targetCount] ──► trim to targetCount, done
    │
    └─ [received < targetCount]
              │
              shortfall = targetCount - received
              │
              Attempt 2: request shortfall only (with deduplication instruction)
              │
              ├─ [combined count >= targetCount] ──► trim to targetCount, done
              │
              └─ [still short]
                        │
                        Attempt 3: request shortfall again
                        │
                        ├─ [combined count >= targetCount] ──► done
                        └─ [still short] ──► FailedType { type, requested, received }
```

### 4.4 ID Assignment

After all types are generated, IDs are assigned globally in a single pass to guarantee uniqueness across types. IDs are sequential integers starting at 1. The order of assignment follows the order types were declared in the Teacher's configuration.

```
assignGlobalIds(blocks: QuestionBlock[]) → void
    │
    counter = 1
    │
    For each block in order:
      For each question in block.questions:
        question.id = counter++
```

---

## 5. Validation Layer Architecture

### 5.1 Schema Validation

Every question block is validated against its type's Zod schema immediately after generation. Validation checks:

- Required fields present and correctly typed
- No extra fields beyond the schema
- `explanation` is a non-empty string
- `marks` is a positive number
- `correctAnswer` matches the expected format for the type

### 5.2 Export Validation

Before a download is triggered, `validateExportSet()` runs a full pass:

```
validateExportSet(blocks: QuestionBlock[])
    │
    ├── At least one block exists
    │
    ├── For each block:
    │     ├── validateQuestionBlock(block) — full schema check
    │     └── block.totalMarks === sum(q.marks for q in block.questions)
    │
    ├── All IDs are globally unique
    │
    ├─ [All valid] ──► Export proceeds
    │
    └─ [Any failure] ──► throw ValidationError("Invalid question structure detected.")
                          Export blocked
```

---

## 6. Role Enforcement Architecture

### 6.1 Middleware Chain

```
requireAuth()
    │
    Read Authorization: Bearer <token>
    │
    verifyAccessToken(token)
    │
    ├─ [Valid] ──► Attach req.userId, req.role
    │
    └─ [Invalid / Expired] ──► 401 Unauthorized

requireRole(...allowedRoles)
    │
    ├─ [req.role in allowedRoles] ──► Next handler
    │
    └─ [Not allowed] ──► 403 Forbidden
```

### 6.2 Per-Endpoint Role Gates

| Endpoint | Allowed Roles |
|----------|--------------|
| POST /api/source/upload | teacher |
| POST /api/sets/:id/generate | teacher |
| PATCH /api/sets/:id/questions/:qid | teacher |
| POST /api/sets/:id/regenerate | teacher |
| GET /api/sets/:id/export | teacher |
| POST /api/sets/:id/submit | teacher |
| GET /api/sets (own dept) | teacher, hod |
| POST /api/sets/:id/approve | hod |
| POST /api/sets/:id/request-regeneration | hod |
| GET /api/analytics | hod, principal |
| GET /api/assessments | student |
| GET /api/assessments/:id | student |
| POST /api/schemes/upload | teacher |
| GET /api/schemes | teacher |
| PATCH /api/schemes/:id/replace | teacher |
| DELETE /api/schemes/:id | teacher |
| POST /api/textbooks/upload | teacher |
| POST /api/textbooks/:draftId/confirm | teacher |
| POST /api/chapters/upload | teacher |
| GET /api/chapters | teacher |
| DELETE /api/chapters/:id | teacher |
| POST /api/reference-bank/upload | teacher |
| GET /api/reference-bank | teacher |
| DELETE /api/reference-bank/:bankId | teacher |

---

## 7. Security Architecture

### 7.1 Authentication Flow

```
[Register / Login]
    │
    ▼
bcrypt.hash(password, 12) stored in User.hashedPassword

[On successful login]
    ├── signAccessToken(userId, role) — JWT, 15 min expiry
    │     Signed with JWT_ACCESS_SECRET
    │
    └── createRefreshToken(userId) — nanoid(64) stored in RefreshToken collection
          Set as httpOnly, Secure, SameSite cookie (7 days)

[Authenticated Request]
    │
    requireAuth middleware
    │
    ├── Read Authorization: Bearer <token>
    ├── verifyAccessToken(token) — throws if invalid or expired
    └── Attach req.userId and req.role for downstream use
```

### 7.2 Defence Layers

| Layer | Measure |
|-------|---------|
| HTTP headers | `helmet()` — CSP, X-Frame-Options, HSTS, X-Content-Type-Options |
| CORS | Whitelist-only; checked against `CLIENT_URL` env var |
| Rate limiting | 10/15min on auth; general API rate limit per IP |
| Token budget | Daily per-user Groq token limit; logged per request |
| Password hashing | bcrypt 12 rounds |
| Input validation | Zod schemas on every route before any business logic |
| NoSQL injection | `express-mongo-sanitize` strips `$` and `.` from all request bodies |
| JWT secrets | Startup validation exits the process if secrets are missing |
| Role enforcement | Server-side `requireRole` middleware on all sensitive routes |

---

## 8. Deployment Architecture

```
                    ┌────────────────────────────────┐
                    │          GitHub                │
                    │   main branch push triggers    │
                    └───────────────┬────────────────┘
                                    │
               ┌────────────────────┴──────────────────────┐
               │                                            │
       ┌───────▼────────┐                      ┌───────────▼──────────┐
       │    Vercel       │                      │      Render          │
       │  (Frontend)     │                      │    (Backend)         │
       │                 │                      │                      │
       │  npm run build  │                      │  npm install &&      │
       │  (Vite)         │                      │  npm run build &&    │
       │                 │                      │  node dist/index.js  │
       │  client/dist    │                      │                      │
       │  served globally│                      │  PORT: 3001          │
       │  via Vercel CDN │                      │                      │
       └─────────────────┘                      └──────────┬───────────┘
                                                            │
                                                ┌───────────▼───────────┐
                                                │   MongoDB Atlas       │
                                                │   (Managed Cloud DB)  │
                                                └───────────────────────┘
```

### 8.1 Environment-Specific Behaviour

| Setting | Development | Production |
|---------|-------------|------------|
| `NODE_ENV` | `development` | `production` |
| Cookie `Secure` | false | true |
| Cookie `SameSite` | `lax` | `none` |
| CORS origin | localhost:5173 | `CLIENT_URL` env var |
| Logging | Console + structured JSON | Structured JSON only |

---

## 9. Observability

### 9.1 Logging

Every log entry includes:

```json
{
  "level": "info",
  "event": "generation_complete",
  "requestId": "uuid-per-request",
  "userId": "mongo-object-id",
  "role": "teacher",
  "durationMs": 4210,
  "typesRequested": ["fillInBlanks", "multipleChoice"],
  "typesSucceeded": ["fillInBlanks", "multipleChoice"],
  "typesFailed": [],
  "tokensUsed": 3840
}
```

No PII (emails, passwords, tokens) is written to logs.

### 9.2 Key Events Logged

| Event | Level | When |
|-------|-------|------|
| `generation_complete` | info | Every POST /api/sets/:id/generate completion |
| `generation_type_failed` | warn | A question type fails after all retries |
| `export_triggered` | info | Teacher triggers JSON export |
| `export_validation_failed` | warn | Export blocked due to schema violation |
| `approval_granted` | info | HOD approves a question set |
| `regeneration_requested` | info | HOD requests regeneration for a specific type |
| `groq_retry` | warn | Groq call being retried |
| `token_budget_exceeded` | warn | User over daily token limit |
