import type { Quote } from "../strategy/types.ts";
import type { MarketDataProvider, TokenRef } from "./types.ts";

/**
 * Deterministic provider for tests and dry-runs. Given a scripted price path
 * it advances one step per `getQuote` call (keyed by token address). When the
 * script is exhausted it repeats the final price. This lets a paper-trading
 * run be fully reproducible.
 */
export class MockProvider implements MarketDataProvider {
  readonly name = "mock";
  private readonly scripts = new Map<string, number[]>();
  private readonly cursors = new Map<string, number>();
  private now: () => number;

  constructor(
    scripts: Record<string, number[]>,
    now: () => number = () => Date.now(),
  ) {
    for (const [address, prices] of Object.entries(scripts)) {
      if (prices.length === 0) continue;
      this.scripts.set(address, prices);
      this.cursors.set(address, 0);
    }
    this.now = now;
  }

  async getQuote(token: TokenRef): Promise<Quote | null> {
    const script = this.scripts.get(token.address);
    if (!script) return null;
    const idx = this.cursors.get(token.address) ?? 0;
    const price = script[Math.min(idx, script.length - 1)]!;
    this.cursors.set(token.address, idx + 1);
    return { price, ts: this.now(), source: this.name };
  }
}
