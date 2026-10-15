import { apiFetch } from "./api";
import { getToken } from "./session";

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
  fetchedAt: number;
}

export interface MarketSearchResult {
  source: string;
  query: string;
  fetchedAt: number;
  count: number;
  pairs: PairSummary[];
}

export async function searchPairs(
  query: string,
): Promise<MarketSearchResult | null> {
  const token = await getToken();
  if (!token) return null;
  const res = await apiFetch<MarketSearchResult>(
    `/market/search?q=${encodeURIComponent(query)}`,
    { token },
  );
  return res.ok && res.data ? res.data : null;
}
