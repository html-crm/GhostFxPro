import type { SqlExecutor } from "../db.ts";
import { logAudit } from "../audit.ts";
import { findUserByEmail, normaliseEmail, createInvitation } from "./users.ts";
import { seedPermissions } from "./permissions.ts";

export interface BootstrapResult {
  created: boolean;
  alreadyExisted: boolean;
  userId: string;
  invitationToken?: string;
  invitationExpiresAt?: Date;
}

export interface BootstrapInput {
  email: string;
  displayName: string;
  /** Optional fixed clock for deterministic tests. */
  now?: Date;
}

/**
 * One-time, idempotent provisioning of the initial Super Admin.
 *
 * Guarantees:
 *   * Privileges are never granted merely because an email string matches.
 *     The account is created PENDING, unverified, and with no password.
 *   * The only way in is a single-use invitation token (proving control of the
 *     inbox / an admin-controlled channel) followed by mandatory MFA and an
 *     explicit activation step.
 *   * Re-running this function never mutates an existing account.
 */
export async function bootstrapSuperAdmin(
  db: SqlExecutor,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  await seedPermissions(db);

  const email = normaliseEmail(input.email);
  const existing = await findUserByEmail(db, email);
  if (existing) {
    return {
      created: false,
      alreadyExisted: true,
      userId: existing.user_id,
    };
  }

  const res = await db.query<{ user_id: string }>(
    `INSERT INTO users (email, display_name, role, status, email_verified)
     VALUES ($1, $2, 'SUPER_ADMIN', 'PENDING', false)
     RETURNING user_id`,
    [email, input.displayName],
  );
  const userId = res.rows[0]!.user_id;

  const invitation = await createInvitation(db, email, "SUPER_ADMIN", userId);

  await logAudit(db, {
    actorId: null,
    action: "bootstrap.super_admin",
    targetType: "user",
    targetId: userId,
    metadata: { email },
  });

  return {
    created: true,
    alreadyExisted: false,
    userId,
    invitationToken: invitation.token,
    invitationExpiresAt: invitation.expiresAt,
  };
}

/**
 * Activates a bootstrapped Super Admin. Requires that the account has since
 * verified its email (by accepting the invitation) and enabled MFA. This is a
 * deliberate, auditable step - it cannot be triggered by email alone.
 */
export async function activateBootstrapAdmin(
  db: SqlExecutor,
  userId: string,
  actorId: string | null = null,
): Promise<void> {
  const res = await db.query<{
    role: string;
    email_verified: boolean;
    mfa_enabled: boolean;
  }>(
    `SELECT role, email_verified, mfa_enabled FROM users WHERE user_id = $1`,
    [userId],
  );
  const user = res.rows[0];
  if (!user) throw new Error("user_not_found");
  if (user.role !== "SUPER_ADMIN") throw new Error("not_super_admin");
  if (!user.email_verified) throw new Error("email_not_verified");
  if (!user.mfa_enabled) throw new Error("mfa_not_enabled");

  await db.query(
    `UPDATE users SET status = 'APPROVED', updated_at = now() WHERE user_id = $1`,
    [userId],
  );
  await logAudit(db, {
    actorId,
    action: "bootstrap.activate_super_admin",
    targetType: "user",
    targetId: userId,
  });
}
