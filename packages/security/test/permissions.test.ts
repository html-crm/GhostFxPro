import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  hasPermission,
  isAuthorized,
  permissionsForRole,
} from "../src/permissions.ts";

test("only SUPER_ADMIN holds every permission", () => {
  assert.equal(permissionsForRole("SUPER_ADMIN").length, ALL_PERMISSIONS.length);
  assert.equal(hasPermission("SUPER_ADMIN", PERMISSIONS.SECURITY_MANAGE), true);
});

test("plain USER holds no administrative permissions", () => {
  assert.deepEqual(permissionsForRole("USER"), []);
  assert.equal(hasPermission("USER", PERMISSIONS.USERS_READ), false);
});

test("ADMIN is scoped and lacks super-admin-only powers", () => {
  assert.equal(hasPermission("ADMIN", PERMISSIONS.USERS_APPROVE), true);
  assert.equal(hasPermission("ADMIN", PERMISSIONS.ROLES_MANAGE), false);
  assert.equal(hasPermission("ADMIN", PERMISSIONS.SECURITY_MANAGE), false);
});

test("non-APPROVED users are never authorized, whatever their role", () => {
  assert.equal(
    isAuthorized("SUPER_ADMIN", "PENDING", PERMISSIONS.SECURITY_MANAGE),
    false,
  );
  assert.equal(
    isAuthorized("ADMIN", "SUSPENDED", PERMISSIONS.USERS_APPROVE),
    false,
  );
  assert.equal(
    isAuthorized("ADMIN", "APPROVED", PERMISSIONS.USERS_APPROVE),
    true,
  );
});
