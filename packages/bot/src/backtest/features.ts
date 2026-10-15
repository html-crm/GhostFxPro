/**
 * Feature extraction.
 *
 * One shared implementation used by BOTH the training-data builder and the
 * runtime learned policy, so the features a model is trained on are exactly the
 * features it is served. Any divergence here would silently poison inference.
 *
 * Features are computed only from bars up to and including `index` — no
 * look-ahead. Windows are bounded by the available history (never by future
 * bars), so early bars degrade gracefully instead of throwing.
 */

import type { Candle } from "../market/klines.ts";
import type { DecisionFeatures } from "./types.ts";

export interface FeatureOptions {
  /** Bars used for the short momentum feature (default 3). */
  momentumLookback?: number;
  /** Bars used for the long momentum feature (default 12). */
  momentumLongLookback?: number;
  /** Bars used for the short volatility feature (default 12). */
  volWindow?: number;
  /** Bars used for the long volatility / regime feature (default 24). */
  volLongWindow?: number;
  /** Bars used for the moving-average trend feature (default 20). */
  smaWindow?: number;
  /** Bars used for RSI (default 14). */
  rsiWindow?: number;
}

/** Feature names in the canonical order models are trained/served with. */
export const FEATURE_NAMES = [
  "returnPct",
  "peakReturnPct",
  "drawdownFromPeak",
  "barsHeld",
  "momentum",
  "volatility",
  "peakAge",
  "momentumLong",
  "volatilityRatio",
  "smaDeviation",
  "rsi",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/**
 * Computes features for a decision at bar `index` for a position entered at
 * `entryIndex`. Returns `null` when the indices are out of range or the entry
 * price is unusable.
 */
export function computeDecisionFeatures(
  candles: Candle[],
  entryIndex: number,
  index: number,
  opts: FeatureOptions = {},
): DecisionFeatures | null {
  if (entryIndex < 0 || index <= entryIndex || index >= candles.length) return null;
  const entryPrice = candles[entryIndex]!.close;
  if (!(entryPrice > 0)) return null;

  const momentumLookback = win(opts.momentumLookback, 3);
  const momentumLongLookback = win(opts.momentumLongLookback, 12);
  const volWindow = win(opts.volWindow, 12);
  const volLongWindow = win(opts.volLongWindow, 24);
  const smaWindow = win(opts.smaWindow, 20);
  const rsiWindow = win(opts.rsiWindow, 14);

  // Running peak (and how long ago it was) since entry.
  let peak = entryPrice;
  let peakIndex = entryIndex;
  for (let k = entryIndex; k <= index; k += 1) {
    const c = candles[k]!.close;
    if (c > peak) {
      peak = c;
      peakIndex = k;
    }
  }

  const close = candles[index]!.close;
  const momentum = ratioReturn(candles, index, momentumLookback);
  const momentumLong = ratioReturn(candles, index, momentumLongLookback);
  const volatility = stdev(barReturns(candles, index - volWindow + 1, index));
  const volLong = stdev(barReturns(candles, index - volLongWindow + 1, index));
  const sma = mean(candles, index - smaWindow + 1, index);

  return {
    returnPct: close / entryPrice - 1,
    peakReturnPct: peak / entryPrice - 1,
    drawdownFromPeak: peak > 0 ? (peak - close) / peak : 0,
    barsHeld: index - entryIndex,
    momentum,
    volatility,
    peakAge: index - peakIndex,
    momentumLong,
    volatilityRatio: volLong > 0 ? volatility / volLong : 1,
    smaDeviation: sma > 0 ? close / sma - 1 : 0,
    rsi: rsi(candles, index, rsiWindow),
  };
}

/** Reads one named feature from a feature vector. Throws on an unknown name. */
export function readFeature(f: DecisionFeatures, name: string): number {
  switch (name) {
    case "returnPct":
      return f.returnPct;
    case "peakReturnPct":
      return f.peakReturnPct;
    case "drawdownFromPeak":
      return f.drawdownFromPeak;
    case "barsHeld":
      return f.barsHeld;
    case "momentum":
      return f.momentum;
    case "volatility":
      return f.volatility;
    case "peakAge":
      return f.peakAge;
    case "momentumLong":
      return f.momentumLong;
    case "volatilityRatio":
      return f.volatilityRatio;
    case "smaDeviation":
      return f.smaDeviation;
    case "rsi":
      return f.rsi;
    default:
      throw new Error(`unknown feature: ${name}`);
  }
}

function win(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(value ?? fallback));
}

function ratioReturn(candles: Candle[], index: number, lookback: number): number {
  const base = candles[index - lookback]?.close ?? candles[0]!.close;
  return base > 0 ? candles[index]!.close / base - 1 : 0;
}

/** Bar-over-bar simple returns over [from, to] inclusive. */
function barReturns(candles: Candle[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let k = Math.max(1, from); k <= to; k += 1) {
    const prev = candles[k - 1]!.close;
    if (prev > 0) out.push(candles[k]!.close / prev - 1);
  }
  return out;
}

function mean(candles: Candle[], from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let k = Math.max(0, from); k <= to; k += 1) {
    sum += candles[k]!.close;
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

/** Wilder-free simple RSI over the last `period` changes (50 when flat). */
function rsi(candles: Candle[], index: number, period: number): number {
  if (index < 1) return 50;
  let gains = 0;
  let losses = 0;
  const start = Math.max(1, index - period + 1);
  let n = 0;
  for (let k = start; k <= index; k += 1) {
    const diff = candles[k]!.close - candles[k - 1]!.close;
    if (diff > 0) gains += diff;
    else losses -= diff;
    n += 1;
  }
  if (n === 0) return 50;
  const avgGain = gains / n;
  const avgLoss = losses / n;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
