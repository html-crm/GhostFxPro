import type { Quote } from "../strategy/types.ts";

export interface FreshnessResult {
  fresh: boolean;
  ageMs: number;
}

/**
 * A quote older than `maxAgeMs` must never drive a trade. This is the single
 * guard used by every evaluation path.
 */
export function checkQuoteFreshness(
  quote: Quote,
  now: number,
  maxAgeMs: number,
): FreshnessResult {
  const ageMs = Math.max(0, now - quote.ts);
  return { fresh: ageMs <= maxAgeMs, ageMs };
}

export interface SlippageInput {
  side: "BUY" | "SELL";
  expectedPrice: number;
  actualPrice: number;
  maxSlippagePct: number;
}

export interface SlippageResult {
  ok: boolean;
  /** Signed slippage as a fraction of the expected price (positive = worse). */
  slippagePct: number;
}

/**
 * Enforces a maximum adverse price move between decision and execution.
 * BUY: paying more than expected is adverse. SELL: receiving less is adverse.
 */
export function checkSlippage(input: SlippageInput): SlippageResult {
  const { side, expectedPrice, actualPrice, maxSlippagePct } = input;
  if (expectedPrice <= 0) {
    return { ok: false, slippagePct: Number.POSITIVE_INFINITY };
  }
  const adverse =
    side === "BUY"
      ? (actualPrice - expectedPrice) / expectedPrice
      : (expectedPrice - actualPrice) / expectedPrice;
  return { ok: adverse <= maxSlippagePct, slippagePct: adverse };
}

export interface NotionalInput {
  qty: number;
  price: number;
  minNotional: number;
}

/** Rejects dust orders that would be dominated by fees. */
export function checkMinNotional(input: NotionalInput): boolean {
  return input.qty * input.price >= input.minNotional;
}

/**
 * Idempotency guard: returns true when `key` has already been seen. Callers
 * pass the same key to re-submission and to the DB `UNIQUE` constraint, so a
 * crash-and-retry can never double-execute.
 */
export function isReplay(seen: Iterable<string>, key: string): boolean {
  for (const k of seen) if (k === key) return true;
  return false;
}
