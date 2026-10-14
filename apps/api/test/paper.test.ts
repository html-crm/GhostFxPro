import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "@ghostfx/security";
import { MockProvider } from "@ghostfx/bot";
import { makeTestApp, login, authed, type TestApp } from "./helpers.ts";

const NOW = 1_700_000_000_000;
const TOKEN = { chain: "BNB", address: "0xPEPE", symbol: "PEPE", decimals: 6 };

async function approvedUser(
  t: TestApp,
  email: string,
  status = "APPROVED",
): Promise<{ userId: string; token: string }> {
  const hash = hashPassword("password123");
  const res = await t.db.query<{ user_id: string }>(
    `INSERT INTO users (email, display_name, password_hash, role, status, email_verified)
     VALUES ($1, 'Trader', $2, 'USER', $3::user_status, true)
     RETURNING user_id`,
    [email, hash, status],
  );
  const loginRes = await login(t.app, email, "password123");
  return { userId: res.rows[0]!.user_id, token: loginRes.json().token as string };
}

function lastPositions(res: {
  json(): { positions: Array<Record<string, unknown>> };
}): Array<Record<string, unknown>> {
  return res.json().positions;
}

describe("paper trading engine", () => {
  let t: TestApp;
  let user: { userId: string; token: string };

  before(async () => {
    t = await makeTestApp({ now: () => NOW });
    user = await approvedUser(t, "trader@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("a new account starts with the default simulated balance", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/trading/account",
      headers: authed(user.token),
    });
    assert.equal(res.statusCode, 200);
    const acct = res.json().account;
    assert.equal(acct.initialBalance, "100000");
    assert.equal(acct.cashBalance, "100000");
    assert.equal(acct.openCount, 0);
  });

  test("a PENDING user cannot trade", async () => {
    const pending = await approvedUser(t, "pending@example.test", "PENDING");
    const res = await t.app.inject({
      method: "GET",
      url: "/trading/account",
      headers: authed(pending.token),
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error, "account_not_approved");
  });

  let tradeId = "";

  test("opening a position creates a trade, fill, and debits cash", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/trading/positions",
      headers: authed(user.token),
      payload: { token: TOKEN, notionalQuote: "1000", pricePerToken: "10" },
    });
    assert.equal(res.statusCode, 201);
    tradeId = res.json().position.tradeId as string;

    const fills = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fills WHERE trade_id = $1`,
      [tradeId],
    );
    assert.equal(fills.rows[0]!.n, "1");

    const ledger = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ledger_entries WHERE trade_id = $1`,
      [tradeId],
    );
    assert.equal(ledger.rows[0]!.n, "2", "double-entry: cash + position");

    const acct = await t.app.inject({
      method: "GET",
      url: "/trading/account",
      headers: authed(user.token),
    });
    assert.equal(acct.json().account.cashBalance, "99000");
    assert.equal(acct.json().account.openCount, 1);
  });

  test("the open position reports entry, mark, and zero unrealized P&L", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/trading/positions",
      headers: authed(user.token),
    });
    const pos = lastPositions(res).find((p) => p.tradeId === tradeId)!;
    assert.equal(pos.symbol, "PEPE");
    assert.equal(pos.lastPrice, "10");
    assert.equal(pos.marketValue, "1000");
    assert.equal(pos.unrealizedPnl, "0");
    assert.equal(pos.tpArmed, false);
  });

  async function evaluate(price: string) {
    return t.app.inject({
      method: "POST",
      url: `/trading/positions/${tradeId}/evaluate`,
      headers: authed(user.token),
      payload: { price },
    });
  }

  test("evaluation at +7% arms trailing without selling", async () => {
    const res = await evaluate("10.7");
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().evaluation.action, "HOLD");
    assert.equal(res.json().evaluation.triggeringRule, "take_profit_arm");
    assert.equal(res.json().closed, false);
  });

  test("a 2% pullback needs two confirmations before exiting", async () => {
    // Peak to 18 (well above the arm threshold).
    const up = await evaluate("18");
    assert.equal(up.json().evaluation.action, "HOLD");

    const first = await evaluate("17.5");
    assert.equal(first.json().evaluation.action, "WAIT_OBSERVE");
    assert.equal(first.json().evaluation.confirmationCount, 1);

    const second = await evaluate("17.5");
    assert.equal(second.json().evaluation.action, "SELL");
    assert.equal(second.json().evaluation.triggeringRule, "trailing_exit");
    assert.equal(second.json().closed, true);
  });

  test("closing credits proceeds and realises P&L", async () => {
    const acct = await t.app.inject({
      method: "GET",
      url: "/trading/account",
      headers: authed(user.token),
    });
    const a = acct.json().account;
    assert.equal(a.cashBalance, "100750", "99000 + 1750 proceeds");
    assert.equal(a.realizedPnl, "750");
    assert.equal(a.openCount, 0);
    assert.equal(a.closedCount, 1);
  });

  test("every decision and exit evaluation is persisted", async () => {
    const decisions = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM decisions WHERE trade_id = $1`,
      [tradeId],
    );
    const exits = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM exit_evaluations WHERE trade_id = $1`,
      [tradeId],
    );
    // open(BUY) + 4 evaluations (10.7, 18, 17.5, 17.5)
    assert.equal(decisions.rows[0]!.n, "5");
    assert.equal(exits.rows[0]!.n, "4");
  });

  test("a fully closed position cannot be evaluated again", async () => {
    const res = await evaluate("20");
    assert.equal(res.statusCode, 409, "closed trade is not open for evaluation");
  });
});

