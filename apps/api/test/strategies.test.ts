import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "@ghostfx/security";
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
     VALUES ($1, 'Strategist', $2, 'USER', $3::user_status, true)
     RETURNING user_id`,
    [email, hash, status],
  );
  const loginRes = await login(t.app, email, "password123");
  return { userId: res.rows[0]!.user_id, token: loginRes.json().token as string };
}

function listStrategies(t: TestApp, token: string) {
  return t.app.inject({ method: "GET", url: "/strategies", headers: authed(token) });
}

function createVersion(
  t: TestApp,
  token: string,
  config: Record<string, unknown>,
  note?: string,
) {
  return t.app.inject({
    method: "POST",
    url: "/strategies/versions",
    headers: authed(token),
    payload: { config, ...(note ? { note } : {}) },
  });
}

const CHANGED = {
  takeProfitArmPct: 0.1,
  trailingPercent: 0.02,
  trailingConfirmations: 2,
  stopLossPct: null,
};

describe("strategy version management", () => {
  let t: TestApp;
  let user: { userId: string; token: string };
  let v1 = "";
  let v2 = "";

  before(async () => {
    t = await makeTestApp({ now: () => NOW });
    user = await approvedUser(t, "strategist@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("listing strategies requires authentication", async () => {
    const res = await t.app.inject({ method: "GET", url: "/strategies" });
    assert.equal(res.statusCode, 401);
  });

  test("a PENDING user cannot read strategies", async () => {
    const pending = await approvedUser(t, "pending-strategist@example.test", "PENDING");
    const res = await listStrategies(t, pending.token);
    assert.equal(res.statusCode, 403);
  });

  test("the FLEXI strategy is seeded at version 1 with explicit precedence", async () => {
    const res = await listStrategies(t, user.token);
    assert.equal(res.statusCode, 200);
    const strategies = res.json().strategies;
    assert.equal(strategies.length, 1);
    assert.equal(strategies[0].name, "FLEXI");
    assert.equal(strategies[0].versions.length, 1);

    const version = strategies[0].versions[0];
    v1 = version.strategyVersionId;
    assert.equal(version.version, 1);
    assert.equal(version.isActive, true);
    assert.equal(strategies[0].activeVersionId, v1);
    assert.equal(version.note, null);
    assert.ok(version.activatedAt);

    assert.deepEqual(
      strategies[0].rules.map((r: { id: string }) => r.id),
      ["stop_loss", "take_profit_arm", "trailing_exit"],
    );
  });

  test("a changed config creates an inactive draft with a comparison", async () => {
    const res = await createVersion(t, user.token, CHANGED, "arm later");
    assert.equal(res.statusCode, 201);
    const body = res.json();
    v2 = body.version.strategyVersionId;
    assert.equal(body.version.version, 2);
    assert.equal(body.version.isActive, false);
    assert.equal(body.version.note, "arm later");
    assert.equal(body.version.tradeCount, 0);
    assert.equal(body.comparison.hasChanges, true);
  });

  test("a config identical to an existing version is rejected", async () => {
    const res = await createVersion(t, user.token, {
      takeProfitArmPct: 0.07,
      trailingPercent: 0.02,
      trailingConfirmations: 2,
      stopLossPct: null,
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, "duplicate_version");
  });

  test("an invalid config is rejected", async () => {
    const res = await createVersion(t, user.token, { takeProfitArmPct: 2 });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "invalid_config");
  });

  test("compare reports the change against the active version", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: `/strategies/versions/${v2}/compare`,
      headers: authed(user.token),
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.from.version, 1);
    assert.equal(body.to.version, 2);
    assert.equal(body.comparison.hasChanges, true);
    const armed = body.comparison.changes.find(
      (c: { key: string }) => c.key === "takeProfitArmPct",
    );
    assert.equal(armed.changed, true);
  });

  test("activating a version switches the active one", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: `/strategies/versions/${v2}/activate`,
      headers: authed(user.token),
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.version.isActive, true);
    assert.equal(body.previousVersionId, v1);
    assert.equal(body.comparison.hasChanges, true);

    const listed = await listStrategies(t, user.token);
    const strategy = listed.json().strategies[0];
    assert.equal(strategy.activeVersionId, v2);
    const byId: Record<string, { isActive: boolean }> = {};
    for (const v of strategy.versions) byId[v.strategyVersionId] = v;
    assert.equal(byId[v1]!.isActive, false);
    assert.equal(byId[v2]!.isActive, true);
  });

  test("the seed and active versions cannot be deleted", async () => {
    const seed = await t.app.inject({
      method: "DELETE",
      url: `/strategies/versions/${v1}`,
      headers: authed(user.token),
    });
    assert.equal(seed.statusCode, 409);
    assert.equal(seed.json().error, "cannot_delete_seed");

    const active = await t.app.inject({
      method: "DELETE",
      url: `/strategies/versions/${v2}`,
      headers: authed(user.token),
    });
    assert.equal(active.statusCode, 409);
    assert.equal(active.json().error, "cannot_delete_active");
  });

  test("an unused draft can be deleted", async () => {
    const created = await createVersion(
      t,
      user.token,
      { takeProfitArmPct: 0.15, trailingPercent: 0.02, trailingConfirmations: 2, stopLossPct: 0.2 },
    );
    assert.equal(created.statusCode, 201);
    const v3 = created.json().version.strategyVersionId;

    const del = await t.app.inject({
      method: "DELETE",
      url: `/strategies/versions/${v3}`,
      headers: authed(user.token),
    });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().deleted, true);
  });

  test("an unknown version is a 404", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/strategies/versions/00000000-0000-0000-0000-000000000000",
      headers: authed(user.token),
    });
    assert.equal(res.statusCode, 404);
  });
});

describe("active version drives new trades", () => {
  let t: TestApp;
  let user: { userId: string; token: string };

  before(async () => {
    t = await makeTestApp({ now: () => NOW });
    user = await approvedUser(t, "pinner@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("a new position pins the active version, not the seed", async () => {
    const seeded = await listStrategies(t, user.token);
    const v1 = seeded.json().strategies[0].versions[0].strategyVersionId;

    const created = await createVersion(t, user.token, CHANGED);
    const v2 = created.json().version.strategyVersionId;
    await t.app.inject({
      method: "POST",
      url: `/strategies/versions/${v2}/activate`,
      headers: authed(user.token),
    });

    const opened = await t.app.inject({
      method: "POST",
      url: "/trading/positions",
      headers: authed(user.token),
      payload: {
        token: { chain: "BNB", address: "0xPIN", symbol: "PIN", decimals: 6 },
        notionalQuote: "1000",
        pricePerToken: "10",
      },
    });
    assert.equal(opened.statusCode, 201);

    const listed = await listStrategies(t, user.token);
    const versions = listed.json().strategies[0].versions as {
      strategyVersionId: string;
      tradeCount: number;
    }[];
    const byId: Record<string, number> = {};
    for (const v of versions) byId[v.strategyVersionId] = v.tradeCount;
    assert.equal(byId[v2], 1);
    assert.equal(byId[v1], 0);
  });
});

describe("strategy ownership", () => {
  let t: TestApp;

  before(async () => {
    t = await makeTestApp({ now: () => NOW });
  });
  after(async () => {
    await t.close();
  });

  test("another user cannot see, activate, or delete a version", async () => {
    const a = await approvedUser(t, "owner-a@example.test");
    const b = await approvedUser(t, "owner-b@example.test");

    const aList = await listStrategies(t, a.token);
    const aStrategy = aList.json().strategies[0];
    const aVersion = aStrategy.versions[0].strategyVersionId;

    const bList = await listStrategies(t, b.token);
    const bStrategy = bList.json().strategies[0];
    assert.notEqual(bStrategy.strategyId, aStrategy.strategyId);

    const seen = await t.app.inject({
      method: "GET",
      url: `/strategies/versions/${aVersion}`,
      headers: authed(b.token),
    });
    assert.equal(seen.statusCode, 404);

    const activate = await t.app.inject({
      method: "POST",
      url: `/strategies/versions/${aVersion}/activate`,
      headers: authed(b.token),
    });
    assert.equal(activate.statusCode, 404);

    const del = await t.app.inject({
      method: "DELETE",
      url: `/strategies/versions/${aVersion}`,
      headers: authed(b.token),
    });
    assert.equal(del.statusCode, 404);
  });
});
