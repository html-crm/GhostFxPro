-- 0003_accounting.sql
-- Accounting ledger, decision audit trail, exit evaluations, legacy
-- reconciliation staging, admin audit log, and the isolation view.

BEGIN;

-- Double-entry style accounting entries. Every entry references a trade.
CREATE TYPE ledger_direction AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE ledger_entries (
    ledger_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id        uuid NOT NULL REFERENCES trades(trade_id),
    fill_id         uuid REFERENCES fills(fill_id),
    account         text NOT NULL,
    direction       ledger_direction NOT NULL,
    amount          numeric(38,18) NOT NULL CHECK (amount >= 0),
    asset           text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    idempotency_key text NOT NULL,
    CONSTRAINT ledger_entries_idempotency_unique UNIQUE (idempotency_key)
);

-- Strategy/AI decisions. Always scoped to a trade (or an intended new trade
-- via intent_id) and always carries market-data timestamp + freshness.
CREATE TABLE decisions (
    decision_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id            uuid REFERENCES trades(trade_id),
    intent_id           uuid,
    strategy_version_id uuid REFERENCES strategy_versions(strategy_version_id),
    decision            text NOT NULL
                        CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'WAIT_OBSERVE', 'REJECT')),
    confidence          numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    market_data_ts      timestamptz NOT NULL,
    quote_source        text NOT NULL,
    position_state_version integer NOT NULL DEFAULT 0,
    reasons             jsonb NOT NULL DEFAULT '[]'::jsonb,
    expires_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT decisions_scope_present CHECK (trade_id IS NOT NULL OR intent_id IS NOT NULL)
);

-- Every exit evaluation is explainable after the fact.
CREATE TABLE exit_evaluations (
    exit_evaluation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id            uuid NOT NULL REFERENCES trades(trade_id),
    strategy_version_id uuid REFERENCES strategy_versions(strategy_version_id),
    entry_price         numeric(38,18) NOT NULL,
    current_price       numeric(38,18) NOT NULL,
    highest_price       numeric(38,18),
    tp_armed            boolean NOT NULL DEFAULT false,
    trailing_threshold  numeric(38,18),
    stop_loss_state     text,
    confirmation_count  integer NOT NULL DEFAULT 0,
    quote_ts            timestamptz NOT NULL,
    quote_fresh         boolean NOT NULL,
    triggering_rule     text,
    result              text NOT NULL,
    rejection_reason    text,
    fill_price          numeric(38,18),
    fill_fees           numeric(38,18),
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Historical records with ambiguous ownership are staged here and flagged.
-- They are NEVER auto-assigned to a trade. A human/approved job reconciles them.
CREATE TABLE legacy_import_fills (
    legacy_fill_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id            uuid REFERENCES trades(trade_id),   -- intentionally nullable
    token_symbol        text,
    token_contract      text,
    wallet_address      text,
    side                order_side,
    qty_base_units      numeric(38,0),
    price_quote         numeric(38,18),
    fee_quote           numeric(38,18),
    raw                 jsonb NOT NULL DEFAULT '{}'::jsonb,
    needs_reconciliation boolean NOT NULL DEFAULT true,
    resolved_at         timestamptz,
    imported_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT legacy_resolved_consistency
        CHECK ((needs_reconciliation = false) = (resolved_at IS NOT NULL))
);

-- Privileged/admin action audit trail.
CREATE TABLE audit_log (
    audit_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id     uuid REFERENCES users(user_id),
    action       text NOT NULL,
    target_type  text,
    target_id    text,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The isolation view. Every aggregate is grouped by trade_id, so two trades in
-- the same token can never observe each other's numbers.
-- ---------------------------------------------------------------------------
CREATE VIEW trade_positions AS
WITH buy AS (
    SELECT trade_id,
           SUM(qty_base_units)          AS qty,
           SUM(qty_base_units * price_quote) AS cost,
           SUM(fee_quote)               AS fees
    FROM fills
    WHERE side = 'BUY'
    GROUP BY trade_id
),
sell AS (
    SELECT trade_id,
           SUM(qty_base_units)          AS qty,
           SUM(qty_base_units * price_quote) AS proceeds,
           SUM(fee_quote)               AS fees
    FROM fills
    WHERE side = 'SELL'
    GROUP BY trade_id
)
SELECT
    t.trade_id,
    t.user_id,
    t.wallet_id,
    t.token_id,
    t.chain,
    t.status,
    t.strategy_version_id,
    COALESCE(b.qty, 0)                                   AS bought_qty,
    COALESCE(s.qty, 0)                                   AS sold_qty,
    COALESCE(b.qty, 0) - COALESCE(s.qty, 0)              AS open_qty,
    CASE WHEN COALESCE(b.qty, 0) > 0
         THEN b.cost / b.qty
         ELSE NULL END                                   AS avg_entry_price,
    COALESCE(b.cost, 0)                                  AS total_buy_cost,
    COALESCE(b.fees, 0)                                  AS total_buy_fees,
    COALESCE(s.proceeds, 0)                              AS total_sell_proceeds,
    COALESCE(s.fees, 0)                                  AS total_sell_fees,
    CASE WHEN COALESCE(b.qty, 0) > 0
         THEN COALESCE(s.proceeds, 0) - COALESCE(s.fees, 0)
              - (b.cost / b.qty) * COALESCE(s.qty, 0)
         ELSE 0 END                                      AS realized_pnl
FROM trades t
LEFT JOIN buy  b ON b.trade_id = t.trade_id
LEFT JOIN sell s ON s.trade_id = t.trade_id;

COMMIT;
