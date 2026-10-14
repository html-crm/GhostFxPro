# GhostFxPro

Production-grade multi-chain crypto trading platform. Built **correctness-first**,
then security, observability, and finally features and visual polish.

> **Status: Phases 1-6 (paper trading).** The trading engine runs in **dry-run
> (paper)** mode only. Live execution is disabled by default and nothing in this
> repo submits real orders. See `docs/ROADMAP.md`.

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

### Try the bot (dry-run)

To exercise the paper engine without the admin-approval ceremony, seed an
already-approved demo trader:

```bash
# PowerShell
$env:DEV_SEED_USER="demo@ghostfx.local"; $env:DEV_SEED_PASSWORD="demo-password-1"; npm run dev
```

Sign in at http://localhost:3000 with `demo@ghostfx.local` /
`demo-password-1`, open a paper position on the **Markets** page, then:

- **Run bot tick** on the Dashboard/Positions to fetch a price and evaluate, or
- **Evaluate** a position with an explicit price to drive the strategy
  deterministically.

The engine arms trailing take-profit at **+7%**, exits on a **2% pullback from
the peak confirmed twice**, and (when configured) honours a hard stop-loss.
Positions, realized/unrealized P&L, decisions, and exit evaluations are all
persisted and visible in the UI. **Nothing here trades real funds.**

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
packages/bot/             strategy engine (FLEXI), risk gates, market data
apps/api/                 Fastify HTTP API (auth, sessions, MFA, admin, paper trading)
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
| Strategy engine (FLEXI) + risk + market data | Implemented, tested (27 tests) |
| Paper trading engine (open/evaluate/close, P&L, ledger) | Implemented, tested (40 tests) |
| Web UI (auth, dashboard, positions, markets, portfolio, history, admin, MFA) | Implemented, verified running |
| Live execution / real DEX orders | Not implemented (requires credentials + explicit approval) |
| Python AI Brain | Blocked (no Python runtime) |

**Total: 100 automated tests passing; all workspaces typecheck clean.**

### Paper engine behaviour

- Immutable `trade_id` per position; two trades in the same token never share
  entry price, quantity, fills, or P&L (covered by tests).
- Exact decimal accounting (BigInt scaled to 18 dp) feeding Postgres `numeric`
  columns; double-entry `ledger_entries` for every fill.
- Every evaluation writes an explainable row to `exit_evaluations` and
  `decisions` (rule, prices, confirmations, quote freshness).
- Stale quotes are rejected rather than acted upon.
- A stop-loss is only active when explicitly configured.

### API surface (trading)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/trading/account` | Simulated balance, equity, P&L |
| GET | `/trading/positions?status=` | Open / closed positions |
| POST | `/trading/positions` | Open a paper position |
| POST | `/trading/positions/:id/evaluate` | Evaluate one trade (price optional) |
| POST | `/trading/positions/:id/close` | Explicit manual close |
| POST | `/trading/tick` | Run one bot iteration over your open trades |
| GET/POST | `/trading/tokens` | List / register tokens |
