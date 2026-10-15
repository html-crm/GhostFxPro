import type { Quote } from "../strategy/types.ts";
import type { FetchLike, MarketDataProvider, TokenRef } from "./types.ts";

const BASE = "https://api.dexscreener.com/latest/dex/tokens";
const SEARCH_BASE = "https://api.dexscreener.com/latest/dex/search";

interface DexTokenRef {
  address?: string;
  name?: string;
  symbol?: string;
}

/** Minimal shape of the DEX Screener token response we depend on. */
interface DexPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  priceUsd?: string;
  priceNative?: string;
  baseToken?: DexTokenRef | null;
  quoteToken?: DexTokenRef | null;
  liquidity?: { usd?: number } | null;
  volume?: { h24?: number } | null;
  priceChange?: { h24?: number } | null;
  pairCreatedAt?: number;
}

/** Flattened, UI-friendly view of a discovered pair. Read-only. */
export interface PairSummary {
  chainId: string;
  dexId: string;
  pairAddress: string;
  url: string | null;
  baseSymbol: string;
  baseAddress: string;
  baseName: string | null;
  quoteSymbol: string;
  quoteAddress: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24h: number | null;
  pairCreatedAt: number | null;
  /** When this data was observed (ms). Never presented as realtime. */
  fetchedAt: number;
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

function toPairSummary(p: DexPair, ts: number): PairSummary {
  const priceUsd = p.priceUsd !== undefined ? Number(p.priceUsd) : NaN;
  const priceChange = p.priceChange?.h24;
  return {
    chainId: p.chainId ?? "unknown",
    dexId: p.dexId ?? "unknown",
    pairAddress: p.pairAddress ?? "",
    url: p.url ?? null,
    baseSymbol: p.baseToken?.symbol ?? "?",
    baseAddress: p.baseToken?.address ?? "",
    baseName: p.baseToken?.name ?? null,
    quoteSymbol: p.quoteToken?.symbol ?? "?",
    quoteAddress: p.quoteToken?.address ?? "",
    priceUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null,
    liquidityUsd: p.liquidity?.usd ?? null,
    volume24hUsd: p.volume?.h24 ?? null,
    priceChange24h: typeof priceChange === "number" ? priceChange : null,
    pairCreatedAt: p.pairCreatedAt ?? null,
    fetchedAt: ts,
  };
}

/**
 * Read-only token/pair discovery via the DEX Screener search endpoint
 * (`/latest/dex/search?q=`). Returns at most 30 pairs, richest liquidity first.
 * It never executes anything and never invents values: missing fields stay null.
 */
export async function searchPairs(
  query: string,
  opts: DexScreenerOptions = {},
): Promise<PairSummary[]> {
  const q = query.trim();
  if (!q) return [];
  const fetchImpl =
    opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 8000;
  const now = opts.now ?? (() => Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${SEARCH_BASE}?q=${encodeURIComponent(q)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as DexResponse;
    const pairs = body.pairs ?? [];
    const ts = now();
    return pairs
      .map((p) => toPairSummary(p, ts))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, 30);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
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
