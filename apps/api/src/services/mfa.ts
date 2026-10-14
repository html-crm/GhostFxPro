import {
  encryptSecret,
  decryptSecret,
  generateTotpSecret,
  verifyTotp,
  otpauthUri,
} from "@ghostfx/security";
import type { SqlExecutor } from "../db.ts";
import { logAudit } from "../audit.ts";

export interface MfaSetup {
  secret: string;
  otpauthUri: string;
}

/**
 * Creates (or replaces) an unconfirmed TOTP secret for a user. The secret is
 * stored encrypted at rest and is only activated after `confirmMfa`.
 */
export async function setupMfa(
  db: SqlExecutor,
  userId: string,
  encryptionKey: Buffer,
  account: string,
): Promise<MfaSetup> {
  const secret = generateTotpSecret();
  const secretEnc = encryptSecret(secret, encryptionKey);
  await db.query(
    `INSERT INTO mfa_totp (user_id, secret_enc, confirmed_at)
     VALUES ($1, $2, NULL)
     ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, confirmed_at = NULL`,
    [userId, secretEnc],
  );
  return { secret, otpauthUri: otpauthUri(secret, account) };
}

/** Verifies a code against the user's stored secret using the given timestamp. */
export async function verifyUserMfa(
  db: SqlExecutor,
  userId: string,
  code: string,
  encryptionKey: Buffer,
  atMs: number = Date.now(),
): Promise<boolean> {
  const res = await db.query<{ secret_enc: string }>(
    `SELECT secret_enc FROM mfa_totp WHERE user_id = $1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return false;
  const secret = decryptSecret(row.secret_enc, encryptionKey);
  return verifyTotp(secret, code, atMs);
}

/** Confirms a pending MFA secret and enables MFA on the account. */
export async function confirmMfa(
  db: SqlExecutor,
  userId: string,
  code: string,
  encryptionKey: Buffer,
  atMs: number = Date.now(),
): Promise<boolean> {
  if (!(await verifyUserMfa(db, userId, code, encryptionKey, atMs))) {
    return false;
  }
  await db.query(`UPDATE mfa_totp SET confirmed_at = now() WHERE user_id = $1`, [
    userId,
  ]);
  await db.query(
    `UPDATE users SET mfa_enabled = true, updated_at = now() WHERE user_id = $1`,
    [userId],
  );
  await logAudit(db, {
    actorId: userId,
    action: "mfa.enabled",
    targetType: "user",
    targetId: userId,
  });
  return true;
}
