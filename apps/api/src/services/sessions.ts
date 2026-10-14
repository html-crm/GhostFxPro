import { randomToken, hashToken } from "@ghostfx/security";
import type { SqlExecutor, UserRow } from "../db.ts";

export interface CreatedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export interface SessionRecord {
  session_id: string;
  user_id: string;
  mfa_satisfied: boolean;
  expires_at: string;
  revoked_at: string | null;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export async function createSession(
  db: SqlExecutor,
  userId: string,
  opts: { mfaSatisfied?: boolean; ip?: string; userAgent?: string; ttlMs?: number } = {},
): Promise<CreatedSession> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? DEFAULT_TTL_MS));
  const res = await db.query<{ session_id: string }>(
    `INSERT INTO sessions (user_id, token_hash, mfa_satisfied, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING session_id`,
    [
      userId,
      hashToken(token),
      opts.mfaSatisfied ?? false,
      opts.ip ?? null,
      opts.userAgent ?? null,
      expiresAt.toISOString(),
    ],
  );
  return { sessionId: res.rows[0]!.session_id, token, expiresAt };
}

/**
 * Resolves a raw bearer token to its user. Returns null for unknown, revoked,
 * or expired tokens.
 */
export async function authenticateSession(
  db: SqlExecutor,
  token: string,
): Promise<{ user: UserRow; session: SessionRecord } | null> {
  const res = await db.query<UserRow & SessionRecord>(
    `SELECT u.*,
            s.session_id, s.mfa_satisfied, s.expires_at, s.revoked_at
     FROM sessions s
     JOIN users u ON u.user_id = s.user_id
     WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  const { session_id, mfa_satisfied, expires_at, revoked_at, ...user } = row;
  return {
    user: user as UserRow,
    session: {
      session_id,
      user_id: row.user_id,
      mfa_satisfied,
      expires_at,
      revoked_at,
    },
  };
}

export async function revokeSessionByToken(
  db: SqlExecutor,
  token: string,
): Promise<boolean> {
  const res = await db.query<{ session_id: string }>(
    `UPDATE sessions SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING session_id`,
    [hashToken(token)],
  );
  return res.rows.length > 0;
}

export async function revokeAllSessions(
  db: SqlExecutor,
  userId: string,
): Promise<void> {
  await db.query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