describe("paper position isolation and access control", () => {
  let t: TestApp;
  let alice: { userId: string; token: string };
  let bob: { userId: string; token: string };

  before(async () => {
    t = await makeTestApp({ now: () => NOW });
    alice = await approvedUser(t, "alice@example.test");
    bob = await approvedUser(t, "bob@example.test");
  });
  after(async () => {
    await t.close();
  });

  async function open(token: string, notional: string): Promise<string> {
    const res = await t.app.inject({
      method: "POST",
      url: "/trading/positions",
      headers: authed(token),
      payload: { token: TOKEN, notionalQuote: notional, pricePerToken: "10" },
    });
    assert.equal(res.statusCode, 201);
    return res.json().position.tradeId as string;
  }

  test("two trades in the same token never share state", async () => {
    const a = await open(alice.token, "1000");
    const b = await open(alice.token, "500");

    // Arm only trade A.
    await t.app.inject({
      method: "POST",
      url: `/trading/positions/${a}/evaluate`,
      headers: authed(alice.token),
      payload: { price: "12" },
    });

    const res = await t.app.inject({
      method: "GET",
      url: "/trading/positions",
      headers: authed(alice.token),
    });
    const posA = lastPositions(res).find((p) => p.tradeId === a)!;
    const posB = lastPositions(res).find((p) => p.tradeId === b)!;
    assert.equal(posA.tpArmed, true);
    assert.equal(posB.tpArmed, false, "trade B must be untouched by trade A");
  });

  test("a user cannot evaluate another user's position", async () => {
    const a = await open(alice.token, "100");
    const res = await t.app.inject({
      method: "POST",
      url: `/trading/positions/${a}/evaluate`,
      headers: authed(bob.token),
      payload: { price: "12" },
    });
    assert.equal(res.statusCode, 404);
  });

  test("a user cannot close another user's position", async () => {
    const a = await open(alice.token, "100");
    const res = await t.app.inject({
      method: "POST",
      url: `/trading/positions/${a}/close`,
      headers: authed(bob.token),
      payload: { price: "12" },
    });
    assert.equal(res.statusCode, 404);
  });

  test("manual close is explicit and realises an exit", async () => {
    const a = await open(alice.token, "1000");
    const res = await t.app.inject({
      method: "POST",
      url: `/trading/positions/${a}/close`,
      headers: authed(alice.token),
      payload: { price: "11" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().closed, true);
  });

  test("insufficient funds are rejected", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/trading/positions",
      headers: authed(bob.token),
      payload: { token: TOKEN, notionalQuote: "999999999", pricePerToken: "10" },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "insufficient_funds");
  });
});

describe("paper bot loop (tick)", () => {
  let t: TestApp;
  let user: { userId: string; token: string };

  before(async () => {
    // A scripted price path drives the bot without any manual prices.
    const provider = new MockProvider(
      { "0xPEPE": [10, 12, 18, 17.5, 17.5] },
      () => NOW,
    );
    t = await makeTestApp({ market: provider, now: () => NOW });
    user = await approvedUser(t, "bot@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("tick opens, evaluates, and closes using the market provider", async () => {
    const open = await t.app.inject({
      method: "POST",
      url: "/trading/positions",
      headers: authed(user.token),
      payload: { token: TOKEN, notionalQuote: "1000", pricePerToken: "10" },
    });
    assert.equal(open.statusCode, 201);

    // Each tick consumes the next scripted price: 10, 12, 18, 17.5, 17.5.
    let closed = false;
    for (let i = 0; i < 5; i++) {
      const tick = await t.app.inject({
        method: "POST",
        url: "/trading/tick",
        headers: authed(user.token),
      });
      assert.equal(tick.statusCode, 200);
      if (tick.json().tick.closed > 0) closed = true;
    }
    assert.equal(closed, true, "the bot should have exited on the trailing pullback");

    const acct = await t.app.inject({
      method: "GET",
      url: "/trading/account",
      headers: authed(user.token),
    });
    assert.equal(acct.json().account.openCount, 0);
    assert.equal(acct.json().account.realizedPnl, "750");
  });
});
