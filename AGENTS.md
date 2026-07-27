# Mission Control — Agent Guidelines

This file tells AI coding agents how to work on this repo. Read it before making changes.

## 1. What this project is

Mission Control is a **Next.js 14 dashboard** (App Router) that manages an AI agent orchestration system called **openclaw**. It runs on Node 22+ and uses SQLite via `node:sqlite` (built into Node 22 — no npm sqlite package). The UI is a single-page kanban-style dashboard (`src/app/page.tsx`, ~7700 lines) with API routes for everything else.

The system manages:
- **Agents** — KevBot (main orchestrator), Ricky (research scout), Bernie Mac (Hermes orchestrator). Status, wake controls, token usage tracking.
- **Tasks** — Kanban board (todo / inprogress / done), JSON file-backed.
- **Goals** — Career / personal / business, JSON file-backed.
- **Reminders** — CRUD with completion, atomic file writes via temp+rename.
- **Memory files** — Context files (AGENTS.md, SOUL.md, MEMORY.md, etc.) and daily `.md` logs.
- **Cron jobs** — Scheduler with enable/disable, various schedule kinds (every, at, cron), re-enable guardrails.
- **Twitter queue** — Content posting pipeline with archive.
- **WordPress** — Draft management via proxy.
- **Calendar** — Simple event CRUD.
- **Marketing engine** — Review queue from external SQLite DB.
- **Comms / heartbeats / ideas / subagents / models / services / schedule / KPI / GA** — Various integrations.

## 2. Architecture

```
src/
├── app/
│   ├── layout.tsx          — Root layout, dark mode
│   ├── page.tsx            — Monolithic single-page dashboard (~7700 lines)
│   ├── globals.css         — Tailwind + custom styles
│   └── api/                — Next.js App Router route handlers
│       ├── agents/         — Agent status, usage, wake, control
│       ├── tasks/          — Task CRUD
│       ├── goals/          — Goal CRUD
│       ├── reminders/      — Reminder CRUD (GET/POST/PATCH/DELETE)
│       ├── cron/           — Cron jobs CRUD + runs
│       ├── memory/         — Memory file listing + editing
│       ├── twitter/        — Twitter queue management
│       ├── calendar/       — Calendar event CRUD
│       ├── marketing/      — Marketing review queue
│       ├── comms/          — Communications
│       ├── heartbeats/     — Agent heartbeat status
│       ├── ideas/          — Idea management (inbox/exploring/ready/parked/archived)
│       ├── subagents/      — Subagent management
│       ├── models/         — Model configuration
│       ├── services/       — Service status monitoring
│       ├── schedule/       — Schedule management + calendar sub-route
│       ├── kpi/            — KPI dashboard data (GA, Twitter)
│       ├── ga/             — Google Analytics data + refresh
│       ├── wordpress/      — WordPress draft management
│       ├── bitches/        — (unknown domain)
│       ├── handy-job/      — LLM usage sub-route
│       └── ...             — other API routes
├── components/
│   └── LlmUsageDashboard.tsx — Recharts-based LLM usage charts
└── lib/
    ├── runtime-config.ts       — All env-driven paths, centralized
    ├── twitter-kpi-storage.ts  — SQLite storage for Twitter KPI
    └── openclaw-auth.ts        — OAuth credential resolution
```

### Key patterns

- **File-backed state.** Most data lives in JSON files or SQLite DBs under `data/`. No real database server.
- **Atomic writes.** Reminders use temp-file + rename to avoid corruption.
- **Centralized config.** `src/lib/runtime-config.ts` reads all paths from env vars with sensible defaults. No hardcoded paths in route handlers (except calendar, which has a hardcoded path — that's a bug, not a pattern to copy).
- **`force-dynamic`** on every API route. No caching.
- **No ORM.** Raw SQLite queries or JSON file reads.
- **Dark mode only.** `<html className="dark">` in layout.

## 3. Coding rules

### 3a. Think before coding

Don't assume. State ambiguity explicitly. Push back if a simpler approach exists. Stop and ask rather than guess.

### 3b. Simplicity first

No features beyond what was asked. No abstractions for single-use code. No "flexibility" that wasn't requested. No error handling for impossible scenarios.

### 3c. Surgical changes

Don't "improve" adjacent code. Don't refactor things that aren't broken. Match the existing style even if you'd do it differently. Every changed line should trace directly to the request.

### 3d. Goal-driven execution

Transform "fix the bug" into "write a test that reproduces it, then make it pass." Transform "add validation" into "write tests for invalid inputs, then make them pass."

## 4. Style conventions

- **Imports.** Use `import { NextResponse } from "next/server"`. Prefer `import { promises as fs } from "fs"` over `import * as fs`.
- **Error handling.** Return `NextResponse.json({ error: message }, { status: 500 })`. Log errors with `console.error`.
- **No caching.** Every API route exports `export const dynamic = "force-dynamic"`.
- **Headers.** JSON responses include `headers: { "Cache-Control": "no-store, max-age=0" }`.
- **Config paths.** Add new paths to `src/lib/runtime-config.ts`, never hardcode.
- **Types.** Define inline types near usage, not in separate files.
- **SQLite.** Use `node:sqlite`'s `DatabaseSync` (synchronous API). Schema via `database.exec()`. Prepared statements for writes.

## 5. Environment

Copy `.env.example` to `.env.local` and adjust paths. The project expects:
- `MC_HOME_DIR` — user home
- `MC_CLAWD_DIR` — clawd agent directory
- `MC_SHARED_DIR` — shared files directory
- `MC_OPENCLAW_DIR` — openclaw config directory
- Various optional overrides (see `.env.example`)

## 6. Testing

No test framework is set up. There are no tests. If adding tests, use the existing Node 22+ environment and keep it simple (no extra test framework dependencies unless necessary).

## 7. Build & run

```bash
npm install
npm run dev      # development
npm run build    # production build
npm start        # production server
npm run lint     # ESLint
```
