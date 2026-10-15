-- 0006_alerts.sql
-- Passive, user-configured alerts. Alerts observe; they never act.
--
-- An alert records that a condition became true. It can never place an order,
-- move funds, or alter a position. Rules reference a token by its identity
-- (chain, contract_address); the symbol is a display attribute only.

BEGIN;

CREATE TYPE alert_kind AS ENUM (
    'PRICE_ABOVE',
    'PRICE_BELOW',
    'PCT_MOVE_UP',
    'PCT_MOVE_DOWN',
    'POSITION_OPENED',
    'POSITION_CLOSED'
);

-- ---------------------------------------------------------------------------
-- Rules. Each rule must carry exactly the values its kind requires.
-- ---------------------------------------------------------------------------
CREATE TABLE alert_rules (
    alert_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES users(user_id),
    kind              alert_kind NOT NULL,
    chain             chain_kind NOT NULL,
    contract_address  text NOT NULL,
    symbol            text NOT NULL,
    threshold         numeric(38,18) CHECK (threshold IS NULL OR threshold >= 0),
    pct               numeric(18,10) CHECK (pct IS NULL OR (pct > 0 AND pct <= 100)),
    baseline_price    numeric(38,18) CHECK (baseline_price IS NULL OR baseline_price >= 0),
    one_shot          boolean NOT NULL DEFAULT true,
    cooldown_ms       integer NOT NULL DEFAULT 0 CHECK (cooldown_ms >= 0),
    is_active         boolean NOT NULL DEFAULT true,
    last_triggered_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alert_rules_kind_values CHECK (
        (kind IN ('PRICE_ABOVE', 'PRICE_BELOW')
            AND threshold IS NOT NULL AND pct IS NULL)
        OR (kind IN ('PCT_MOVE_UP', 'PCT_MOVE_DOWN')
            AND pct IS NOT NULL AND threshold IS NULL)
        OR (kind IN ('POSITION_OPENED', 'POSITION_CLOSED')
            AND threshold IS NULL AND pct IS NULL)
    )
);

CREATE INDEX alert_rules_user_active_idx ON alert_rules (user_id, is_active);
CREATE INDEX alert_rules_token_idx       ON alert_rules (chain, contract_address);

-- ---------------------------------------------------------------------------
-- Events. The durable record of a rule firing. Never rewritten after insert.
-- ---------------------------------------------------------------------------
CREATE TABLE alert_events (
    event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id        uuid NOT NULL REFERENCES alert_rules(alert_id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(user_id),
    kind            alert_kind NOT NULL,
    observed_value  numeric(38,18),
    threshold       numeric(38,18),
    reason          text NOT NULL,
    quote_source    text,
    market_data_ts  timestamptz,
    fired_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_events_user_fired_idx ON alert_events (user_id, fired_at DESC);
CREATE INDEX alert_events_alert_idx      ON alert_events (alert_id);

COMMIT;
