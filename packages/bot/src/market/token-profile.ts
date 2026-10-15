/**
 * Token lookup by contract address.
 *
 * Paste a contract address and get back the token's identity (chain, symbol,
 * name), its on-chain decimals, and the best observable market (price,
 * liquidity) — so a form can be filled automatically instead of by hand.
 *
 * Read-only: it never places an order and never invents a value. A field the
 * source cannot answer stays null.
 */

import { isEvmAddress, isSolanaAddress, type RpcFetchLike } from "../wallet/balances.ts";
import type { FetchLike } from "./types.ts";

const TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens";
const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const DEFAULT_BSC_RPC = "https://bsc-dataseed.bnbchain.org";
const DECIMALS_SELECTOR = "0x313ce567";

export type TokenChain = "SOLANA" | "BNB";

/** Identity + market facts for one token, observed from public sources. */
export interface TokenProfile {
  chain: TokenChain;
  address: string;
  symbol: string | null;
  name: string | null;
  /** On-chain decimals (SPL `decimals` / ERC-20 `decimals()`). */
  decimals: number | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  /** Number of pairs found for this token (deepest is used). */
  pairCount: number;
  dexId: string | null;
  pairAddress: string | null;
  /** When this data was observed (ms). Never presented as realtime. */
  fetchedAt: number;
}

export interface TokenProfileOptions {
  /** DEX Screener HTTP client (injectable for tests). */
  fetchImpl?: FetchLike;
  /** Solana / BSC JSON-RPC client (injectable for tests). */
  rpcFetchImpl?: RpcFetchLike;
  timeoutMs?: number;
  now?: () => number;
  solanaRpcUrl?: string;
  bscRpcUrl?: string;
}

/**
 * Guesses the chain from the shape of a contract address: `0x` + 40 hex is
 * EVM (BNB), base58 32-44 chars is Solana. Ambiguity is resolved by shape,
 * and an unrecognised address returns null rather than a guess.
 */
export function detectTokenChain(address: string): TokenChain | null {
  const a = (address ?? "").trim();
  if (isEvmAddress(a)) return "BNB";
  if (isSolanaAddress(a)) return "SOLANA";
  return null;
}

interface DexTokenRef {
  address?: string;
  name?: string;
  symbol?: string;
}

interface DexPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  priceUsd?: string;
  baseToken?: DexTokenRef | null;
  quoteToken?: DexTokenRef | null;
  liquidity?: { usd?: number } | null;
}

interface DexResponse {
  pairs?: DexPair[] | null;
}

const CHAIN_IDS: Record<TokenChain, string> = {
  SOLANA: "solana",
  BNB: "bsc",
};

/**
 * Resolves a token from its contract address. Returns `null` when the address
 * shape is unknown or the token has no observable market, so callers surface
 * "not found" instead of a half-filled guess.
 */
export async function getTokenProfile(
  address: string,
  opts: TokenProfileOptions = {},
): Promise<TokenProfile | null> {
  const chain = detectTokenChain(address);
  if (!chain) return null;

  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const rpcFetchImpl = opts.rpcFetchImpl ?? (globalThis.fetch as unknown as RpcFetchLike);
  const timeoutMs = opts.timeoutMs ?? 8000;
  const now = opts.now ?? (() => Date.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${TOKENS_URL}/${encodeURIComponent(address.trim())}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as DexResponse;
    const all = body.pairs ?? [];
    const wanted = CHAIN_IDS[chain];
    const mine = all.filter(
      (p) => p.chainId === wanted && p.baseToken?.address?.toLowerCase() === address.trim().toLowerCase(),
    );
    const pair = selectPairLike(mine);
    if (!pair) return null;

    const price = pair.priceUsd !== undefined ? Number(pair.priceUsd) : NaN;
    const decimals = await fetchDecimals(chain, address.trim(), rpcFetchImpl, opts);

    return {
      chain,
      address: address.trim(),
      symbol: pair.baseToken?.symbol ?? null,
      name: pair.baseToken?.name ?? null,
      decimals,
      priceUsd: Number.isFinite(price) && price > 0 ? price : null,
      liquidityUsd: pair.liquidity?.usd ?? null,
      pairCount: mine.length,
      dexId: pair.dexId ?? null,
      pairAddress: pair.pairAddress ?? null,
      fetchedAt: now(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Deepest-liquidity pair wins; a missing liquidity value counts as 0. */
function selectPairLike(pairs: DexPair[]): DexPair | null {
  let best: DexPair | null = null;
  let bestLiq = -1;
  for (const p of pairs) {
    const liq = p.liquidity?.usd ?? 0;
    if (liq > bestLiq) {
      bestLiq = liq;
      best = p;
    }
  }
  return best;
}

/** Reads token decimals from the chain; `null` when the RPC cannot answer. */
async function fetchDecimals(
  chain: TokenChain,
  address: string,
  rpcFetchImpl: RpcFetchLike,
  opts: TokenProfileOptions,
): Promise<number | null> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (chain === "SOLANA") {
      const url = opts.solanaRpcUrl ?? DEFAULT_SOLANA_RPC;
      const res = await rpcFetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenSupply",
          params: [address],
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        result?: { value?: { decimals?: number } };
      };
      const d = body.result?.value?.decimals;
      return Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 36 ? (d as number) : null;
    }

    const url = opts.bscRpcUrl ?? DEFAULT_BSC_RPC;
    const res = await rpcFetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: address, data: DECIMALS_SELECTOR }, "latest"],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string };
    const hex = body.result;
    if (typeof hex !== "string" || hex === "0x" || hex === "0x0") return null;
    const value = Number(BigInt(hex));
    return Number.isInteger(value) && value >= 0 && value <= 36 ? value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
