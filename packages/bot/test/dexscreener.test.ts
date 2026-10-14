import { test } from "node:test";
import assert from "node:assert/strict";
import { DexScreenerProvider, selectPair } from "../src/market/dexscreener.ts";
import type { FetchLike } from "../src/market/types.ts";

const NOW = 1_700_000_000_000;

function fetchReturning(body: unknown, ok = true, status = 200): FetchLike {
  return async () => ({ ok, status, json: async () => body });
}

test("selects the deepest-liquidity pair", async () => {
  const provider = new DexScreenerProvider({
    fetchImpl: fetchReturning({
      pairs: [
        { chainId: "bsc", priceUsd: "1.00", liquidity: { usd: 1000 } },
        { chainId: "bsc", priceUsd: "2.50", liquidity: { usd: 9000 } },
      ],
    }),
    now: () => NOW,
  });
  const q = await provider.getQuote({ chain: "BNB", address: "0xabc" });
  assert.deepEqual(q, { price: 2.5, ts: NOW, source: "dexscreener" });
});

test("prefers the expected chain when filtering", async () => {
  const provider = new DexScreenerProvider({
    fetchImpl: fetchReturning({
      pairs: [
        { chainId: "ethereum", priceUsd: "9.99", liquidity: { usd: 99999 } },
        { chainId: "bsc", priceUsd: "3.33", liquidity: { usd: 100 } },
      ],
    }),
    now: () => NOW,
  });
  const q = await provider.getQuote({ chain: "BNB", address: "0xabc" });
  assert.equal(q?.price, 3.33);
});

test("returns null for a token with no pairs", async () => {
  const provider = new DexScreenerProvider({
    fetchImpl: fetchReturning({ pairs: [] }),
  });
  assert.equal(await provider.getQuote({ chain: "BNB", address: "0xnone" }), null);
});

test("returns null on a non-ok response", async () => {
  const provider = new DexScreenerProvider({
    fetchImpl: fetchReturning({}, false, 429),
  });
  assert.equal(await provider.getQuote({ chain: "BNB", address: "0xabc" }), null);
});

test("returns null for an unparseable price", async () => {
  const provider = new DexScreenerProvider({
    fetchImpl: fetchReturning({
      pairs: [{ chainId: "bsc", priceUsd: "not-a-number", liquidity: { usd: 5 } }],
    }),
  });
  assert.equal(await provider.getQuote({ chain: "BNB", address: "0xabc" }), null);
});

test("returns null when the fetch throws (never invents a price)", async () => {
  const provider = new DexScreenerProvider({
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(await provider.getQuote({ chain: "BNB", address: "0xabc" }), null);
});

test("empty address short-circuits without a request", async () => {
  let called = false;
  const provider = new DexScreenerProvider({
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.equal(await provider.getQuote({ chain: "BNB", address: "" }), null);
  assert.equal(called, false);
});

test("selectPair falls back to all pairs when the chain is absent", () => {
  const pair = selectPair(
    [{ chainId: "solana", priceUsd: "1", liquidity: { usd: 10 } }],
    "bsc",
  );
  assert.equal(pair?.priceUsd, "1");
});
