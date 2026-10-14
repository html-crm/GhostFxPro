import type { SqlExecutor } from "../db.ts";
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  type Role,
  type Permission,
} from "@ghostfx/security";

/**
 * Writes the permission catalogue and role grants from code into the database.
 * Idempotent: safe to run on every boot.
 */
export async function seedPermissions(db: SqlExecutor): Promise<void> {
  for (const permission of ALL_PERMISSIONS) {
    await db.query(
      `INSERT INTO permissions (permission, description)
       VALUES ($1, $2)
       ON CONFLICT (permission) DO UPDATE SET description = EXCLUDED.description`,
      [permission, PERMISSION_DESCRIPTIONS[permission]],
    );
  }
  const roles: Role[] = ["USER", "ADMIN", "SUPER_ADMIN"];
  for (const role of roles) {
    const perms: readonly Permission[] =
      role === "SUPER_ADMIN" ? ALL_PERMISSIONS : ROLE_PERMISSIONS[role];
    for (const permission of perms) {
      await db.query(
        `INSERT INTO role_permissions (role, permission)
         VALUES ($1::user_role, $2)
         ON CONFLICT (role, permission) DO NOTHING`,
        [role, permission],
      );
    }
  }
}
