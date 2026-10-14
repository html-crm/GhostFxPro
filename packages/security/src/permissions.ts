/** Roles mirror the database `user_role` enum. */
export type Role = "USER" | "ADMIN" | "SUPER_ADMIN";

/** Account lifecycle mirrors the database `user_status` enum. */
export type UserStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

/**
 * The complete permission catalogue. Every administrative capability is named
 * here; nothing is granted implicitly. Persisted to the `permissions` table.
 */
export const PERMISSIONS = {
  USERS_READ: "users.read",
  USERS_APPROVE: "users.approve",
  USERS_REJECT: "users.reject",
  USERS_SUSPEND: "users.suspend",
  USERS_RESTORE: "users.restore",
  ROLES_MANAGE: "roles.manage",
  SESSIONS_REVOKE: "sessions.revoke",
  INTEGRATIONS_READ: "integrations.read",
  INTEGRATIONS_MANAGE: "integrations.manage",
  SYSTEM_HEALTH: "system.health",
  TRADING_DIAGNOSTICS: "trading.diagnostics",
  AUDIT_READ: "audit.read",
  FEATUREFLAGS_MANAGE: "featureflags.manage",
  REPORTS_EXPORT: "reports.export",
  SECURITY_MANAGE: "security.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  [PERMISSIONS.USERS_READ]: "View users",
  [PERMISSIONS.USERS_APPROVE]: "Approve pending users",
  [PERMISSIONS.USERS_REJECT]: "Reject pending users",
  [PERMISSIONS.USERS_SUSPEND]: "Suspend users",
  [PERMISSIONS.USERS_RESTORE]: "Restore suspended users",
  [PERMISSIONS.ROLES_MANAGE]: "Change user roles",
  [PERMISSIONS.SESSIONS_REVOKE]: "Revoke user sessions",
  [PERMISSIONS.INTEGRATIONS_READ]: "View integration configuration",
  [PERMISSIONS.INTEGRATIONS_MANAGE]: "Modify integration configuration",
  [PERMISSIONS.SYSTEM_HEALTH]: "View system health",
  [PERMISSIONS.TRADING_DIAGNOSTICS]: "View trading/reconciliation diagnostics",
  [PERMISSIONS.AUDIT_READ]: "Read the audit log",
  [PERMISSIONS.FEATUREFLAGS_MANAGE]: "Manage feature flags",
  [PERMISSIONS.REPORTS_EXPORT]: "Export authorized reports",
  [PERMISSIONS.SECURITY_MANAGE]: "Manage security settings and sessions",
};

const ADMIN_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.USERS_READ,
  PERMISSIONS.USERS_APPROVE,
  PERMISSIONS.USERS_REJECT,
  PERMISSIONS.USERS_SUSPEND,
  PERMISSIONS.USERS_RESTORE,
  PERMISSIONS.SESSIONS_REVOKE,
  PERMISSIONS.INTEGRATIONS_READ,
  PERMISSIONS.SYSTEM_HEALTH,
  PERMISSIONS.TRADING_DIAGNOSTICS,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.REPORTS_EXPORT,
];

/** Role -> granted permissions. SUPER_ADMIN implicitly holds every permission. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  USER: [],
  ADMIN: ADMIN_PERMISSIONS,
  SUPER_ADMIN: ALL_PERMISSIONS,
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return role === "SUPER_ADMIN" ? ALL_PERMISSIONS : ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/**
 * A user may exercise permissions only when their account is APPROVED. A
 * PENDING/REJECTED/SUSPENDED user never passes a permission check, regardless
 * of role.
 */
export function isAuthorized(
  role: Role,
  status: UserStatus,
  permission: Permission,
): boolean {
  return status === "APPROVED" && hasPermission(role, permission);
}
