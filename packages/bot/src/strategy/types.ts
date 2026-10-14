/**
 * Strategy engine types.
 *
 * All prices here are *display/decision* magnitudes derived from validated
 * market data. The authoritative financial record is the Postgres `numeric`
 * ledger (fills / ledger_entries). This module must never be the source of
 * truth for money.
 */

/** A validated price observation from a single market-data source. */
export interface Quote {
  /** Quote price in the stake/quote asset. */
  price: number;
  /** Observation time, epoch milliseconds. */
  ts: number;
  /** Human-readable source id, e.g. "dexscreener". Never used for identity. */
  source: string;
}

/** Persisted per-trade evaluation state. Immutable identity lives in the DB. */
export interface PositionState {
  tradeId: string;
  entryPrice: number;
  /** Highest price observed since entry. */
  peakPrice: number;
  /** Whether the take-profit threshold has been reached (arms trailing). */
  tpArmed: boolean;
  /** Consecutive polls observed at/below the trailing threshold. */
  trailingConfirmations: number;
}

/**
 * FLEXI configuration. Every threshold is explicit and versioned; nothing is
 * hard-coded at runtime. Defaults reproduce the documented behaviour:
 * arm trailing at +7%, exit on a 2% pullback from peak confirmed twice.
 */
export interface FlexiConfig {
  /** Fractional arm threshold, e.g. 0.07 for +7%. */
  takeProfitArmPct: number;
  /** Fractional trailing distance below peak, e.g. 0.02 for 2%. */
  trailingPercent: number;
  /** Consecutive confirming polls required to exit. */
  trailingConfirmations: number;
  /**
   * Optional hard stop-loss fraction below entry (e.g. 0.10). `null` disables
   * it. A stop-loss is never invented implicitly; it must be configured.
   */
  stopLossPct: number | null;
}

/** Result category of an evaluation, mirroring `decisions.decision`. */
export type DecisionAction = "BUY" | "SELL" | "HOLD" | "WAIT_OBSERVE" | "REJECT";

export type TriggeringRule =
  | "take_profit_arm"
  | "trailing_exit"
  | "stop_loss"
  | null;

/** Fully explainable evaluation, mirroring the `exit_evaluations` columns. */
export interface Evaluation {
  decisionId: string;
  tradeId: string;
  strategyVersion: number;
  action: DecisionAction;
  reason: string;
  triggeringRule: TriggeringRule;
  rejectionReason: string | null;
  marketDataTs: number;
  quoteFresh: boolean;
  entryPrice: number;
  currentPrice: number;
  highestPrice: number;
  tpArmed: boolean;
  trailingThreshold: number | null;
  stopLossPrice: number | null;
  confirmationCount: number;
}

export interface EvaluationResult {
  evaluation: Evaluation;
  /** State to persist when the trade remains open. */
  nextState: PositionState;
}

export interface EvaluationContext {
  /** Current time, epoch milliseconds (injected for determinism/testing). */
  now: number;
  /** Maximum acceptable quote age in milliseconds. */
  maxQuoteAgeMs: number;
  /** Optional fixed decision id (tests). Defaults to a random uuid. */
  decisionId?: string;
  /** Strategy config version to stamp onto the evaluation. */
  strategyVersion?: number;
}
