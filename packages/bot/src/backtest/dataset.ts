/**
 * Labeled decision dataset.
 *
 * Turns a price history into supervised training rows of the form
 * "at this moment, with these features, was closing the position the right
 * call?" — the exact signal a model needs to learn *when to close vs hold*.
 *
 * The label is defined without look-ahead ambiguity: at decision point `j`,
 * closing is the correct action (`CLOSE`) when the current close is at least as
 * good as any close in the next `lookahead` bars; otherwise holding
 * (`HOLD`) would have paid off. This is a clean local-maximum rule, not a
 * tuned threshold.
 *
 * Pure and deterministic. It never reads future data for anything except the
 * label — features use only information available at `j`.
 */

import type { Candle } from "../market/klines.ts";

export type DecisionLabel = "CLOSE" | "HOLD";

export interface DecisionFeatures {
  /** Return since entry, as a fraction. */
  returnPct: number;
  /** Peak return since entry, as a fraction. */
  peakReturnPct: number;
  /** Drop from the running peak, as a positive fraction. */
  drawdownFromPeak: number;
  /** Bars held so far. */
  barsHeld: number;
  /** Short-term momentum (return over `momentumLookback` bars). */
  momentum: number;
  /** Std-dev of bar returns observed since entry (0 when under two bars). */
  volatility: number;
}

export interface DatasetRow {
  /** Bar index the position opened on. */
  entryIndex: number;
  /** Bar index of this decision. */
  index: number;
  /** Candle close time (ms). */
  ts: number;
  entryPrice: number;
  price: number;
  features: DecisionFeatures;
  label: DecisionLabel;
}

export interface DatasetOptions {
  /** Run a new episode entering every `entryStride` bars (default 1). */
  entryStride?: number;
  /** Maximum bars a position may stay open (also lengths each episode). */
  horizon?: number;
  /** Forward window used only to compute the label (default 12). */
  lookahead?: number;
  /** Bars used for the momentum feature (default 3). */
  momentumLookback?: number;
  /** Bars used for the volatility feature (default 12). */
  volWindow?: number;
}

export function buildDecisionDataset(
  candles: Candle[],
  opts: DatasetOptions = {},
): DatasetRow[] {
  const entryStride = Math.max(1, Math.floor(opts.entryStride ?? 1));
  const horizon = Math.max(1, Math.floor(opts.horizon ?? 24));
  const lookahead = Math.max(0, Math.floor(opts.lookahead ?? 12));
  const momentumLookback = Math.max(1, Math.floor(opts.momentumLookback ?? 3));
  const volWindow = Math.max(1, Math.floor(opts.volWindow ?? 12));

  const rows: DatasetRow[] = [];
  const n = candles.length;
  if (n < 2) return rows;

  for (let i = 0; i < n - 1; i += entryStride) {
    const entryPrice = candles[i]!.close;
    if (entryPrice <= 0) continue;
    let peak = entryPrice;
    const returns: number[] = [];

    const episodeEnd = Math.min(n - 1, i + horizon);
    for (let j = i + 1; j <= episodeEnd; j += 1) {
      const close = candles[j]!.close;
      const prevClose = candles[j - 1]!.close;
      if (prevClose > 0) returns.push(close / prevClose - 1);
      peak = Math.max(peak, close);

      const momentumBase = candles[j - momentumLookback]?.close ?? candles[0]!.close;
      const momentum = momentumBase > 0 ? close / momentumBase - 1 : 0;

      const features: DecisionFeatures = {
        returnPct: close / entryPrice - 1,
        peakReturnPct: peak / entryPrice - 1,
        drawdownFromPeak: peak > 0 ? (peak - close) / peak : 0,
        barsHeld: j - i,
        momentum,
        volatility: stdev(returns.slice(-volWindow)),
      };

      rows.push({
        entryIndex: i,
        index: j,
        ts: candles[j]!.closeTime,
        entryPrice,
        price: close,
        features,
        label: labelAt(candles, j, lookahead, close),
      });
    }
  }

  return rows;
}

/**
 * Close now is correct when no close in the forward window beats it. Ties go to
 * CLOSE (locking in the high is never the wrong call). At the last bar the
 * position must be closed, so the label is CLOSE.
 */
function labelAt(
  candles: Candle[],
  index: number,
  lookahead: number,
  close: number,
): DecisionLabel {
  const end = Math.min(candles.length - 1, index + lookahead);
  let best = close;
  for (let k = index + 1; k <= end; k += 1) {
    best = Math.max(best, candles[k]!.close);
  }
  return close >= best ? "CLOSE" : "HOLD";
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
