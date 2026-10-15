import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "@ghostfx/security";
import type { TokenProfile } from "@ghostfx/bot";
import { makeTestApp, login, authed, type TestApp } from "./helpers.ts";

const NOW = 1_700_000_000_000;
const SOL = "So11111111111111111111111111111111111111112";
const EVM = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";

async function approvedUser(t: TestApp, email: string, status = "APPROVED") {
  const hash = hashPassword("password123");
  await t.db.query(
    `INSERT INTO users (email, display_name, password_hash, role, status, email_verified)
     VALUES ($1, 'Trader', $2, 'USER', $3::user_status, true)`,
    [email, hash, status],
  );
  const res = await login(t.app, email, "password123");
  return res.json().token as string;
}

const PROFILE: TokenProfile = {
  chain: "BNB",
  address: EVM,
  symbol: "CAKE",
  name: "PancakeSwap",
  decimals: 18,
  priceUsd: 2.5,
  liquidityUsd: 100,
  pairCount: 1,
  dexId: "pancakeswap",
  pairAddress: "0xPAIR",
  fetchedAt: NOW,
};

function lookup(t: TestApp, token: string, address: string) {
  return t.app.inject({
    method: "GET",
    url: `/market/token/${address}`,
    headers: authed(token),
  });
}

describe("token lookup by contract", () => {
  let t: TestApp;
  let token = "";
  const seen: string[] = [];

  before(async () => {
    t = await makeTestApp({
      marketTokenProfile: async (address) => {
        seen.push(address);
        return address === EVM ? PROFILE : null;
      },
      now: () => NOW,
    });
    token = await approvedUser(t, "lookup@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("requires authentication", async () => {
    const res = await t.app.inject({ method: "GET", url: `/market/token/${EVM}` });
    assert.equal(res.statusCode, 401);
  });

  test("a PENDING user is rejected", async () => {
    const pending = await approvedUser(t, "pending-lookup@example.test", "PENDING");
    const res = await lookup(t, pending, EVM);
    assert.equal(res.statusCode, 403);
  });

  test("an unknown address shape is a 400", async () => {
    const res = await lookup(t, token, "0xnope");
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "invalid_address");
  });

  test("a token with no observable market is a 404", async () => {
    const res = await lookup(t, token, SOL);
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "token_not_found");
  });

  test("a known token returns its identity, decimals, and market", async () => {
    seen.length = 0;
    const res = await lookup(t, token, EVM);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.source, "dexscreener");
    assert.equal(body.fetchedAt, NOW);
    assert.equal(body.profile.symbol, "CAKE");
    assert.equal(body.profile.decimals, 18);
    assert.equal(body.profile.priceUsd, 2.5);
    assert.deepEqual(seen, [EVM]);
  });
});
