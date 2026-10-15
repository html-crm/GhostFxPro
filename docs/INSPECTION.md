# Phase 1 - Repository Inspection Report

Date: 2026-10-14
Target: `C:\GhostFxPro-Main`

## 1. What already exists

| Item | Finding |
| --- | --- |
| Git repository | Initialized, branch `master`, **zero commits** |
| Tracked files | None |
| Untracked files | None (only `.git/` internals) |
| Existing application code | None |
| Existing schema / migrations | None |
| Existing components to reuse | None |
| Existing integrations | None |

**Conclusion:** This is a greenfield repository. There is no working
functionality to preserve, no prior rules to honour, and no legacy data to
migrate. Every architectural decision below is made from scratch.

Because there is no legacy GhostFX code in this repository, the regression
lessons in Part 2 of the brief are treated as **design constraints** rather than
as fixes to existing files. They are encoded directly into the first migration
so the failure modes cannot be introduced later.

## 2. Toolchain reality check

The brief prescribes Rust + Python + TypeScript/Next.js + PostgreSQL + Redis.
An environment audit was performed before choosing technologies (Part 1.2).

| Tool | Required by brief | Present? | Version |
| --- | --- | --- | --- |
| Node.js | Yes (frontend) | **Yes** | v22.20.0 |
| npm | Yes | **Yes** | 10.9.3 |
| pnpm | Optional | No | - |
| Rust / cargo | Yes (execution engine) | **Yes** | 1.95.0 |
| Python | Yes (AI Brain) | **No** | - |
| PostgreSQL (`psql`) | Yes (authoritative records) | **No** | - |
| Docker | Optional (infra) | **No** | - |
| git | Yes | **Yes** | 2.52.0 |

## 3. How the missing tools are handled

Per the approved decision ("adapt to what runs; document deviation"), and the
brief's rules on honest status reporting (Part 1.5):

### 3.1 PostgreSQL (authoritative financial records)

- **Target remains PostgreSQL.** All migrations are written as plain,
  PostgreSQL-native SQL (enums, `uuid`, `numeric`, partial unique indexes,
  triggers, views). They are the single source of truth for the schema.
- **Tests execute against PGlite** (`@electric-sql/pglite`), which is a genuine
  PostgreSQL build compiled to WASM and running in-process. SQL semantics,
  constraints, triggers and numeric behaviour exercised by tests are real
  PostgreSQL behaviour, not an emulation layer.
- **Production deployment** requires a real PostgreSQL server. This is
  **BLOCKED** in the current environment and listed in `docs/ROADMAP.md`.

### 3.2 Python AI Brain

- The AI Brain is a **later phase** (Phase 8). Its boundary is defined now as a
  versioned, JSON-typed decision contract so it can be implemented in Python
  without changing the schema.
- The Python runtime is **not available**. No Python code is written or claimed
  to work. Status: **NOT IMPLEMENTED / BLOCKED** pending an environment that
  can run and test it.

### 3.3 Rust execution engine

- Rust is available and is the intended home of the execution engine, risk
  enforcement, and position-state transitions (Phase 8-9).
- It is not part of this first delivery (Foundation + proven accounting), which
  is intentionally backend-language-neutral SQL and tests.

### 3.4 Redis

- Not required for Phases 1-2. Deferred; will be justified only when caching /
  event fan-out / rate limiting genuinely needs it.

## 4. Operations that could affect real funds or production

**None of the code in this delivery can move funds.** The Phase 1-2 work is
schema, migrations, and read-only tests. No wallet keys are handled, no network
calls to exchanges or RPC providers are made, and no signing code exists yet.

Explicitly out of scope until separately approved:

- Live order submission (Solana, BNB, Robinhood).
- Wallet key creation, import, or signing.
- Any migration of production data.
- Any restart or deployment of production services.

## 5. Architectural risks identified

| # | Risk | Mitigation in this design |
| --- | --- | --- |
| R1 | Trade attribution reuse across same-token trades | Immutable `trade_id`; fills FK to `trade_id`; identity trigger; isolation tests |
| R2 | Float error in money math | All quantities/prices/fees use `numeric`; base units are integer `numeric(38,0)` |
| R3 | Duplicate fills on event replay | `idempotency_key` unique constraint on `fills` |
| R4 | Ambiguous legacy records silently reassigned | Separate `legacy_import_fills` table flagged `needs_reconciliation` |
| R5 | Stale market data driving execution | Decision contract carries quote timestamp/freshness; enforced in Phase 8 |
| R6 | Frontend becoming source of truth | All figures derived from backend/DB; frontend is display only |
| R7 | Silent strategy rule conflicts | Versioned strategy definitions + explicit precedence — implemented: `StrategyRule` priority list, versioned configs, comparison report before activation |

## 6. Status legend used throughout

Implemented - Unit tested - Integration tested - Tested against a real provider -
Simulated - Blocked - Not implemented. Claims only ever use these labels.
