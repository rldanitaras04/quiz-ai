# AI-Assisted Secure Examination and Assessment Management System

Next.js + Supabase application for AI-assisted assessment authoring (RAG-grounded
generation, TOS, duplicate/quality gates), a hardened examination engine
(randomized manifests, IndexedDB autosave/offline sync, server-clock
eligibility), identity verification (on-device MediaPipe + faculty manual
fallback), scoring/review, analytics, and role-specific dashboards for
super-admin, faculty, and student.

The authoritative feature list is [`docs/ASSESSMENT_SYSTEM_FEATURES_AND_SCOPE.md`](docs/ASSESSMENT_SYSTEM_FEATURES_AND_SCOPE.md).
Working conventions live in [`docs/MASTER_WORKFLOW.md`](docs/MASTER_WORKFLOW.md),
the UI rules in [`docs/ASSESSMENT_SYSTEM_UI_UX_CONSTITUTION.md`](docs/ASSESSMENT_SYSTEM_UI_UX_CONSTITUTION.md),
and the schema/RLS model in [`docs/ASSESSMENT_SYSTEM_DATABASE_ARCHITECTURE.md`](docs/ASSESSMENT_SYSTEM_DATABASE_ARCHITECTURE.md).

## Stack

- **Next.js 16** (App Router, server actions, route handlers) + React 19 + TypeScript
- **Supabase** — Postgres, RLS, Auth, Storage, Realtime, pg_cron (sweep)
- **AI** — OpenAI / Groq / HuggingFace providers behind a single adapter
  (`src/lib/ai/**`); text embeddings feed the semantic duplicate gate
- **MediaPipe Tasks Vision** — on-device face detection + challenge-response
  liveness at `/student/verify` (no biometric data leaves the browser)
- Chart.js analytics, Tailwind CSS

## Prerequisites

- Node.js 24+ (CI uses Node 24)
- A Supabase project (hosted or local via the Supabase CLI)
- At least one AI provider API key (generation only)

## Setup

```bash
git clone <repo> && cd quiz-ai
npm ci
cp .env.example .env.local        # then fill in real values
npm run db:migrate                # applies supabase/migrations/* in order
npm run dev                       # http://localhost:3000
```

Secrets never leave `.env.local` (gitignored). See [`.env.example`](.env.example)
for every variable and its scope — server-only keys (`SUPABASE_SERVICE_ROLE_KEY`,
AI keys) must never be inlined into the client bundle.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (`tests/*.test.mjs`, Node test runner) |
| `npm run check:routes` | Route ↔ link-wiring guardrails (needs a running server) |
| `npm run test:e2e` | Enrollment/verification E2E incl. exam eligibility (T1–T28) |
| `npm run test:e2e:exam` | Exam security/integrity E2E (sessions, RLS, §39 probes) |
| `npm run test:e2e:sweep` | Scheduled-maintenance sweep E2E (activate/close/release/notify) |
| `npm run test:e2e:ux` | UX/page-status E2E (spawns the built server) |
| `npm run test:e2e:avatar` | Avatar flow (requires `<email> <password>` args) |
| `npm run db:migrate` / `db:migrate:check` | Apply / dry-check migrations |
| `npm run seed:reference` / `seed:question-bank` | Reference data + demo bank |
| `node --env-file=.env.local scripts/diag-*.mjs` | Focused read-only diagnostics (sweep, score, retrieval, generation, notifications, bank-embedding, jobs) |

E2E scripts run against the **real** database and the built server; run
`npm run build` first for the suites that spawn or post server actions
(`test:e2e`, `test:e2e:ux`).

## Verification gates

Run in this order before declaring work done (mirrors
`docs/MASTER_WORKFLOW.md`):

1. `npm run typecheck` — 0 errors
2. `npm run lint` — 0 errors (warning count stays at baseline)
3. `npm test` — all unit tests green
4. `npm run build` — production build succeeds
5. `npm run check:routes` — route guardrails (server running)
6. `npm run test:e2e:exam && npm run test:e2e:sweep && npm run test:e2e`
   — critical E2E against the real DB
7. Diagnostics as needed (`diag-*`)

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to
`main` and every pull request:

- **verify** (always): `npm ci` → typecheck → lint → unit tests → production
  build with placeholder env (Supabase clients are lazy, so no secrets are
  needed and none are exposed to CI).
- **e2e** (manual `workflow_dispatch` for now): boots a **local Supabase
  stack** on the runner (`supabase start` + `supabase db reset`, which also
  proves every migration is idempotent), writes `.env.local` from the stack
  status, builds, and runs `test:e2e`, `test:e2e:exam`, `test:e2e:sweep`.
  Once it has passed a manual run, lift the `if:` on that job to make it a
  required gate too (noted in the workflow itself).

No repository secrets are required by CI — the e2e job talks to its own
ephemeral local database, never to production.

## Environments and deployment (scope §37)

- **Git**: one protected `main` branch; short-lived feature branches; PRs are
  the only merge path — green CI is the merge bar.
- **Preview**: Vercel preview deployments per PR with *preview-only* Supabase
  credentials and its own storage bucket prefix. Never reuse production
  secrets outside production.
- **Production**: Vercel project with production secrets. `vercel.json`
  schedules `run_scheduled_maintenance()` via pg-function HTTP cron (activate /
  close / release / reminders / sweeps); an optional in-database pg_cron
  schedule is best-effort and idempotent either way.
- **Data**: migrations are forward-only, one migration per change, applied by
  `npm run db:migrate` — never edit an applied migration.

## Security model (short version)

- **RLS everywhere**: every table is locked to owner-row / assigned-faculty /
  admin policies; sensitive tables additionally `REVOKE`ed from `authenticated`
  so policies alone are not the only gate (table-level REVOKE beats a policy).
- **Answer keys** never ship to students — manifests are built server-side and
  strip correct answers; scoring runs on the server.
- **Storage**: `source-materials` is a private bucket readable only by faculty
  assigned to the offering; `question-images` is public because exam display
  needs it (the avatar bucket is created outside the migrations).
- **Identity verification (§5)**: replaceable adapter behind
  `src/lib/identity-verification.ts` — MediaPipe on-device capture with
  server-issued challenges, plus an explicit consent record and a
  faculty-authorized manual fallback. Only status + minimal metadata is stored.
- **Exam eligibility** uses server clock only (`src/lib/exam.ts`); attempt
  creation is `REVOKE`d from clients so the gate cannot be bypassed via
  direct PostgREST calls.
