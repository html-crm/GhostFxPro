import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTokenChain, getTokenProfile } from "../src/market/token-profile.ts";
import type { FetchLike } from "../src/market/types.ts";
import type { RpcFetchLike } from "../src/wallet/balances.ts";

const NOW = 1_700_000_000_000;
const SOL = "So11111111111111111111111111111111111111112";
const EVM = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82"; // CAKE

function dexFetch(pairs: unknown[]): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ pairs }),
  });
}

function rpcFetch(handlers: Record<string, (params: unknown[]) => unknown>): RpcFetchLike {
  return async (_url, init) => {
    const req = JSON.parse(init?.body ?? "{}") as { method: string; params: unknown[] };
    const handler = handlers[req.method];
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: handler ? handler(req.params) : null }),
    };
  };
}

test("detectTokenChain classifies by address shape", () => {
  assert.equal(detectTokenChain(EVM), "BNB");
  assert.equal(detectTokenChain(SOL), "SOLANA");
  assert.equal(detectTokenChain("0x123"), null);
  assert.equal(detectTokenChain("not an address"), null);
  assert.equal(detectTokenChain(""), null);
});

test("getTokenProfile resolves identity and market from the base-token pair", async () => {
  const pairs = [
    {
      chainId: "bsc",
      dexId: "pancakeswap",
      pairAddress: "0xPAIRQUOTE",
      priceUsd: "999",
      baseToken: { address: "0xdeadbeef00000000000000000000000000000000", symbol: "OTHER" },
      quoteToken: { address: EVM },
      liquidity: { usd: 5000000 },
    },
    {
      chainId: "bsc",
      dexId: "pancakeswap",
      pairAddress: "0xPAIRBASE",
      priceUsd: "2.5",
      baseToken: { address: EVM, symbol: "CAKE", name: "PancakeSwap" },
      quoteToken: { address: "0xWBNB" },
      liquidity: { usd: 100 },
    },
  ];
  const profile = await getTokenProfile(EVM, {
    fetchImpl: dexFetch(pairs),
    rpcFetchImpl: rpcFetch({ eth_call: () => "0x12" }),
    now: () => NOW,
  });
  assert.ok(profile);
  assert.equal(profile.chain, "BNB");
  assert.equal(profile.address, EVM);
  assert.equal(profile.symbol, "CAKE");
  assert.equal(profile.name, "PancakeSwap");
  assert.equal(profile.decimals, 18);
  assert.equal(profile.priceUsd, 2.5);
  assert.equal(profile.liquidityUsd, 100);
  assert.equal(profile.pairCount, 1);
  assert.equal(profile.dexId, "pancakeswap");
  assert.equal(profile.pairAddress, "0xPAIRBASE");
  assert.equal(profile.fetchedAt, NOW);
});

test("getTokenProfile reads decimals from Solana getTokenSupply", async () => {
  const pairs = [
    {
      chainId: "solana",
      dexId: "raydium",
      pairAddress: "PAIR",
      priceUsd: "1.0",
      baseToken: { address: SOL, symbol: "SOLX", name: "Solana X" },
      quoteToken: { address: "USDC" },
      liquidity: { usd: 42 },
    },
  ];
  const profile = await getTokenProfile(SOL, {
    fetchImpl: dexFetch(pairs),
    rpcFetchImpl: rpcFetch({ getTokenSupply: () => ({ value: { decimals: 9 } }) }),
  });
  assert.ok(profile);
  assert.equal(profile.chain, "SOLANA");
  assert.equal(profile.decimals, 9);
  assert.equal(profile.symbol, "SOLX");
});

test("getTokenProfile returns null when no pair matches the address", async () => {
  const pairs = [
    {
      chainId: "bsc",
      dexId: "x",
      priceUsd: "1",
      baseToken: { address: "0xOTHER", symbol: "X" },
      liquidity: { usd: 10 },
    },
  ];
  const profile = await getTokenProfile(EVM, { fetchImpl: dexFetch(pairs) });
  assert.equal(profile, null);
});

test("getTokenProfile never invents a missing price or decimals", async () => {
  const pairs = [
    {
      chainId: "bsc",
      dexId: "x",
      baseToken: { address: EVM, symbol: "CAKE", name: "PancakeSwap" },
      liquidity: { usd: 0 },
    },
  ];
  const profile = await getTokenProfile(EVM, {
    fetchImpl: dexFetch(pairs),
    rpcFetchImpl: rpcFetch({ eth_call: () => "0x" }),
  });
  assert.ok(profile);
  assert.equal(profile.priceUsd, null);
  assert.equal(profile.decimals, null);
  assert.equal(profile.symbol, "CAKE");
});

test("getTokenProfile returns null for an unknown address shape", async () => {
  const profile = await getTokenProfile("0xnope", { fetchImpl: dexFetch([]) });
  assert.equal(profile, null);
});

test("getTokenProfile returns null when the source errors", async () => {
  const failing: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const profile = await getTokenProfile(EVM, { fetchImpl: failing });
  assert.equal(profile, null);
});
