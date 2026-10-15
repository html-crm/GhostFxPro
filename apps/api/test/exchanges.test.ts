import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "@ghostfx/security";
import { getExchangeStatus, resolveStablecoin } from "../src/services/exchanges.ts";
import { makeTestApp, login, authed, type TestApp } from "./helpers.ts";

async function userWithStatus(
  t: TestApp,
  email: string,
  status = "APPROVED",
): Promise<string> {
  const hash = hashPassword("password123");
  await t.db.query(
    `INSERT INTO users (email, display_name, password_hash, role, status, email_verified)
     VALUES ($1, 'Trader', $2, 'USER', $3::user_status, true)`,
    [email, hash, status],
  );
  const loginRes = await login(t.app, email, "password123");
  return loginRes.json().token as string;
}

function statusOf(t: TestApp, token: string) {
  return t.app.inject({
    method: "GET",
    url: "/exchange/status",
    headers: authed(token),
  });
}

describe("exchange integration status", () => {
  let t: TestApp;
  let token = "";

  before(async () => {
    t = await makeTestApp();
    token = await userWithStatus(t, "trader@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("reading status requires authentication", async () => {
    const res = await t.app.inject({ method: "GET", url: "/exchange/status" });
    assert.equal(res.statusCode, 401);
  });

  test("a PENDING user cannot read status", async () => {
    const pending = await userWithStatus(t, "pending-trader@example.test", "PENDING");
    const res = await statusOf(t, pending);
    assert.equal(res.statusCode, 403);
  });

  test("live order submission is reported as impossible", async () => {
    const res = await statusOf(t, token);
    assert.equal(res.statusCode, 200);
    const status = res.json().status;
    assert.equal(status.canSubmitLiveOrders, false);
    assert.ok(status.reason.length > 0);
    assert.ok(status.providers.length >= 3);
  });

  test("every venue discloses its reasons, requirements, and limitations", async () => {
    const status = (await statusOf(t, token)).json().status;
    for (const p of status.providers) {
      assert.ok(p.reasons.length > 0, `${p.providerId} has no reasons`);
      assert.ok(p.requirements.length > 0, `${p.providerId} has no requirements`);
      assert.ok(p.limitations.length > 0, `${p.providerId} has no limitations`);
    }
  });

  test("Robinhood is blocked pending credentials and eligibility", async () => {
    const status = (await statusOf(t, token)).json().status;
    const robinhood = status.providers.find((p: { providerId: string }) => p.providerId === "robinhood");
    assert.ok(robinhood);
    assert.equal(robinhood.status, "blocked");
    assert.ok(robinhood.requirements.length > 0);
  });

  test("USDT and USDC are never substituted for one another", async () => {
    const status = (await statusOf(t, token)).json().status;
    const symbols = status.stablecoins.map((s: { symbol: string }) => s.symbol);
    assert.ok(symbols.includes("USDT"));
    assert.ok(symbols.includes("USDC"));

    const usdt = resolveStablecoin("usdt");
    const usdc = resolveStablecoin("USDC");
    assert.notEqual(usdt, usdc);
    assert.equal(usdt?.name, "Tether USD");
    assert.equal(usdc?.name, "USD Coin");
    assert.equal(resolveStablecoin("BUSD"), null);
  });

  test("the summary is stable across calls (pure registry)", () => {
    const a = getExchangeStatus();
    const b = getExchangeStatus();
    assert.equal(a.canSubmitLiveOrders, false);
    assert.deepEqual(a, b);
  });
});

describe("no order surface exists", () => {
  let t: TestApp;
  let token = "";

  before(async () => {
    t = await makeTestApp();
    token = await userWithStatus(t, "no-orders@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("order, quote, and transfer routes are not registered", async () => {
    for (const [method, url] of [
      ["POST", "/exchange/orders"],
      ["POST", "/exchange/quote"],
      ["POST", "/exchange/transfers"],
      ["GET", "/exchange/orders"],
    ] as const) {
      const res = await t.app.inject({ method, url, headers: authed(token) });
      assert.equal(res.statusCode, 404, `${method} ${url} should not exist`);
    }
  });
});
