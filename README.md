# GhostFxPro

Production-grade multi-chain crypto trading platform. Built **correctness-first**,
then security, observability, and finally features and visual polish.

> **Status: Phases 1-4 in progress.** Nothing in this repo submits real trades.
> Live execution is disabled by default. See `docs/ROADMAP.md`.

## Quick start (local)

```bash
npm install
npm run dev
```

Then open:

- **Web UI:** http://localhost:3000
- **API:** http://127.0.0.1:4000 (`GET /health`)

The API dev server uses **PGlite** (file-persisted PostgreSQL/WASM) in
`.pglite-data/` — no external database required. On first boot it prints a
**single-use invitation token** for the Super Admin. Open the web UI, accept the
invitation, enable MFA, and activate the account.

### Individual services

```bash
npm run dev:api   # API only  (http://127.0.0.1:4000)
npm run dev:web   # web only  (http://localhost:3000)
```

## Tests

```bash
npm test          # all workspaces
npm run db:test   # accounting isolation tests only
```

Tests run against **PGlite** (a real single-process PostgreSQL build compiled to
WASM), so the SQL and constraints exercised are genuine PostgreSQL semantics.

## Layout

```
docs/                     architecture & decision records
packages/db/              PostgreSQL schema, migrations, accounting tests
packages/security/        scrypt, TOTP, AES-GCM, RBAC
apps/api/                 Fastify HTTP API (auth, sessions, MFA, admin)
apps/web/                 Next.js trading terminal UI
scripts/dev.mjs           runs API + web together
```

## Environment (production entrypoint)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `MFA_ENCRYPTION_KEY` | 32-byte key (hex or base64) for TOTP secret encryption |
| `SESSION_TTL_MS` | Session lifetime (default 12h) |
| `PORT`, `HOST` | API listen address |

The production entrypoint (`apps/api/src/server.ts`) uses `pg` and requires a
real PostgreSQL server. It is **UNTESTED** in the current environment (no
PostgreSQL installed). The PGlite dev server is exercised instead.

## Current status

| Area | Status |
| --- | --- |
| Trade-identity schema + accounting isolation | Implemented, tested (13 tests) |
| Security primitives (scrypt/TOTP/AES-GCM/RBAC) | Implemented, tested (20 tests) |
| Auth, sessions, MFA, admin, bootstrap | Implemented, tested (25 tests) |
| Web UI (auth, dashboard, admin, MFA setup) | Implemented, verified running |
| Market data / strategy engine / execution | Not implemented (Phases 5-9) |
| Python AI Brain | Blocked (no Python runtime) |
