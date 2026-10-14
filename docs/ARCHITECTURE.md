# GhostFxPro - System Architecture

> Phase 1 output. Technology choices are recorded here after repository
> inspection, per Part 1.2. Deviations from the prescribed stack are explicitly
> justified in `docs/INSPECTION.md`.

## 1. Technology decisions (recorded)

| Layer | Chosen technology | Status | Rationale |
| --- | --- | --- | --- |
| Authoritative data | **PostgreSQL** (SQL migrations) | Implemented (schema) | Immutable identity, FK/unique constraints, `numeric` money, transactions |
| Schema test runtime | **PGlite** (in-process PostgreSQL/WASM) | Implemented | Real PG semantics without an external server; env has no Postgres |
| Security primitives | **Node/TypeScript** (`packages/security`) | Implemented + tested | scrypt, TOTP, AES-GCM, RBAC; runtime available |
| API server | **Fastify / TypeScript** (`apps/api`) | Implemented + tested | Auth, sessions, MFA, admin, RBAC; Node available |
| Execution engine | **Rust** | Not implemented (Phase 9) | Available; correct home for risk + state transitions |
| AI Brain | **Python** | Blocked (Phase 8) | Python not installed; boundary defined, not implemented |
| Frontend | **Next.js / React / TS** (planned) | Not implemented (Phase 5) | Required by brief; Node available |
| Live transport | **SSE + WebSocket / polling fallback** | Not implemented (Phase 6) | To be chosen when the live screen lands |
| Cache/events | **Redis** | Deferred | Only when justified |

Frontend and API are TypeScript, not Rust, because frontend/UX is not
performance- or memory-safety-critical, while order execution and financial
state transitions are. Rust is reserved for the engine and Rust never silently
disregards an authorized strategy decision.

## 2. Authority model (who owns what)

| Component | Authority | Must NOT |
| --- | --- | --- |
| Market data | Supplies observations, never guarantees | Be treated as an executable price |
| Strategy engine | Evaluates configured rules -> a decision | Execute an order |
| AI Brain (Python) | Analysis / authorized recommendation within its role | Sign transactions or bypass Rust safety controls |
| Risk engine | Applies mandatory safety constraints | Be bypassed by strategy or AI |
| Rust execution engine | Validates current state and executes authorized orders | Trust stale/expired decisions |
| Accounting service | Records actual fills, fees, position changes | Report an order complete before confirmation |
| Frontend | Displays backend state | Become the source of truth |

## 3. The one authoritative execution lifecycle

```
Market data --> validation --> strategy evaluation --> decision
      --> risk checks --> order authorization --> execution
      --> receipt/fill reconciliation --> position update
      --> accounting ledger --> frontend event
```

Every transition has a single owner and a recorded outcome. No component may
create a contradictory position state or report completion before authoritative
confirmation. The data foundation for this lifecycle is the schema in
`packages/db/migrations` (trades, orders, fills, decisions, ledger entries,
exit evaluations).

## 4. Financial integrity rules (enforced at the database)

1. Every trade has a globally unique, immutable `trade_id` (`uuid` PK).
2. Every order, fill, swap, and strategy cycle references its owning trade.
3. Trades are **never** identified by symbol, mint, contract, wallet, or name.
4. Repeated purchases of the same token cannot reuse another trade's values.
5. Concurrent same-token trades remain independent.
6. Additional buys attach to the intended trade via an explicit validated op.
7. Fills reconcile against chain receipts / exchange responses
   (`reconciliation_status`).
8. Ambiguous history is flagged, never guessed (`legacy_import_fills`).
9. Money uses `numeric` (integer base units / decimal), never binary float.
10. Idempotency keys make fill ingestion safe to replay.

See `docs/DATABASE.md` for the concrete schema and ERD.

## 5. Security posture (design goals, phased)

- Server-side authorization on every request; frontend hiding is cosmetic only.
- Users start `PENDING` and cannot trade until an admin approves.
- Never log or return passwords, seed phrases, private keys, or API secrets.
- Secrets only via environment / secret manager; never in the repo.
- Row-level isolation: a user can never read another user's rows by changing an id.

## 6. Observability (design goals, phased)

- Every execution decision records the reason, inputs, and outcome.
- Structured audit log for every privileged/admin action.
- Provider health, data freshness, and reconciliation status are first-class
  values surfaced to the UI, not inferred on the frontend.

## 7. Explicit non-goals for the current delivery

- No live trading, no signing, no exchange/RPC network calls.
- No production deployment.
- No responsive UI yet (Phase 4-6). Correctness precedes polish by mandate.
