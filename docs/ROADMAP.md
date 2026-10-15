# GhostFxPro - Phased Delivery Plan

Status legend: **Done** | **In progress** | **Planned** | **Blocked** | **Not started**

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Repository inspection & architecture | **Done** (`docs/INSPECTION.md`, `docs/ARCHITECTURE.md`) |
| 2 | Database schema & identity model | **Done** (`packages/db/migrations`, 13 tests pass) |
| 3 | Auth & secure admin bootstrap | **Done** (`apps/api`, `packages/security`, 45 tests pass) |
| 4 | Frontend design system & navigation | **Done** (`apps/web`, verified running) |
| 5 | Read-only market data & wallet views | **Done for paper** (DEX Screener search + live watch-only wallet balances) |
| 6 | Live open-position interface | **Done for paper** (open/evaluate/close UI + API, passive alerts) |
| 7 | Trade accounting & reconciliation | **Done for paper** (double-entry ledger, exact decimals) |
| 8 | Strategy engine & AI decision pipeline | **Done for paper** (FLEXI engine, risk gates, versioned configs with compare/activate/rollback + explicit rule precedence); AI Brain **Blocked** |
| 9 | Simulated execution (Rust engine) | **Not started** (paper fills are simulated in TS) |
| 10 | Authorized integration testing | **In progress** (status/eligibility page shipped; live execution still blocked — no creds/env) |
| 11 | Security & production-readiness review | **Planned** |

Total automated tests: **192 passing** (60 bot + 13 db + 20 security + 99 api).

## Phase 3 deliverables

- `packages/security`: scrypt password hashing, RFC 6238 TOTP (validated against
  the RFC test vectors), token hashing, AES-256-GCM secret encryption, RBAC.
- `apps/api`: Fastify HTTP API with opaque bearer sessions, MFA, registration,
  admin approval/suspend/restore/role management, server-side permission
  enforcement, audit logging, and an idempotent Super Admin bootstrap.
- Tests: 20 (security) + 25 (api) passing, executed against PGlite.

## Phase 1 deliverables

- Greenfield repo confirmed (zero commits, no code).
- Environment audited; deviations documented (`docs/INSPECTION.md`).
- Authority model + single execution lifecycle defined (`docs/ARCHITECTURE.md`).

## Phase 2 deliverables

- Monorepo scaffolding (npm workspaces).
- PostgreSQL migrations encoding the immutable trade-identity model.
- PGlite-backed regression tests covering the mandatory same-token scenarios.

## Known blockers

| Blocker | Impact | Unblock requires |
| --- | --- | --- |
| No PostgreSQL server | Cannot test migrations on the production engine | Install PostgreSQL or provide a connection string |
| No Python runtime | AI Brain cannot be built/tested | Python 3.x availability |
| No Docker | No containerized Postgres/Redis locally | Docker Desktop |
| No provider credentials/eligibility | No live DEX/CEX/Robinhood execution | Owner-provided approved credentials |

## Guardrails (standing)

- Never deploy, restart production, migrate production data, transfer funds, or
  submit real trades without explicit approval.
- Never close/cancel/stop/flatten an open position or order unless the owner
  authorizes that exact action.
- Live execution stays disabled by default.
