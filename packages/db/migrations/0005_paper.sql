-- 0005_paper.sql
-- Paper (dry-run) trading support. Nothing here touches real funds.
--
-- Trades gain an explicit execution mode. Per-trade strategy state is stored
-- separately so exit logic is reproducible and never inferred from P&L.

BEGIN;

-- Execution mode is explicit and defaults to the only safe mode.
ALTER TABLE trades
    ADD COLUMN mode text NOT NULL DEFAULT 'PAPER'
    CHECK (mode IN ('PAPER', 'LIVE'));

-- Per-user simulated account balance, in the quote asset (USD).
CREATE TABLE paper_accounts (
    user_id         uuid PRIMARY KEY REFERENCES users(user_id),
    initial_balance numeric(38,18) NOT NULL CHECK (initial_balance >= 0),
    cash_balance    numeric(38,18) NOT NULL CHECK (cash_balance >= 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Live strategy state for an open trade. One row per trade (isolation).
CREATE TABLE trade_strategy_state (
    trade_id               uuid PRIMARY KEY REFERENCES trades(trade_id),
    peak_price             numeric(38,18) NOT NULL,
    tp_armed               boolean NOT NULL DEFAULT false,
    trailing_confirmations integer NOT NULL DEFAULT 0
                           CHECK (trailing_confirmations >= 0),
    state_version          integer NOT NULL DEFAULT 0 CHECK (state_version >= 0),
    last_price             numeric(38,18),
    last_evaluated_at      timestamptz,
    updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trades_user_status_idx ON trades (user_id, status);
CREATE INDEX trades_mode_idx        ON trades (mode);

COMMIT;
