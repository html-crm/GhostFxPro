# GhostFxPro

Production-grade multi-chain crypto trading platform. Built **correctness-first**,
then security, observability, and finally features and visual polish.

> **Status: Phase 1-2 in progress.** This repository is being built in documented
> phases (see `docs/ROADMAP.md`). Nothing in this repo submits real trades, and
> live execution is disabled by default.

## Start here

- `docs/INSPECTION.md` - repository inspection and environmental reality check.
- `docs/ARCHITECTURE.md` - system architecture, authority model, execution lifecycle.
- `docs/DATABASE.md` - identity model, ERD, and accounting isolation rules.
- `docs/ROADMAP.md` - phased delivery plan and current status.

## Layout

```
GhostFxPro-Main/
  docs/                     architecture & decision records
  packages/
    db/                     PostgreSQL schema, migrations, and accounting tests
  apps/                     (planned) api server + web frontend
```

## Prerequisites (current environment)

- Node.js >= 20 (present: v22)
- Rust toolchain (present: 1.95) - for the execution engine, phased in later
- No Docker / PostgreSQL / Python in the current environment. See
  `docs/INSPECTION.md` for how this is handled and what is deferred.

## Running the accounting tests

```bash
npm install
npm run db:test
```

Tests run against **PGlite** (a real single-process PostgreSQL build compiled to
WASM), so the SQL and constraints exercised are genuine PostgreSQL semantics and
require no external database server.
