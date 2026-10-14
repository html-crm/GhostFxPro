import { hashPassword, verifyPassword, randomToken, hashToken, type Role, type UserStatus } from "@ghostfx/security";
import type { SqlExecutor, UserRow } from "../db.ts";
import { logAudit } from "../audit.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(
  db: SqlExecutor,
  email: string,
): Promise<UserRow | null> {
  const res = await db.query<UserRow>(
    `SELECT * FROM users WHERE email = $1`,
    [normaliseEmail(email)],
  );
  return res.rows[0] ?? null;
}

export async function findUserById(
  db: SqlExecutor,
  userId: string,
): Promise<UserRow | null> {
  const res = await db.query<UserRow>(`SELECT * FROM users WHERE user_id = $1`, [
    userId,
  ]);
  return res.rows[0] ?? null;
}

export interface RegisterInput {
  email: string;
  displayName: string;
  password: string;
}

/** Registers a new user in PENDING status. They cannot trade until approved. */
export async function registerUser(
  db: SqlExecutor,
  input: RegisterInput,
): Promise<UserRow> {
  const email = normaliseEmail(input.email);
  if (!EMAIL_RE.test(email)) throw new Error("invalid_email");
  if (!input.displayName.trim()) throw new Error("invalid_display_name");
  const passwordHash = hashPassword(input.password); // throws if too short
  const res = await db.query<UserRow>(
    `INSERT INTO users (email, display_name, password_hash, role, status, email_verified)
     VALUES ($1, $2, $3, 'USER', 'PENDING', false)
     RETURNING *`,
    [email, input.displayName.trim(), passwordHash],
  );
  const user = res.rows[0] as UserRow;
  await logAudit(db, {
    actorId: user.user_id,
    action: "user.register",
    targetType: "user",
    targetId: user.user_id,
  });
  return user;
}

export async function verifyLogin(
  db: SqlExecutor,
  email: string,
  password: string,
): Promise<UserRow | null> {
  const user = await findUserByEmail(db, email);
  if (!user || !user.password_hash) return null;
  return verifyPassword(password, user.password_hash) ? user : null;
}

const STATUS_ACTIONS: Record<UserStatus, string> = {
  APPROVED: "user.approve",
  REJECTED: "user.reject",
  SUSPENDED: "user.suspend",
  PENDING: "user.restore",
};

/** Admin lifecycle transition. Records who did it and to whom. */
export async function setUserStatus(
  db: SqlExecutor,
  actorId: string,
  userId: string,
  status: UserStatus,
): Promise<UserRow> {
  const res = await db.query<UserRow>(
    `UPDATE users SET status = $2::user_status, updated_at = now()
     WHERE user_id = $1 RETURNING *`,
    [userId, status],
  );
  const user = res.rows[0];
  if (!user) throw new Error("user_not_found");
  await logAudit(db, {
    actorId,
    action: STATUS_ACTIONS[status],
    targetType: "user",
    targetId: userId,
    metadata: { newStatus: status },
  });
  return user;
}

export async function changeRole(
  db: SqlExecutor,
  actorId: string,
  userId: string,
  role: Role,
): Promise<UserRow> {
  const res = await db.query<UserRow>(
    `UPDATE users SET role = $2::user_role, updated_at = now()
     WHERE user_id = $1 RETURNING *`,
    [userId, role],
  );
  const user = res.rows[0];
  if (!user) throw new Error("user_not_found");
  await logAudit(db, {
    actorId,
    action: "user.change_role",
    targetType: "user",
    targetId: userId,
    metadata: { newRole: role },
  });
  return user;
}

export async function listUsers(
  db: SqlExecutor,
  status?: UserStatus,
): Promise<UserRow[]> {
  if (status) {
    const res = await db.query<UserRow>(
      `SELECT * FROM users WHERE status = $1::user_status ORDER BY created_at ASC`,
      [status],
    );
    return res.rows;
  }
  const res = await db.query<UserRow>(`SELECT * FROM users ORDER BY created_at ASC`);
  return res.rows;
}

// ---------------------------------------------------------------------------
// Invitations (admin-controlled onboarding).
// ---------------------------------------------------------------------------

export interface CreatedInvitation {
  invitationId: string;
  token: string;
  expiresAt: Date;
}

export async function createInvitation(
  db: SqlExecutor,
  email: string,
  role: Role,
  createdBy: string | null,
  ttlMs = 7 * 24 * 60 * 60 * 1000,
): Promise<CreatedInvitation> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  const res = await db.query<{ invitation_id: string }>(
    `INSERT INTO invitations (email, role, token_hash, created_by, expires_at)
     VALUES ($1, $2::user_role, $3, $4, $5) RETURNING invitation_id`,
    [normaliseEmail(email), role, hashToken(token), createdBy, expiresAt.toISOString()],
  );
  return { invitationId: res.rows[0]!.invitation_id, token, expiresAt };
}

/**
 * Accepts an invitation: sets the password and marks the email verified. The
 * account remains PENDING (must still be approved) unless it is a SUPER_ADMIN
 * invitation, which is approved after MFA is enabled by the bootstrap flow.
 */
export async function acceptInvitation(
  db: SqlExecutor,
  token: string,
  password: string,
): Promise<{ userId: string; email: string }> {
  const hash = hashToken(token);
  const inv = await db.query<{
    invitation_id: string;
    email: string;
    role: Role;
    used_at: string | null;
    expires_at: string;
  }>(
    `SELECT invitation_id, email, role, used_at, expires_at
     FROM invitations WHERE token_hash = $1`,
    [hash],
  );
  const invitation = inv.rows[0];
  if (!invitation) throw new Error("invalid_invitation");
  if (invitation.used_at) throw new Error("invitation_used");
  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    throw new Error("invitation_expired");
  }

  const passwordHash = hashPassword(password);
  const userRes = await db.query<UserRow>(
    `UPDATE users
     SET password_hash = $2, email_verified = true, updated_at = now()
     WHERE email = $1
     RETURNING *`,
    [invitation.email, passwordHash],
  );
  const user = userRes.rows[0];
  if (!user) throw new Error("user_not_found");

  await db.query(
    `UPDATE invitations SET used_at = now() WHERE invitation_id = $1`,
    [invitation.invitation_id],
  );
  await logAudit(db, {
    actorId: user.user_id,
    action: "invitation.accept",
    targetType: "user",
    targetId: user.user_id,
  });
  return { userId: user.user_id, email: user.email };
}
