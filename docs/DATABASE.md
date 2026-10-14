# GhostFxPro - Data Model & Accounting Isolation

This is the authoritative description of the schema in
`packages/db/migrations/`. It exists to make trade attribution mechanically
correct rather than dependent on query discipline.

## 1. Identity model

- **`trades.trade_id`** is a `uuid` primary key generated once at creation and
  made immutable by a trigger. It is the only valid way to identify a trade.
- **`fills`**, **`orders`**, **`decisions`**, **`exit_evaluations`**, and
  **`ledger_entries`** all carry a `trade_id` foreign key.
- A trade is **never** identified by token symbol, mint, contract address,
  wallet address, or strategy name. Those are attributes, not identity.

## 2. ERD (textual)

```
users 1---* wallets
users 1---* trades
users 1---* strategies ---* strategy_versions
strategies 1---* trades           (trade stores strategy_version_id)
wallets 1---* trades
tokens  1---* trades              (token = chain + contract_address)

trades 1---* orders 1---* fills
trades 1---* fills                (fills also FK directly to trade)
trades 1---* decisions
trades 1---* exit_evaluations
trades 1---* ledger_entries
trades 1---  trade_positions      (VIEW, derived; 1:1 on trade_id)

legacy_import_fills               (nullable trade_id, flagged for reconciliation)
audit_log                         (actor, target, action, metadata)
```

## 3. Money representation

- Quantities, base-unit amounts, and fees: `numeric(38,0)` (integer base units).
- Prices and quote amounts: `numeric(38,18)`.
- **No** `real`/`double precision`/float column is used for money, so
  `0.1 * 3` is exactly `0.3`, not `0.30000000000000004`.

## 4. The isolation guarantee

`trade_positions` is a view that aggregates **only** the fills belonging to each
`trade_id`:

- `bought_qty`, `sold_qty`, `open_qty`
- `avg_entry_price` = total buy cost / total buy qty (per trade)
- `total_buy_cost`, `total_buy_fees`, `total_sell_proceeds`, `total_sell_fees`
- `realized_pnl` = sell proceeds - sell fees - avg_entry * sold_qty (per trade)

Because every grouping key is `trade_id`, two trades in the same token cannot
see each other's entry price, quantity, fills, or P&L by construction. The
regression test (`packages/db/test/same-token-accounting.test.ts`) proves this
with three trades in one token.

## 5. Integrity constraints

| Concern | Mechanism |
| --- | --- |
| Immutable trade identity | `enforce_trade_identity_immutable()` trigger rejects changes to `user_id`, `wallet_id`, `token_id`, `chain` |
| Duplicate fill replay | `fills.idempotency_key` UNIQUE |
| Duplicate on-chain fill | partial UNIQUE index on `tx_signature` (non-null) |
| Positive quantities | CHECK `qty_base_units > 0`, fees `>= 0` |
| Ownership integrity | NOT NULL FKs to `trades`, `users`, `wallets`, `tokens` |
| Legacy ambiguity | `legacy_import_fills.needs_reconciliation` defaults true; no auto-assignment |
| Token uniqueness | UNIQUE `(chain, contract_address)` on `tokens` |

## 6. Reconciliation states

`reconciliation_status` distinguishes:

- `CONFIRMED` - matched against a chain receipt / exchange response.
- `PENDING` - submitted, awaiting confirmation.
- `UNAMBIGUOUS_PENDING` - awaiting confirmation but ownership is clear.
- `FLAGGED` - ambiguous; requires human reconciliation.

Historical rows with unclear ownership are **never** silently reassigned.

## 7. Versioning

`strategy_versions` stores an immutable `config` JSON document plus a
`config_hash`. A trade stores the exact `strategy_version_id` it ran under, so
the configuration used by any trade is reproducible after the fact.
