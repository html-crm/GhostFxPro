import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "@ghostfx/security";
import type {
  WalletBalanceProvider,
  WalletBalances,
  WalletChain,
} from "@ghostfx/bot";
import { makeTestApp, login, authed, type TestApp } from "./helpers.ts";

const NOW = 1_700_000_000_000;
const SOL = "So11111111111111111111111111111111111111112";
const BNB = "0x0000000000000000000000000000000000000001";

class FakeWalletProvider implements WalletBalanceProvider {
  readonly name = "fake";
  async getBalances(
    chain: WalletChain,
    address: string,
  ): Promise<WalletBalances> {
    return {
      chain,
      address,
      native: {
        symbol: chain === "SOLANA" ? "SOL" : "BNB",
        decimals: chain === "SOLANA" ? 9 : 18,
        amount: "1.5",
        raw: "1500000000",
      },
      tokens: [],
      truncated: false,
      fetchedAt: NOW,
      source: "fake",
    };
  }
}

async function approvedUser(
  t: TestApp,
  email: string,
  status = "APPROVED",
): Promise<{ userId: string; token: string }> {
  const hash = hashPassword("password123");
  const res = await t.db.query<{ user_id: string }>(
    `INSERT INTO users (email, display_name, password_hash, role, status, email_verified)
     VALUES ($1, 'Holder', $2, 'USER', $3::user_status, true)
     RETURNING user_id`,
    [email, hash, status],
  );
  const loginRes = await login(t.app, email, "password123");
  return { userId: res.rows[0]!.user_id, token: loginRes.json().token as string };
}

function addWallet(t: TestApp, token: string, payload: Record<string, unknown>) {
  return t.app.inject({
    method: "POST",
    url: "/wallets",
    headers: authed(token),
    payload,
  });
}

describe("wallet connections", () => {
  let t: TestApp;
  let user: { userId: string; token: string };

  before(async () => {
    t = await makeTestApp({ walletBalances: new FakeWalletProvider(), now: () => NOW });
    user = await approvedUser(t, "holder@example.test");
  });
  after(async () => {
    await t.close();
  });

  test("listing wallets requires authentication", async () => {
    const res = await t.app.inject({ method: "GET", url: "/wallets" });
    assert.equal(res.statusCode, 401);
  });

  test("a PENDING user cannot connect a wallet", async () => {
    const pending = await approvedUser(t, "pending-holder@example.test", "PENDING");
    const res = await addWallet(t, pending.token, { chain: "SOLANA", address: SOL });
    assert.equal(res.statusCode, 403);
  });

  test("an unsupported chain is rejected", async () => {
    const res = await addWallet(t, user.token, { chain: "ROBINHOOD", address: BNB });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "unsupported_chain");
  });

  test("a malformed address is rejected", async () => {
    const bad = await addWallet(t, user.token, {
      chain: "BNB",
      address: "0x123",
    });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().error, "invalid_address");

    const wrongChain = await addWallet(t, user.token, {
      chain: "SOLANA",
      address: BNB,
    });
    assert.equal(wrongChain.statusCode, 400);
    assert.equal(wrongChain.json().error, "invalid_address");
  });

  let walletId = "";

  test("a valid wallet is connected and stores no key material", async () => {
    const res = await addWallet(t, user.token, {
      chain: "SOLANA",
      address: SOL,
      label: "  Main  ",
    });
    assert.equal(res.statusCode, 201);
    const w = res.json().wallet;
    walletId = w.walletId;
    assert.equal(w.chain, "SOLANA");
    assert.equal(w.address, SOL);
    assert.equal(w.label, "Main");
    assert.equal(w.custody, "NON_CUSTODIAL");
    // No key material is ever echoed by the API.
    assert.equal("privateKey" in w, false);
    assert.equal("seedPhrase" in w, false);
    assert.equal("mnemonic" in w, false);
  });

  test("connecting the same address twice is a conflict", async () => {
    const res = await addWallet(t, user.token, { chain: "SOLANA", address: SOL });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, "wallet_exists");
  });

  test("the wallet appears in the owner's list", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/wallets",
      headers: authed(user.token),
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().wallets.some((w: { walletId: string }) => w.walletId === walletId));
  });

  test("synthetic paper wallets are hidden from the list", async () => {
    await t.db.query(
      `INSERT INTO wallets (user_id, chain, address, label, custody)
       VALUES ($1, 'SOLANA', $2, 'PAPER', 'NON_CUSTODIAL')`,
      [user.userId, `paper:SOLANA:${user.userId}`],
    );
    const res = await t.app.inject({
      method: "GET",
      url: "/wallets",
      headers: authed(user.token),
    });
    const addresses = res.json().wallets.map((w: { address: string }) => w.address);
    assert.equal(addresses.some((a: string) => a.startsWith("paper:")), false);
  });

  test("another user cannot see or delete the wallet", async () => {
    const other = await approvedUser(t, "other-holder@example.test");
    const list = await t.app.inject({
      method: "GET",
      url: "/wallets",
      headers: authed(other.token),
    });
    assert.equal(list.json().wallets.length, 0);

    const del = await t.app.inject({
      method: "DELETE",
      url: `/wallets/${walletId}`,
      headers: authed(other.token),
    });
    assert.equal(del.statusCode, 404);

    const balances = await t.app.inject({
      method: "GET",
      url: `/wallets/${walletId}/balances`,
      headers: authed(other.token),
    });
    assert.equal(balances.statusCode, 404);
  });

  test("the label can be renamed and cleared", async () => {
    const renamed = await t.app.inject({
      method: "PATCH",
      url: `/wallets/${walletId}`,
      headers: authed(user.token),
      payload: { label: "Trading" },
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().wallet.label, "Trading");

    const cleared = await t.app.inject({
      method: "PATCH",
      url: `/wallets/${walletId}`,
      headers: authed(user.token),
      payload: { label: "" },
    });
    assert.equal(cleared.json().wallet.label, null);
  });

  test("balances are returned for the wallet", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: `/wallets/${walletId}/balances`,
      headers: authed(user.token),
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.wallet.walletId, walletId);
    assert.equal(body.balances.native.symbol, "SOL");
    assert.equal(body.balances.native.amount, "1.5");
    assert.equal(body.balances.source, "fake");

    const all = await t.app.inject({
      method: "GET",
      url: "/wallets/balances",
      headers: authed(user.token),
    });
    assert.equal(all.statusCode, 200);
    assert.equal(all.json().wallets.length, 1);
    assert.equal(all.json().wallets[0].balances.native.symbol, "SOL");
  });

  test("the owner can delete the wallet", async () => {
    const del = await t.app.inject({
      method: "DELETE",
      url: `/wallets/${walletId}`,
      headers: authed(user.token),
    });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().deleted, true);

    const again = await t.app.inject({
      method: "DELETE",
      url: `/wallets/${walletId}`,
      headers: authed(user.token),
    });
    assert.equal(again.statusCode, 404);
  });
});
