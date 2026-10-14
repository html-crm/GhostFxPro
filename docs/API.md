# GhostFxPro - API (Phase 3)

Base URL (dev): `http://localhost:4000`

## Authentication model

- **Opaque bearer sessions.** `POST /auth/login` returns a random token; only its
  SHA-256 hash is stored. Send it as `Authorization: Bearer <token>`.
- No cookies are used by the API, so there is no CSRF surface at this layer. The
  Next.js frontend (Phase 4) will hold the token server-side in a `httpOnly`
  cookie and proxy requests.
- Sessions are revocable individually (`logout`) or in bulk (admin).
- Passwords are hashed with scrypt (salted, constant-time verified).
- TOTP secrets are stored AES-256-GCM encrypted with `MFA_ENCRYPTION_KEY`.

## Status and permissions

- New users are `PENDING` and hold **no** permissions.
- Only `APPROVED` users pass authorization checks, regardless of role.
- Roles: `USER`, `ADMIN`, `SUPER_ADMIN`. `SUPER_ADMIN` holds every permission.
- Frontend visibility is cosmetic; all checks are enforced server-side.

## Endpoints

### Public

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/auth/register` | `{email, displayName, password}` | `201 {user}` (PENDING) |
| POST | `/auth/login` | `{email, password, totp?}` | `200 {token, expiresAt, user}` |
| POST | `/auth/invitations/accept` | `{token, password}` | `200 {userId, email}` |
| GET | `/health` | - | `200 {status}` |

### Authenticated

| Method | Path | Result |
| --- | --- | --- |
| GET | `/auth/me` | `200 {user}` |
| POST | `/auth/logout` | `204` (revokes current session) |
| POST | `/auth/mfa/setup` | `200 {secret, otpauthUri}` |
| POST | `/auth/mfa/confirm` | `200 {mfa_enabled}` or `400 invalid_code` |

### Admin (permission-gated)

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/admin/users?status=` | `users.read` |
| GET | `/admin/users/pending` | `users.read` |
| POST | `/admin/users/:id/approve` | `users.approve` |
| POST | `/admin/users/:id/reject` | `users.reject` |
| POST | `/admin/users/:id/suspend` | `users.suspend` + `sessions.revoke` |
| POST | `/admin/users/:id/restore` | `users.restore` |
| POST | `/admin/users/:id/role` | `roles.manage` |
| POST | `/admin/users/:id/revoke-sessions` | `sessions.revoke` |
| GET | `/admin/audit?limit=` | `audit.read` |
| GET | `/admin/health` | `system.health` |

## Error shape

```json
{ "error": "forbidden", "message": "forbidden" }
```

## Super Admin bootstrap

`bootstrapSuperAdmin(db, {email, displayName})` is idempotent and creates the
account **PENDING, unverified, without a password**, plus a single-use invitation
token. Privilege is never derived from the email string.

Activation requires, in order: accept invitation (proves email control) ->
enable MFA -> `activateBootstrapAdmin` (explicit, audited). See `docs/ARCHITECTURE.md`.

## Environment variables (production entrypoint)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `MFA_ENCRYPTION_KEY` | 32-byte key (hex or base64) for TOTP secret encryption |
| `SESSION_TTL_MS` | Session lifetime (default 12h) |
| `PORT`, `HOST` | Listen address |

> The production entrypoint (`apps/api/src/server.ts`) uses `pg` and requires a
> real PostgreSQL server. It is **UNTESTED** in the current environment (no
> PostgreSQL installed). All behaviour above is tested against PGlite.
