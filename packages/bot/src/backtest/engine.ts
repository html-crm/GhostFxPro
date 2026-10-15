/**
 * Backtest engine.
 *
 * Replays real historical candles through an `ExitPolicy`, one trade at a time.
 * It is deliberately boring and honest: entry happens at the close of the
 * entry bar, exit at the close of whatever bar the policy closes on, and if the
 * policy never closes, the position is force-closed at the last bar and the
 * reason says so. Fees are subtracted per side. No look-ahead: a policy only
 * ever sees the candle it is being evaluated on.
 */

import type { Candle } from "../market/klines.ts";
import type {
  BacktestOptions,
  BacktestTrade,
  ExitPolicy,
  PositionSnapshot,
} from "./types.ts";

/** Runs a single trade and returns its outcome, or `null` if there is no room. */
export function runBacktest(
  candles: Candle[],
  opts: BacktestOptions,
): BacktestTrade | null {
  const entryIndex = opts.entryIndex ?? 0;
  if (entryIndex < 0 || entryIndex >= candles.length - 1) return null;

  const entry = candles[entryIndex]!;
  const entryPrice = entry.close;
  const feePct = Math.max(0, opts.feePct ?? 0);

  const lastIndex = candles.length - 1;
  const horizonEnd =
    opts.maxBarsHeld === undefined
      ? lastIndex
      : Math.min(lastIndex, entryIndex + Math.max(1, opts.maxBarsHeld));

  let state: PositionSnapshot = {
    entryPrice,
    peakPrice: entryPrice,
    tpArmed: false,
    trailingConfirmations: 0,
  };

  let peak = entryPrice;
  let maxDrawdownPct = 0;
  let exitIndex = horizonEnd;
  let exitPrice = candles[horizonEnd]!.close;
  let exitReason = "horizon_end";

  for (let i = entryIndex + 1; i <= horizonEnd; i += 1) {
    const candle = candles[i]!;
    peak = Math.max(peak, candle.close);
    const drawdown = peak > 0 ? (peak - candle.close) / peak : 0;
    if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;

    const decision = opts.policy(state, candle);
    if (decision.action === "CLOSE") {
      exitIndex = i;
      exitPrice = candle.close;
      exitReason = decision.reason || "policy_close";
      break;
    }
    state = decision.next;
  }

  const grossPnlPct = entryPrice > 0 ? exitPrice / entryPrice - 1 : 0;
  const netPnlPct = grossPnlPct - feePct * 2;

  return {
    entryIndex,
    exitIndex,
    entryPrice,
    exitPrice,
    barsHeld: exitIndex - entryIndex,
    peakPrice: peak,
    maxDrawdownPct,
    grossPnlPct,
    netPnlPct,
    exitReason,
  };
}

export interface BacktestSeriesOptions {
  policy: ExitPolicy;
  /** Run a trade starting every `stride` bars (default: every bar). */
  stride?: number;
  maxBarsHeld?: number;
  feePct?: number;
}

/**
 * Runs many overlapping trades — one entering every `stride` bars — so a single
 * policy can be scored across a whole history rather than one cherry-picked
 * entry. Overlapping entries are intentional: they sample every market regime
 * instead of one lucky start.
 */
export function runBacktestSeries(
  candles: Candle[],
  opts: BacktestSeriesOptions,
): BacktestTrade[] {
  const stride = Math.max(1, Math.floor(opts.stride ?? 1));
  const trades: BacktestTrade[] = [];
  for (let i = 0; i < candles.length - 1; i += stride) {
    const trade = runBacktest(candles, {
      policy: opts.policy,
      entryIndex: i,
      maxBarsHeld: opts.maxBarsHeld,
      feePct: opts.feePct,
    });
    if (trade) trades.push(trade);
  }
  return trades;
}
