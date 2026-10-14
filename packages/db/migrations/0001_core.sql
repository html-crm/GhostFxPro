-- 0001_core.sql
-- Core domain: users, wallets, tokens, strategies, strategy versions.
-- Money is never stored as float. Identity is never derived from names/symbols.

BEGIN;

CREATE TYPE user_status  AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE user_role    AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');
CREATE TYPE chain_kind   AS ENUM ('SOLANA', 'BNB', 'ROBINHOOD');

-- ---------------------------------------------------------------------------
-- Users. New users default to PENDING and may not trade until APPROVED.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    user_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text NOT NULL,
    email_verified  boolean NOT NULL DEFAULT false,
    display_name    text NOT NULL,
    role            user_role NOT NULL DEFAULT 'USER',
    status          user_status NOT NULL DEFAULT 'PENDING',
    mfa_enabled     boolean NOT NULL DEFAULT false,
    password_hash   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_lower CHECK (email = lower(email))
);

-- ---------------------------------------------------------------------------
-- Wallets. Address is an identifier for a wallet, not for trades.
-- Key material is intentionally NOT stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE wallets (
    wallet_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(user_id),
    chain           chain_kind NOT NULL,
    address         text NOT NULL,
    label           text,
    custody         text NOT NULL DEFAULT 'NON_CUSTODIAL'
                    CHECK (custody IN ('NON_CUSTODIAL', 'UNSUPPORTED')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT wallets_chain_address_unique UNIQUE (chain, address)
);

-- ---------------------------------------------------------------------------
-- Tokens. Identity is (chain, contract_address). The symbol is a display
-- attribute and must never be used to identify a trade or token.
-- ---------------------------------------------------------------------------
CREATE TABLE tokens (
    token_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chain               chain_kind NOT NULL,
    contract_address    text NOT NULL,
    symbol              text NOT NULL,
    name                text,
    decimals            integer NOT NULL CHECK (decimals >= 0 AND decimals <= 36),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tokens_chain_contract_unique UNIQUE (chain, contract_address)
);

-- ---------------------------------------------------------------------------
-- Strategies and immutable, versioned strategy configurations.
-- ---------------------------------------------------------------------------
CREATE TABLE strategies (
    strategy_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid NOT NULL REFERENCES users(user_id),
    name            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT strategies_owner_name_unique UNIQUE (owner_id, name)
);

CREATE TABLE strategy_versions (
    strategy_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id         uuid NOT NULL REFERENCES strategies(strategy_id),
    version             integer NOT NULL CHECK (version > 0),
    config              jsonb NOT NULL,
    config_hash         text NOT NULL,
    is_active           boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT strategy_versions_unique UNIQUE (strategy_id, version)
);

COMMIT;
