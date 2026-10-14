-- 0002_trading.sql
-- Immutable trade identity, orders, and fills.
--
-- Regression lesson (Part 2.1): repeated/concurrent purchases of the same token
-- must never share entry price, quantity, fills, or P&L. Trade identity is a
-- uuid that is generated once and made immutable; every fill carries trade_id.

BEGIN;

CREATE TYPE trade_status          AS ENUM ('OPEN', 'CLOSED', 'RECONCILIATION_REQUIRED', 'CANCELLED');
CREATE TYPE order_side            AS ENUM ('BUY', 'SELL');
CREATE TYPE order_status          AS ENUM ('CREATED', 'AUTHORIZED', 'SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED', 'RECONCILIATION_REQUIRED');
CREATE TYPE fill_source           AS ENUM ('DEX', 'CEX', 'SIMULATED', 'IMPORT');
CREATE TYPE reconciliation_status AS ENUM ('CONFIRMED', 'PENDING', 'UNAMBIGUOUS_PENDING', 'FLAGGED');

-- ---------------------------------------------------------------------------
-- Trades: the immutable root of all accounting.
-- ---------------------------------------------------------------------------
CREATE TABLE trades (
    trade_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(user_id),
    wallet_id           uuid NOT NULL REFERENCES wallets(wallet_id),
    token_id            uuid NOT NULL REFERENCES tokens(token_id),
    chain               chain_kind NOT NULL,
    strategy_version_id uuid REFERENCES strategy_versions(strategy_version_id),
    status              trade_status NOT NULL DEFAULT 'OPEN',
    opened_at           timestamptz NOT NULL DEFAULT now(),
    closed_at           timestamptz,
    note                text,
    CONSTRAINT trades_closed_at_consistency
        CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

-- Trade identity is immutable: token, wallet, chain and owner cannot be
-- rewritten after creation. This blocks the class of bug where accounting is
-- later "fixed" by reassigning a trade to a different token or wallet.
CREATE OR REPLACE FUNCTION enforce_trade_identity_immutable()
RETURNS trigger AS $$
BEGIN
    IF NEW.trade_id <> OLD.trade_id
       OR NEW.user_id <> OLD.user_id
       OR NEW.wallet_id <> OLD.wallet_id
       OR NEW.token_id <> OLD.token_id
       OR NEW.chain <> OLD.chain THEN
        RAISE EXCEPTION
            'trade identity is immutable (trade_id=%)', OLD.trade_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trades_identity_immutable
    BEFORE UPDATE ON trades
    FOR EACH ROW EXECUTE FUNCTION enforce_trade_identity_immutable();

-- ---------------------------------------------------------------------------
-- Orders. Every order belongs to exactly one trade and is idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
    order_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id        uuid NOT NULL REFERENCES trades(trade_id),
    side            order_side NOT NULL,
    order_type      text NOT NULL,
    status          order_status NOT NULL DEFAULT 'CREATED',
    idempotency_key text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orders_idempotency_unique UNIQUE (idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Fills. The authoritative record of what actually happened.
-- All amounts use numeric. Base-unit quantities are integers.
-- ---------------------------------------------------------------------------
CREATE TABLE fills (
    fill_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id            uuid NOT NULL REFERENCES trades(trade_id),
    order_id            uuid REFERENCES orders(order_id),
    side                order_side NOT NULL,
    qty_base_units      numeric(38,0) NOT NULL CHECK (qty_base_units > 0),
    price_quote         numeric(38,18) NOT NULL CHECK (price_quote >= 0),
    fee_base_units      numeric(38,0) NOT NULL DEFAULT 0 CHECK (fee_base_units >= 0),
    fee_quote           numeric(38,18) NOT NULL DEFAULT 0 CHECK (fee_quote >= 0),
    tx_signature        text,
    source              fill_source NOT NULL DEFAULT 'DEX',
    reconciliation_status reconciliation_status NOT NULL DEFAULT 'PENDING',
    filled_at           timestamptz NOT NULL DEFAULT now(),
    -- Idempotency: replaying the same ingestion event must not double-count.
    idempotency_key     text NOT NULL,
    CONSTRAINT fills_idempotency_unique UNIQUE (idempotency_key)
);

-- A single on-chain transaction (when present) may only be ingested once.
CREATE UNIQUE INDEX fills_tx_signature_unique
    ON fills (tx_signature)
    WHERE tx_signature IS NOT NULL;

CREATE INDEX fills_trade_id_idx ON fills (trade_id);
CREATE INDEX fills_order_id_idx ON fills (order_id);

COMMIT;
