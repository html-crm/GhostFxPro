import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PublicRpcWalletProvider,
  formatUnits,
  hexToBigInt,
  isEvmAddress,
  isSolanaAddress,
  isSupportedWalletChain,
  validateWalletAddress,
  type RpcFetchLike,
} from "../src/wallet/balances.ts";

const NOW = 1_700_000_000_000;
const SOL = "So11111111111111111111111111111111111111112";
const EVM = "0x0000000000000000000000000000000000000001";

function rpcFetch(
  handlers: Record<string, (params: unknown[]) => unknown>,
): RpcFetchLike {
  return async (_url, init) => {
    const req = JSON.parse(init?.body ?? "{}") as {
      method: string;
      params: unknown[];
    };
    const handler = handlers[req.method];
    if (!handler) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32601 } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: handler(req.params) }),
    };
  };
}

// --- pure helpers -----------------------------------------------------------

test("formatUnits preserves small and large values exactly", () => {
  assert.equal(formatUnits(1_500_000_000n, 9), "1.5");
  assert.equal(formatUnits(1n, 18), "0.000000000000000001");
  assert.equal(formatUnits(0n, 6), "0");
  assert.equal(formatUnits("123000000000000000000", 18), "123");
});

test("hexToBigInt parses EVM quantities", () => {
  assert.equal(hexToBigInt("0x0"), 0n);
  assert.equal(hexToBigInt("0xde0b6b3a7640000"), 1_000_000_000_000_000_000n);
  assert.equal(hexToBigInt("0x"), 0n);
});

test("address validation distinguishes chains", () => {
  assert.equal(isSolanaAddress(SOL), true);
  assert.equal(isSolanaAddress("not an address"), false);
  assert.equal(isEvmAddress(EVM), true);
  assert.equal(isEvmAddress("0x123"), false);
  assert.equal(validateWalletAddress("SOLANA", SOL), true);
  assert.equal(validateWalletAddress("SOLANA", EVM), false);
  assert.equal(validateWalletAddress("BNB", EVM), true);
  assert.equal(validateWalletAddress("BNB", SOL), false);
});

test("only Solana and BNB are supported wallet chains", () => {
  assert.equal(isSupportedWalletChain("SOLANA"), true);
  assert.equal(isSupportedWalletChain("BNB"), true);
  assert.equal(isSupportedWalletChain("ROBINHOOD"), false);
});

// --- Solana provider --------------------------------------------------------

test("reads SOL and SPL token balances", async () => {
  const provider = new PublicRpcWalletProvider({
    now: () => NOW,
    fetchImpl: rpcFetch({
      getBalance: () => ({ context: { slot: 1 }, value: 1_500_000_000 }),
      getTokenAccountsByOwner: () => ({
        value: [
          {
            account: {
              data: {
                parsed: {
                  info: {
                    mint: "MintUsdcxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                    tokenAmount: { amount: "2500000", decimals: 6 },
                  },
                },
              },
            },
          },
          {
            account: {
              data: {
                parsed: {
                  info: {
                    mint: "MintZeroxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                    tokenAmount: { amount: "0", decimals: 6 },
                  },
                },
              },
            },
          },
        ],
      }),
    }),
  });

  const b = await provider.getBalances("SOLANA", SOL, [
    {
      address: "MintUsdcxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      symbol: "USDC",
      decimals: 6,
    },
  ]);
  assert.ok(b);
  assert.equal(b.native.symbol, "SOL");
  assert.equal(b.native.amount, "1.5");
  assert.equal(b.source, "public-rpc");
  assert.equal(b.fetchedAt, NOW);
  // The zero-balance mint is dropped.
  assert.equal(b.tokens.length, 1);
  assert.equal(b.tokens[0]!.symbol, "USDC");
  assert.equal(b.tokens[0]!.amount, "2.5");
  assert.equal(b.truncated, false);
});

test("caps token holdings and flags truncation (largest first)", async () => {
  const make = (mint: string, amount: string) => ({
    account: {
      data: { parsed: { info: { mint, tokenAmount: { amount, decimals: 0 } } } },
    },
  });
  const provider = new PublicRpcWalletProvider({
    maxTokenAccounts: 2,
    now: () => NOW,
    fetchImpl: rpcFetch({
      getBalance: () => ({ value: 0 }),
      getTokenAccountsByOwner: () => ({
        value: [make("m1", "5"), make("m2", "50"), make("m3", "500")],
      }),
    }),
  });
  const b = await provider.getBalances("SOLANA", SOL);
  assert.ok(b);
  assert.equal(b.truncated, true);
  assert.equal(b.tokens.length, 2);
  assert.deepEqual(
    b.tokens.map((t) => t.raw),
    ["500", "50"],
  );
});

// --- BNB provider -----------------------------------------------------------

test("reads BNB and known BEP-20 balances", async () => {
  const token = "0x00000000000000000000000000000000000000aa";
  const provider = new PublicRpcWalletProvider({
    now: () => NOW,
    fetchImpl: rpcFetch({
      eth_getBalance: () => "0xde0b6b3a7640000",
      eth_call: (params) => {
        const call = params[0] as { to: string };
        if (call.to.toLowerCase() === token) {
          return "0x" + (123n * 10n ** 18n).toString(16);
        }
        return "0x0";
      },
    }),
  });

  const b = await provider.getBalances("BNB", EVM, [
    { address: token, symbol: "PEPE", decimals: 18 },
    { address: "0x00000000000000000000000000000000000000bb", symbol: "NONE", decimals: 18 },
  ]);
  assert.ok(b);
  assert.equal(b.native.symbol, "BNB");
  assert.equal(b.native.amount, "1");
  assert.equal(b.tokens.length, 1);
  assert.equal(b.tokens[0]!.symbol, "PEPE");
  assert.equal(b.tokens[0]!.amount, "123");
});

// --- failure modes ----------------------------------------------------------

test("unsupported chain returns null without a request", async () => {
  let called = false;
  const provider = new PublicRpcWalletProvider({
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.equal(await provider.getBalances("ROBINHOOD", EVM), null);
  assert.equal(called, false);
});

test("an RPC error returns null (never invents a balance)", async () => {
  const provider = new PublicRpcWalletProvider({
    fetchImpl: rpcFetch({}),
  });
  assert.equal(await provider.getBalances("SOLANA", SOL), null);
});

test("a network failure returns null", async () => {
  const provider = new PublicRpcWalletProvider({
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(await provider.getBalances("BNB", EVM), null);
});
