import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { totp } from "@ghostfx/security";
import {
  bootstrapSuperAdmin,
  activateBootstrapAdmin,
} from "../src/services/bootstrap.ts";
import { findUserByEmail } from "../src/services/users.ts";
import { makeTestApp, register, login, authed, type TestApp } from "./helpers.ts";

const SUPER_EMAIL = "danialoo.crypto@gmail.com";

describe("super admin bootstrap and administration", () => {
  let t: TestApp;
  let invitationToken: string;
  let superToken: string;

  before(async () => {
    t = await makeTestApp();

    const first = await bootstrapSuperAdmin(t.db, {
      email: SUPER_EMAIL,
      displayName: "Danialoo",
    });
    assert.equal(first.created, true);
    invitationToken = first.invitationToken!;
    assert.ok(invitationToken);

    // Idempotent: second run must not create or change anything.
    const second = await bootstrapSuperAdmin(t.db, {
      email: SUPER_EMAIL,
      displayName: "Danialoo",
    });
    assert.equal(second.created, false);
    assert.equal(second.alreadyExisted, true);
    assert.equal(second.invitationToken, undefined);
  });

  after(async () => {
    await t.close();
  });

  test("bootstrapped admin starts PENDING, unverified, no password", async () => {
    const admin = await findUserByEmail(t.db, SUPER_EMAIL);
    assert.ok(admin);
    assert.equal(admin.role, "SUPER_ADMIN");
    assert.equal(admin.status, "PENDING");
    assert.equal(admin.email_verified, false);
    assert.equal(admin.password_hash, null);
  });

  test("privilege is not granted from the email string alone", async () => {
    // Logging in is impossible before accepting the invitation (no password).
    const res = await login(t.app, SUPER_EMAIL, "any-password");
    assert.equal(res.statusCode, 401);
  });

  test("admin cannot activate before email verified + MFA enabled", async () => {
    const admin = await findUserByEmail(t.db, SUPER_EMAIL);
    await assert.rejects(
      () => activateBootstrapAdmin(t.db, admin!.user_id),
      /email_not_verified/,
    );
  });

  test("accepting the invitation sets the password and verifies email", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/auth/invitations/accept",
      payload: { token: invitationToken, password: "super-secret-1" },
    });
    assert.equal(res.statusCode, 200);
    const admin = await findUserByEmail(t.db, SUPER_EMAIL);
    assert.equal(admin!.email_verified, true);
    assert.ok(admin!.password_hash);
    // Still PENDING until MFA + explicit activation.
    assert.equal(admin!.status, "PENDING");
  });

  test("reusing the invitation token fails", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/auth/invitations/accept",
      payload: { token: invitationToken, password: "another-pass-1" },
    });
    assert.equal(res.statusCode, 400);
  });

  test("enabling MFA then activating promotes to APPROVED SUPER_ADMIN", async () => {
    const pre = await login(t.app, SUPER_EMAIL, "super-secret-1");
    assert.equal(pre.statusCode, 200);
    const token = pre.json().token as string;

    const setup = await t.app.inject({
      method: "POST",
      url: "/auth/mfa/setup",
      headers: authed(token),
    });
    const secret = setup.json().secret as string;
    const confirm = await t.app.inject({
      method: "POST",
      url: "/auth/mfa/confirm",
      headers: authed(token),
      payload: { code: totp(secret) },
    });
    assert.equal(confirm.statusCode, 200);

    const admin = await findUserByEmail(t.db, SUPER_EMAIL);
    await activateBootstrapAdmin(t.db, admin!.user_id);

    const post = await login(t.app, SUPER_EMAIL, "super-secret-1", totp(secret));
    assert.equal(post.statusCode, 200);
    assert.equal(post.json().user.status, "APPROVED");
    assert.equal(post.json().user.role, "SUPER_ADMIN");
    superToken = post.json().token as string;
  });

  test("unauthenticated admin access is rejected", async () => {
    const res = await t.app.inject({ method: "GET", url: "/admin/users" });
    assert.equal(res.statusCode, 401);
  });

  test("pending approval queue lists new users", async () => {
    await register(t.app, "carol@example.test", "password123", "Carol");
    await register(t.app, "dave@example.test", "password123", "Dave");
    const res = await t.app.inject({
      method: "GET",
      url: "/admin/users/pending",
      headers: authed(superToken),
    });
    assert.equal(res.statusCode, 200);
    const emails = res.json().users.map((u: { email: string }) => u.email);
    assert.ok(emails.includes("carol@example.test"));
    assert.ok(emails.includes("dave@example.test"));
  });

  test("an approved USER still cannot access admin endpoints", async () => {
    // Approve Carol, then verify she is forbidden from admin routes.
    const carol = await findUserByEmail(t.db, "carol@example.test");
    const approve = await t.app.inject({
      method: "POST",
      url: `/admin/users/${carol!.user_id}/approve`,
      headers: authed(superToken),
    });
    assert.equal(approve.statusCode, 200);
    assert.equal(approve.json().user.status, "APPROVED");

    const carolLogin = await login(t.app, "carol@example.test", "password123");
    const carolToken = carolLogin.json().token as string;
    const forbidden = await t.app.inject({
      method: "GET",
      url: "/admin/users",
      headers: authed(carolToken),
    });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().error, "forbidden");
  });

  test("a PENDING user is forbidden even with a valid session", async () => {
    const daveLogin = await login(t.app, "dave@example.test", "password123");
    assert.equal(daveLogin.json().user.status, "PENDING");
    const daveToken = daveLogin.json().token as string;
    const forbidden = await t.app.inject({
      method: "GET",
      url: "/admin/users",
      headers: authed(daveToken),
    });
    assert.equal(forbidden.statusCode, 403);
  });

  test("suspension revokes the user's sessions and blocks login", async () => {
    const carol = await findUserByEmail(t.db, "carol@example.test");
    const carolLogin = await login(t.app, "carol@example.test", "password123");
    const carolToken = carolLogin.json().token as string;

    const suspend = await t.app.inject({
      method: "POST",
      url: `/admin/users/${carol!.user_id}/suspend`,
      headers: authed(superToken),
    });
    assert.equal(suspend.statusCode, 200);
    assert.equal(suspend.json().user.status, "SUSPENDED");

    const me = await t.app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authed(carolToken),
    });
    assert.equal(me.statusCode, 401, "suspended user's session must be revoked");

    const relogin = await login(t.app, "carol@example.test", "password123");
    assert.equal(relogin.statusCode, 403);
    assert.equal(relogin.json().error, "account_suspended");
  });

  test("restoring a user re-enables access", async () => {
    const carol = await findUserByEmail(t.db, "carol@example.test");
    const restore = await t.app.inject({
      method: "POST",
      url: `/admin/users/${carol!.user_id}/restore`,
      headers: authed(superToken),
    });
    assert.equal(restore.statusCode, 200);
    assert.equal(restore.json().user.status, "APPROVED");
    const relogin = await login(t.app, "carol@example.test", "password123");
    assert.equal(relogin.statusCode, 200);
  });

  test("role changes require roles.manage and take effect", async () => {
    const carol = await findUserByEmail(t.db, "carol@example.test");
    const promoted = await t.app.inject({
      method: "POST",
      url: `/admin/users/${carol!.user_id}/role`,
      headers: authed(superToken),
      payload: { role: "ADMIN" },
    });
    assert.equal(promoted.statusCode, 200);
    assert.equal(promoted.json().user.role, "ADMIN");

    const carolLogin = await login(t.app, "carol@example.test", "password123");
    const carolToken = carolLogin.json().token as string;
    const nowAllowed = await t.app.inject({
      method: "GET",
      url: "/admin/users",
      headers: authed(carolToken),
    });
    assert.equal(nowAllowed.statusCode, 200);
  });

  test("invalid role is rejected", async () => {
    const carol = await findUserByEmail(t.db, "carol@example.test");
    const res = await t.app.inject({
      method: "POST",
      url: `/admin/users/${carol!.user_id}/role`,
      headers: authed(superToken),
      payload: { role: "GODMODE" },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "invalid_role");
  });

  test("audit log records privileged actions", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/admin/audit?limit=200",
      headers: authed(superToken),
    });
    assert.equal(res.statusCode, 200);
    const actions = res.json().entries.map((e: { action: string }) => e.action);
    assert.ok(actions.includes("bootstrap.super_admin"));
    assert.ok(actions.includes("user.approve"));
    assert.ok(actions.includes("user.suspend"));
    assert.ok(actions.includes("user.change_role"));
    assert.ok(actions.includes("auth.login"));
  });

  test("health endpoint reports database reachability", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/admin/health",
      headers: authed(superToken),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().database, true);
  });
});
