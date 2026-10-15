/**
 * Backtest types.
 *
 * A "policy" answers the question the bot actually cares about: given an open
 * position, should I close now or hold? FLEXI is one such policy; a learned
 * model is another. Keeping this interface tiny means the same engine can score
 * a hand-written rule set and a trained model side by side on identical data.
 */

import type { Candle } from "../market/klines.ts";

/** Everything a policy needs to know about the open position right now. */
export interface PositionSnapshot {
  entryPrice: number;
  /** Highest close observed since entry. */
  peakPrice: number;
  /** Whether the take-profit threshold has been reached (arms trailing). */
  tpArmed: boolean;
  /** Consecutive observations at/below the trailing threshold. */
  trailingConfirmations: number;
}

export type ExitAction = "HOLD" | "CLOSE";

export interface ExitDecision {
  action: ExitAction;
  /** Human-readable explanation, always populated. */
  reason: string;
  /** State to carry forward (ignored when action is CLOSE). */
  next: PositionSnapshot;
}

/**
 * Context handed to a policy so a learned model can rebuild the same features
 * used during training. Replay data is read-only and index-addressed.
 */
export interface PolicyContext {
  candles: Candle[];
  entryIndex: number;
  index: number;
}

/**
 * Pure decision function. Given the current position state and the latest
 * candle, decide whether to close. Implementations must be deterministic for
 * the same inputs.
 */
export type ExitPolicy = (
  state: PositionSnapshot,
  candle: Candle,
  ctx: PolicyContext,
) => ExitDecision;

export interface BacktestOptions {
  policy: ExitPolicy;
  /** Bar index at which the position opens (default 0). */
  entryIndex?: number;
  /** Maximum bars to hold before force-closing at the last bar (default: to end). */
  maxBarsHeld?: number;
  /** Round-trip cost as a fraction, applied per side (default 0). */
  feePct?: number;
}

/** The outcome of a single simulated trade. Percentages are fractions. */
export interface BacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  barsHeld: number;
  /** Peak close seen while open. */
  peakPrice: number;
  /** Worst close-to-peak drop while open, as a positive fraction. */
  maxDrawdownPct: number;
  /** Gross return as a fraction (before fees). */
  grossPnlPct: number;
  /** Net return as a fraction (after round-trip fees). */
  netPnlPct: number;
  /** Why the position closed (e.g. "trailing_exit" or "horizon_end"). */
  exitReason: string;
}

export type DecisionLabel = "CLOSE" | "HOLD";

/** Feature vector for one decision point. Names are stable; order is set by consumers. */
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
  /** Std-dev of bar returns over the short window (0 when under two bars). */
  volatility: number;
  /** Bars since the running peak was set (0 when the peak is the current bar). */
  peakAge: number;
  /** Longer-term momentum (return over `momentumLongLookback` bars). */
  momentumLong: number;
  /** Short volatility divided by long volatility (regime; 1 when undefined). */
  volatilityRatio: number;
  /** Distance of close from a trailing simple moving average, as a fraction. */
  smaDeviation: number;
  /** Simple RSI over the last `rsiWindow` changes (50 when flat). */
  rsi: number;
}
