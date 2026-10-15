import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "@ghostfx/security";
import { MockProvider } from "@ghostfx/bot";
import { makeTestApp, login, authed, type TestApp } from "./helpers.ts";

const NOW = 1_700_000_000_000;

async function approvedUser(
  t: TestApp,
  email: string,
  status = "APPROVED",
): Promise<{ userId: string; token: string }> {
  const hash = hashPassword("password123");
  const res = await t.db.query<{ user_id: string }>(
    `INSERT INTO users (email, display_name, password_hash, role, status, email_verified)
     VALUES ($1, 'Observer', $2, 'USER', $3::user_status, true)
     RETURNING user_id`,
    [email, hash, status],
  );
  const loginRes = await login(t.app, email, "password123");
  return { userId: res.rows[0]!.user_id, token: loginRes.json().token as string };
}

function createAlert(
  t: TestApp,
  token: string,
  payload: Record<string, unknown>,
) {
  return t.app.inject({
    method: "POST",
    url: "/alerts",
    headers: authed(token),
    payload,
  });
}

describe("alert management", () => {
  let t: TestApp;
  let user: { userId: string; token: string };

  before(async () => {
    t = await makeTestApp({ now: () => NOW });
    user = await approvedUser(t, "watcher@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("listing alerts requires authentication", async () => {
    const res = await t.app.inject({ method: "GET", url: "/alerts" });
    assert.equal(res.statusCode, 401);
  });

  test("a PENDING user cannot use alerts", async () => {
    const pending = await approvedUser(t, "pending-watcher@example.test", "PENDING");
    const res = await t.app.inject({
      method: "GET",
      url: "/alerts",
      headers: authed(pending.token),
    });
    assert.equal(res.statusCode, 403);
  });

  test("an unknown kind is rejected", async () => {
    const res = await createAlert(t, user.token, {
      kind: "PRICE_SIDEWAYS",
      chain: "BNB",
      address: "0xALPHA",
      symbol: "ALPHA",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "invalid_kind");
  });

  test("a price rule without a threshold is rejected", async () => {
    const res = await createAlert(t, user.token, {
      kind: "PRICE_ABOVE",
      chain: "BNB",
      address: "0xALPHA",
      symbol: "ALPHA",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "invalid_threshold");
  });

  test("a percent rule without a percent is rejected", async () => {
    const res = await createAlert(t, user.token, {
      kind: "PCT_MOVE_UP",
      chain: "BNB",
      address: "0xALPHA",
      symbol: "ALPHA",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "invalid_pct");
  });

  let alertId = "";

  test("a valid price alert is created and normalised", async () => {
    const res = await createAlert(t, user.token, {
      kind: "PRICE_ABOVE",
      chain: "BNB",
      address: "0xALPHA",
      symbol: "ALPHA",
      threshold: "0.000420",
    });
    assert.equal(res.statusCode, 201);
    const alert = res.json().alert;
    alertId = alert.alertId;
    assert.equal(alert.kind, "PRICE_ABOVE");
    assert.equal(alert.threshold, "0.00042");
    assert.equal(alert.isActive, true);
    assert.equal(alert.oneShot, true);
    assert.equal(alert.baselinePrice, null);
  });

  test("alerts are listed for the owner", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/alerts",
      headers: authed(user.token),
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().alerts.some((a: { alertId: string }) => a.alertId === alertId));
  });

  test("an alert can be paused and resumed", async () => {
    const pause = await t.app.inject({
      method: "PATCH",
      url: `/alerts/${alertId}`,
      headers: authed(user.token),
      payload: { isActive: false },
    });
    assert.equal(pause.statusCode, 200);
    assert.equal(pause.json().alert.isActive, false);

    const resume = await t.app.inject({
      method: "PATCH",
      url: `/alerts/${alertId}`,
      headers: authed(user.token),
      payload: { isActive: true },
    });
    assert.equal(resume.json().alert.isActive, true);
  });

  test("another user cannot see or delete the alert", async () => {
    const other = await approvedUser(t, "other-watcher@example.test");
    const list = await t.app.inject({
      method: "GET",
      url: "/alerts",
      headers: authed(other.token),
    });
    assert.equal(list.json().alerts.length, 0);

    const del = await t.app.inject({
      method: "DELETE",
      url: `/alerts/${alertId}`,
      headers: authed(other.token),
    });
    assert.equal(del.statusCode, 404);
  });

  test("the owner can delete the alert", async () => {
    const del = await t.app.inject({
      method: "DELETE",
      url: `/alerts/${alertId}`,
      headers: authed(user.token),
    });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().deleted, true);

    const again = await t.app.inject({
      method: "DELETE",
      url: `/alerts/${alertId}`,
      headers: authed(user.token),
    });
    assert.equal(again.statusCode, 404);
  });
});

describe("price alert evaluation", () => {
  let t: TestApp;
  let user: { userId: string; token: string };

  before(async () => {
    // One scripted price for the token: baseline/first read is 20.
    const provider = new MockProvider({ "0xALPHA": [20] }, () => NOW);
    t = await makeTestApp({ market: provider, now: () => NOW });
    user = await approvedUser(t, "pricer@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("a price alert fires, records an event, and disarms (one-shot)", async () => {
    const created = await createAlert(t, user.token, {
      kind: "PRICE_ABOVE",
      chain: "BNB",
      address: "0xALPHA",
      symbol: "ALPHA",
      threshold: "15",
    });
    assert.equal(created.statusCode, 201);
    const alertId = created.json().alert.alertId;

    const evalRes = await t.app.inject({
      method: "POST",
      url: "/alerts/evaluate",
      headers: authed(user.token),
    });
    assert.equal(evalRes.statusCode, 200);
    assert.equal(evalRes.json().triggered, 1);

    const events = await t.app.inject({
      method: "GET",
      url: "/alerts/events",
      headers: authed(user.token),
    });
    const list = events.json().events;
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, "PRICE_ABOVE");
    assert.equal(list[0].observedValue, "20");

    // One-shot: the alert is now disarmed, so a second evaluation fires nothing.
    const again = await t.app.inject({
      method: "POST",
      url: "/alerts/evaluate",
      headers: authed(user.token),
    });
    assert.equal(again.json().triggered, 0);

    const alerts = await t.app.inject({
      method: "GET",
      url: "/alerts",
      headers: authed(user.token),
    });
    const rule = alerts.json().alerts.find((a: { alertId: string }) => a.alertId === alertId);
    assert.equal(rule.isActive, false);
  });
});

describe("percent-move alerts", () => {
  let t: TestApp;
  let user: { userId: string; token: string };

  before(async () => {
    // Baseline read = 100 (at creation); evaluation reads 120 (+20%).
    const provider = new MockProvider({ "0xMOVE": [100, 120] }, () => NOW);
    t = await makeTestApp({ market: provider, now: () => NOW });
    user = await approvedUser(t, "mover@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("the baseline defaults to the market price at creation", async () => {
    const res = await createAlert(t, user.token, {
      kind: "PCT_MOVE_UP",
      chain: "BNB",
      address: "0xMOVE",
      symbol: "MOVE",
      pct: "5",
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().alert.baselinePrice, "100");
    assert.equal(res.json().alert.pct, "5");
  });

  test("the alert fires when the move meets the threshold", async () => {
    const evalRes = await t.app.inject({
      method: "POST",
      url: "/alerts/evaluate",
      headers: authed(user.token),
    });
    assert.equal(evalRes.json().triggered, 1);

    const events = await t.app.inject({
      method: "GET",
      url: "/alerts/events",
      headers: authed(user.token),
    });
    const list = events.json().events;
    assert.equal(list.length, 1);
    assert.equal(list[0].observedValue, "120");
    assert.match(list[0].reason, /moved \+/);
  });
});

describe("position-event alerts", () => {
  let t: TestApp;
  let user: { userId: string; token: string };
  const TOKEN = { chain: "BNB", address: "0xPEPE", symbol: "PEPE", decimals: 6 };

  before(async () => {
    t = await makeTestApp({ now: () => NOW });
    user = await approvedUser(t, "position-watcher@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("opening and closing a position fire the matching alerts", async () => {
    const opened = await createAlert(t, user.token, {
      kind: "POSITION_OPENED",
      chain: "BNB",
      address: "0xPEPE",
      symbol: "PEPE",
    });
    assert.equal(opened.statusCode, 201);
    const closed = await createAlert(t, user.token, {
      kind: "POSITION_CLOSED",
      chain: "BNB",
      address: "0xPEPE",
      symbol: "PEPE",
    });
    assert.equal(closed.statusCode, 201);

    const open = await t.app.inject({
      method: "POST",
      url: "/trading/positions",
      headers: authed(user.token),
      payload: { token: TOKEN, notionalQuote: "1000", pricePerToken: "10" },
    });
    assert.equal(open.statusCode, 201);
    const tradeId = open.json().position.tradeId as string;

    const close = await t.app.inject({
      method: "POST",
      url: `/trading/positions/${tradeId}/close`,
      headers: authed(user.token),
      payload: { price: "11" },
    });
    assert.equal(close.statusCode, 200);

    const events = await t.app.inject({
      method: "GET",
      url: "/alerts/events",
      headers: authed(user.token),
    });
    const kinds = events.json().events.map((e: { kind: string }) => e.kind).sort();
    assert.deepEqual(kinds, ["POSITION_CLOSED", "POSITION_OPENED"]);
  });

  test("an alert for a different token does not fire", async () => {
    const res = await createAlert(t, user.token, {
      kind: "POSITION_OPENED",
      chain: "BNB",
      address: "0xOTHER",
      symbol: "OTHER",
    });
    assert.equal(res.statusCode, 201);

    await t.app.inject({
      method: "POST",
      url: "/trading/positions",
      headers: authed(user.token),
      payload: { token: { chain: "BNB", address: "0xPEPE", symbol: "PEPE", decimals: 6 }, notionalQuote: "100", pricePerToken: "10" },
    });

    const events = await t.app.inject({
      method: "GET",
      url: "/alerts/events",
      headers: authed(user.token),
    });
    const others = events.json().events.filter((e: { symbol: string }) => e.symbol === "OTHER");
    assert.equal(others.length, 0);
  });
});
