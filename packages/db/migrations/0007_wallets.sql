-- 0007_wallets.sql
-- Watch-only wallet metadata for Phase 5.
--
-- The `wallets` table already exists (0001_core). Key material is still never
-- stored here: a wallet row is a public address plus a label. Synthetic
-- paper-trading wallets (address `paper:<chain>:<user>`) also live in this
-- table and remain internal.

BEGIN;

ALTER TABLE wallets
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX wallets_user_idx ON wallets (user_id);

COMMIT;
