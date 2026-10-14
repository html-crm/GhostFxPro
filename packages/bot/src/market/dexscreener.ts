import type { Quote } from "../strategy/types.ts";
import type { FetchLike, MarketDataProvider, TokenRef } from "./types.ts";

const BASE = "https://api.dexscreener.com/latest/dex/tokens";

interface DexTokenRef {
  address?: string;
}

/** Minimal shape of the DEX Screener token response we depend on. */
interface DexPair {
  chainId?: string;
  priceUsd?: string;
  priceNative?: string;
  baseToken?: DexTokenRef | null;
  quoteToken?: DexTokenRef | null;
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
      const pair = selectPair(
        body.pairs ?? [],
        this.chainIds[token.chain],
        token.address,
      );
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

/**
 * Picks the deepest-liquidity pair whose **base** token is the token we asked
 * about, preferring the expected chain.
 *
 * DEX Screener returns every pair touching an address, including pairs where
 * the address is the *quote* token. For those, `priceUsd` is the price of the
 * pair's base token — NOT ours. Reading it would report another asset's price
 * (e.g. asking for USDC and getting PUMP). So we require the base-token address
 * to match and otherwise return null rather than a confidently wrong number.
 *
 * When `tokenAddress` is omitted the previous chain-only behaviour is retained
 * (used by tests / callers that already filtered).
 */
export function selectPair(
  pairs: DexPair[],
  expectedChainId?: string,
  tokenAddress?: string,
): DexPair | null {
  let pool = pairs;
  if (expectedChainId) {
    const onChain = pairs.filter((p) => p.chainId === expectedChainId);
    if (onChain.length > 0) pool = onChain;
  }
  if (tokenAddress) {
    const wanted = tokenAddress.toLowerCase();
    const baseMatches = pool.filter(
      (p) => p.baseToken?.address?.toLowerCase() === wanted,
    );
    if (baseMatches.length === 0) return null;
    pool = baseMatches;
  }
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
