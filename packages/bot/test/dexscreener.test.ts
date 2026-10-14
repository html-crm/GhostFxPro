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
        {
          chainId: "bsc",
          priceUsd: "1.00",
          baseToken: { address: "0xabc" },
          liquidity: { usd: 1000 },
        },
        {
          chainId: "bsc",
          priceUsd: "2.50",
          baseToken: { address: "0xabc" },
          liquidity: { usd: 9000 },
        },
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
        {
          chainId: "ethereum",
          priceUsd: "9.99",
          baseToken: { address: "0xabc" },
          liquidity: { usd: 99999 },
        },
        {
          chainId: "bsc",
          priceUsd: "3.33",
          baseToken: { address: "0xabc" },
          liquidity: { usd: 100 },
        },
      ],
    }),
    now: () => NOW,
  });
  const q = await provider.getQuote({ chain: "BNB", address: "0xabc" });
  assert.equal(q?.price, 3.33);
});

test("ignores pairs where the token is only the quote (never returns the base asset's price)", async () => {
  // Real DEX Screener shape: the deepest pair for USDC is PUMP/USDC (USDC as
  // quote). Using its priceUsd would report PUMP's price for USDC.
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const provider = new DexScreenerProvider({
    fetchImpl: fetchReturning({
      pairs: [
        {
          chainId: "solana",
          priceUsd: "0.004981",
          priceNative: "0.004983",
          baseToken: { address: "PUMPxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          quoteToken: { address: USDC },
          liquidity: { usd: 24_779_997 },
        },
        {
          chainId: "solana",
          priceUsd: "1.00088",
          priceNative: "1.0008825",
          baseToken: { address: USDC },
          quoteToken: { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
          liquidity: { usd: 1_722_048 },
        },
      ],
    }),
    now: () => NOW,
  });
  const q = await provider.getQuote({ chain: "SOLANA", address: USDC });
  assert.equal(q?.price, 1.00088);
});

test("returns null when the token only ever appears as the quote token", async () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const provider = new DexScreenerProvider({
    fetchImpl: fetchReturning({
      pairs: [
        {
          chainId: "solana",
          priceUsd: "0.004981",
          baseToken: { address: "PUMP" },
          quoteToken: { address: USDC },
          liquidity: { usd: 24_779_997 },
        },
      ],
    }),
  });
  assert.equal(await provider.getQuote({ chain: "SOLANA", address: USDC }), null);
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
      pairs: [
        {
          chainId: "bsc",
          priceUsd: "not-a-number",
          baseToken: { address: "0xabc" },
          liquidity: { usd: 5 },
        },
      ],
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

test("selectPair matches the base token case-insensitively", () => {
  const pair = selectPair(
    [
      {
        chainId: "bsc",
        priceUsd: "5",
        baseToken: { address: "0xDEAD" },
        liquidity: { usd: 1 },
      },
    ],
    "bsc",
    "0xdead",
  );
  assert.equal(pair?.priceUsd, "5");
});

test("selectPair returns null when the base token never matches", () => {
  const pair = selectPair(
    [
      {
        chainId: "bsc",
        priceUsd: "5",
        baseToken: { address: "0xother" },
        quoteToken: { address: "0xwanted" },
        liquidity: { usd: 9999 },
      },
    ],
    "bsc",
    "0xwanted",
  );
  assert.equal(pair, null);
});
