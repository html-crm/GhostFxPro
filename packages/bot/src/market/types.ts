import type { Quote } from "../strategy/types.ts";

/** Identifies a market without relying on a display symbol. */
export interface TokenRef {
  chain: string;
  /** Contract address (the identity for a token). */
  address: string;
}

export interface MarketDataProvider {
  readonly name: string;
  /**
   * Returns the best available quote for a token, or `null` when the token has
   * no observable market. Implementations must never invent a price.
   */
  getQuote(token: TokenRef): Promise<Quote | null>;
}

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
