/**
 * Backtest performance metrics.
 *
 * Plain, honest aggregates over a set of trade outcomes. Equity is computed by
 * compounding the trades **in the order given** (which, for a series, is
 * chronological). Drawdown is measured on that equity curve. Nothing is
 * annualised or extrapolated — these are raw sample statistics.
 */

import type { BacktestTrade } from "./types.ts";

export interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  /** Fraction of trades closed above entry. */
  winRate: number;
  /** Mean net return per trade (fraction). */
  avgPnlPct: number;
  /** Median net return per trade (fraction). */
  medianPnlPct: number;
  bestPnlPct: number;
  worstPnlPct: number;
  /** Sum of net returns (fraction) — not compounded. */
  totalReturnPct: number;
  /** Final equity from compounding (1 + sum of logs); 0 when a trade loses 100%. */
  finalEquity: number;
  /** Worst peak-to-trough drop of the compounded equity curve (positive fraction). */
  maxDrawdownPct: number;
  avgBarsHeld: number;
  /** Mean net return divided by magnitude of mean loss, when losses exist. */
  expectancyRatio: number | null;
}

export function summarize(trades: BacktestTrade[]): BacktestMetrics {
  const n = trades.length;
  if (n === 0) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgPnlPct: 0,
      medianPnlPct: 0,
      bestPnlPct: 0,
      worstPnlPct: 0,
      totalReturnPct: 0,
      finalEquity: 1,
      maxDrawdownPct: 0,
      avgBarsHeld: 0,
      expectancyRatio: null,
    };
  }

  const nets = trades.map((t) => t.netPnlPct);
  const wins = nets.filter((v) => v > 0);
  const losses = nets.filter((v) => v <= 0);

  const sum = nets.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const sorted = [...nets].sort((a, b) => a - b);
  const median =
    n % 2 === 1
      ? sorted[(n - 1) / 2]!
      : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;

  let equity = 1;
  let peakEquity = 1;
  let maxDrawdownPct = 0;
  for (const r of nets) {
    equity *= 1 + r;
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const avgLoss =
    losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / n,
    avgPnlPct: avg,
    medianPnlPct: median,
    bestPnlPct: sorted[sorted.length - 1]!,
    worstPnlPct: sorted[0]!,
    totalReturnPct: sum,
    finalEquity: equity,
    maxDrawdownPct,
    avgBarsHeld: trades.reduce((a, t) => a + t.barsHeld, 0) / n,
    expectancyRatio: avgLoss < 0 ? avg / Math.abs(avgLoss) : null,
  };
}
