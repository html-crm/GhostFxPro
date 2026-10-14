-- 0004_auth.sql
-- Authentication, sessions, MFA, invitations, and RBAC permissions.
--
-- Security notes:
--   * Only hashed session tokens are stored (never the raw token).
--   * TOTP secrets are stored encrypted (AES-256-GCM) by the application layer.
--   * Invitations are single-use and stored as hashes.

BEGIN;

-- ---------------------------------------------------------------------------
-- Sessions: opaque, revocable bearer tokens. token_hash = sha256(raw token).
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
    session_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users(user_id),
    token_hash     text NOT NULL,
    mfa_satisfied  boolean NOT NULL DEFAULT false,
    ip             text,
    user_agent     text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,
    revoked_at     timestamptz,
    CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash)
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- ---------------------------------------------------------------------------
-- MFA (TOTP). Confirmed secrets back users.mfa_enabled.
-- ---------------------------------------------------------------------------
CREATE TABLE mfa_totp (
    user_id        uuid PRIMARY KEY REFERENCES users(user_id),
    secret_enc     text NOT NULL,
    confirmed_at   timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Email verification tokens.
-- ---------------------------------------------------------------------------
CREATE TABLE email_verifications (
    verification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(user_id),
    token_hash      text NOT NULL,
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_verifications_token_unique UNIQUE (token_hash)
);

-- ---------------------------------------------------------------------------
-- Invitations (admin-controlled onboarding). Single use.
-- ---------------------------------------------------------------------------
CREATE TABLE invitations (
    invitation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    role          user_role NOT NULL DEFAULT 'USER',
    token_hash    text NOT NULL,
    created_by    uuid REFERENCES users(user_id),
    expires_at    timestamptz NOT NULL,
    used_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT invitations_token_unique UNIQUE (token_hash)
);

-- ---------------------------------------------------------------------------
-- RBAC. A permission catalogue plus role -> permission grants. The catalogue
-- is seeded from code (see packages/security) so permissions are explicit.
-- ---------------------------------------------------------------------------
CREATE TABLE permissions (
    permission  text PRIMARY KEY,
    description text NOT NULL
);

CREATE TABLE role_permissions (
    role       user_role NOT NULL,
    permission text NOT NULL REFERENCES permissions(permission),
    PRIMARY KEY (role, permission)
);

COMMIT;
