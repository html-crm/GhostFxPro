/**
 * Labeled decision dataset.
 *
 * Turns a price history into supervised training rows of the form
 * "at this moment, with these features, was closing the position the right
 * call?" — the exact signal a model needs to learn *when to close vs hold*.
 *
 * The label is a risk-adjusted "advantage" rule: at decision point `j`, closing
 * is correct (`CLOSE`) when the gain already locked in is at least as large as
 * the further downside still ahead — i.e. when the current close sits in the
 * upper half of the upcoming price range (`close - worst >= best - close`).
 * Holding (`HOLD`) is correct when the remaining upside outweighs the
 * remaining downside. This is symmetric, needs no tuned threshold, and yields a
 * far less imbalanced target than a strict local-maximum rule.
 *
 * Features come from the shared `computeDecisionFeatures`, so training and
 * runtime inference see identical inputs. It never reads future data for
 * anything except the label — features use only information available at `j`.
 */

import type { Candle } from "../market/klines.ts";
import { computeDecisionFeatures, type FeatureOptions } from "./features.ts";
import type { DecisionFeatures, DecisionLabel } from "./types.ts";

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

export interface DatasetOptions extends FeatureOptions {
  /** Run a new episode entering every `entryStride` bars (default 1). */
  entryStride?: number;
  /** Maximum bars a position may stay open (also lengths each episode). */
  horizon?: number;
  /** Forward window used only to compute the label (default 12). */
  lookahead?: number;
}

export function buildDecisionDataset(
  candles: Candle[],
  opts: DatasetOptions = {},
): DatasetRow[] {
  const entryStride = Math.max(1, Math.floor(opts.entryStride ?? 1));
  const horizon = Math.max(1, Math.floor(opts.horizon ?? 24));
  const lookahead = Math.max(0, Math.floor(opts.lookahead ?? 12));

  const rows: DatasetRow[] = [];
  const n = candles.length;
  if (n < 2) return rows;

  for (let i = 0; i < n - 1; i += entryStride) {
    const entryPrice = candles[i]!.close;
    if (entryPrice <= 0) continue;

    const episodeEnd = Math.min(n - 1, i + horizon);
    for (let j = i + 1; j <= episodeEnd; j += 1) {
      const features = computeDecisionFeatures(candles, i, j, {
        momentumLookback: opts.momentumLookback,
        momentumLongLookback: opts.momentumLongLookback,
        volWindow: opts.volWindow,
        volLongWindow: opts.volLongWindow,
        smaWindow: opts.smaWindow,
        rsiWindow: opts.rsiWindow,
      });
      if (!features) continue;
      rows.push({
        entryIndex: i,
        index: j,
        ts: candles[j]!.closeTime,
        entryPrice,
        price: candles[j]!.close,
        features,
        label: labelAt(candles, j, lookahead, candles[j]!.close),
      });
    }
  }

  return rows;
}

/**
 * Close now is correct when the downside still ahead is at least the upside
 * still ahead (the close sits in the upper half of the forward range). Ties go
 * to CLOSE — locking in is never the wrong call. At the last bar the position
 * must be closed, so the label is CLOSE.
 */
function labelAt(
  candles: Candle[],
  index: number,
  lookahead: number,
  close: number,
): DecisionLabel {
  const end = Math.min(candles.length - 1, index + lookahead);
  let best = close;
  let worst = close;
  for (let k = index + 1; k <= end; k += 1) {
    const c = candles[k]!.close;
    best = Math.max(best, c);
    worst = Math.min(worst, c);
  }
  const upside = close > 0 ? (best - close) / close : 0;
  const downside = close > 0 ? (close - worst) / close : 0;
  return downside >= upside ? "CLOSE" : "HOLD";
}

/** Serialises dataset rows to JSONL for the Python trainer. One row per line. */
export function datasetToJsonl(rows: DatasetRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}
