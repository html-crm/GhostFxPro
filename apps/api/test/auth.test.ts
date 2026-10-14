import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { totp } from "@ghostfx/security";
import { makeTestApp, register, login, authed, type TestApp } from "./helpers.ts";

describe("authentication", () => {
  let t: TestApp;
  before(async () => {
    t = await makeTestApp();
  });
  after(async () => {
    await t.close();
  });

  test("registration creates a PENDING user with no privileges", async () => {
    const res = await register(t.app, "alice@example.test", "password123", "Alice");
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.user.status, "PENDING");
    assert.equal(body.user.role, "USER");
    assert.equal(body.user.mfa_enabled, false);
    assert.equal(body.user.password_hash, undefined, "must not leak password hash");
  });

  test("duplicate registration is rejected", async () => {
    const res = await register(t.app, "alice@example.test", "password123");
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, "email_taken");
  });

  test("weak password is rejected", async () => {
    const res = await register(t.app, "weak@example.test", "short");
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "weak_password");
  });

  test("login succeeds for a pending user but reports PENDING status", async () => {
    const res = await login(t.app, "alice@example.test", "password123");
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().token);
    assert.equal(res.json().user.status, "PENDING");
  });

  test("login with wrong password is rejected", async () => {
    const res = await login(t.app, "alice@example.test", "wrong-password");
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, "invalid_credentials");
  });

  test("/auth/me requires a valid session", async () => {
    const anon = await t.app.inject({ method: "GET", url: "/auth/me" });
    assert.equal(anon.statusCode, 401);

    const bad = await t.app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authed("not-a-real-token"),
    });
    assert.equal(bad.statusCode, 401);
    assert.equal(bad.json().error, "invalid_session");

    const ok = await login(t.app, "alice@example.test", "password123");
    const token = ok.json().token as string;
    const me = await t.app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authed(token),
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, "alice@example.test");
  });

  test("logout revokes the session", async () => {
    const ok = await login(t.app, "alice@example.test", "password123");
    const token = ok.json().token as string;
    const logout = await t.app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: authed(token),
    });
    assert.equal(logout.statusCode, 204);
    const me = await t.app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authed(token),
    });
    assert.equal(me.statusCode, 401, "revoked token must not work");
  });

  test("MFA: setup, confirm, then login requires a valid TOTP", async () => {
    await register(t.app, "bob@example.test", "password123", "Bob");
    const first = await login(t.app, "bob@example.test", "password123");
    const token = first.json().token as string;

    const setup = await t.app.inject({
      method: "POST",
      url: "/auth/mfa/setup",
      headers: authed(token),
    });
    assert.equal(setup.statusCode, 200);
    const secret = setup.json().secret as string;
    assert.match(setup.json().otpauthUri, /^otpauth:\/\/totp\//);

    const badConfirm = await t.app.inject({
      method: "POST",
      url: "/auth/mfa/confirm",
      headers: authed(token),
      payload: { code: "000000" },
    });
    // A wrong code is rejected; "000000" could rarely be valid, use malformed.
    const malformed = await t.app.inject({
      method: "POST",
      url: "/auth/mfa/confirm",
      headers: authed(token),
      payload: { code: "abcdef" },
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.json().error, "invalid_code");
    void badConfirm;

    const goodConfirm = await t.app.inject({
      method: "POST",
      url: "/auth/mfa/confirm",
      headers: authed(token),
      payload: { code: totp(secret) },
    });
    assert.equal(goodConfirm.statusCode, 200);
    assert.equal(goodConfirm.json().mfa_enabled, true);

    // Now a fresh login must present a TOTP.
    const noTotp = await login(t.app, "bob@example.test", "password123");
    assert.equal(noTotp.statusCode, 401);
    assert.equal(noTotp.json().error, "mfa_required");

    const wrongTotp = await login(t.app, "bob@example.test", "password123", "000000");
    assert.equal(wrongTotp.statusCode, 401);
    assert.equal(wrongTotp.json().error, "mfa_invalid");

    const withTotp = await login(t.app, "bob@example.test", "password123", totp(secret));
    assert.equal(withTotp.statusCode, 200);
    assert.equal(withTotp.json().user.mfa_enabled, true);
  });

  test("registration audit entry is recorded", async () => {
    const res = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE action = 'user.register'`,
    );
    assert.ok(Number(res.rows[0]!.n) >= 2);
  });
});
