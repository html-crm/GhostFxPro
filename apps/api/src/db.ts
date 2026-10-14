import type { Role, UserStatus } from "@ghostfx/security";

/** Minimal SQL executor abstraction satisfied by both PGlite and `pg`. */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface UserRow {
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  email_verified: boolean;
  mfa_enabled: boolean;
  password_hash: string | null;
  created_at: string;
}

export interface AuthUser {
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  email_verified: boolean;
  mfa_enabled: boolean;
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    user_id: row.user_id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    email_verified: row.email_verified,
    mfa_enabled: row.mfa_enabled,
  };
}
