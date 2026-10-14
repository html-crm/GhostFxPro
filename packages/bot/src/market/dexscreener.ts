import type { Quote } from "../strategy/types.ts";
import type { FetchLike, MarketDataProvider, TokenRef } from "./types.ts";

const BASE = "https://api.dexscreener.com/latest/dex/tokens";

/** Minimal shape of the DEX Screener token response we depend on. */
interface DexPair {
  chainId?: string;
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number } | null;
}

interface DexResponse {
  pairs?: DexPair[] | null;
}

export interface DexScreenerOptions {
  fetchImpl?: FetchLike;
  /** Map our chain kinds onto DEX Screener chain ids when filtering pairs. */
  chainIds?: Record<string, string>;
  timeoutMs?: number;
  now?: () => number;
}

const DEFAULT_CHAIN_IDS: Record<string, string> = {
  SOLANA: "solana",
  BNB: "bsc",
};

/**
 * Read-only DEX Screener price adapter. It selects the pair with the deepest
 * liquidity (optionally restricted to the expected chain) and returns its USD
 * price. It never writes and never executes anything.
 */
export class DexScreenerProvider implements MarketDataProvider {
  readonly name = "dexscreener";
  private readonly fetchImpl: FetchLike;
  private readonly chainIds: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(opts: DexScreenerOptions = {}) {
    this.fetchImpl =
      opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.chainIds = opts.chainIds ?? DEFAULT_CHAIN_IDS;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.now = opts.now ?? (() => Date.now());
  }

  async getQuote(token: TokenRef): Promise<Quote | null> {
    if (!token.address) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${BASE}/${token.address}`, {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as DexResponse;
      const pair = selectPair(body.pairs ?? [], this.chainIds[token.chain]);
      if (!pair?.priceUsd) return null;
      const price = Number(pair.priceUsd);
      if (!Number.isFinite(price) || price <= 0) return null;
      return { price, ts: this.now(), source: this.name };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Picks the deepest-liquidity pair, preferring the expected chain. */
export function selectPair(
  pairs: DexPair[],
  expectedChainId?: string,
): DexPair | null {
  const candidates = expectedChainId
    ? pairs.filter((p) => p.chainId === expectedChainId)
    : pairs;
  const pool = candidates.length > 0 ? candidates : pairs;
  let best: DexPair | null = null;
  let bestLiq = -1;
  for (const p of pool) {
    const liq = p.liquidity?.usd ?? 0;
    if (liq > bestLiq) {
      bestLiq = liq;
      best = p;
    }
  }
  return best;
}
