import { randomUUID } from "node:crypto";
import type {
  Evaluation,
  EvaluationContext,
  EvaluationResult,
  FlexiConfig,
  PositionState,
  Quote,
  TriggeringRule,
} from "./types.ts";

/**
 * Relative tolerance for float comparisons of threshold boundaries. Decisions
 * are coarse (a 2% band); this only removes representation noise, it does not
 * change semantics.
 */
const EPS = 1e-9;

function gte(a: number, b: number): boolean {
  return a >= b - Math.abs(b) * EPS - EPS;
}

function lte(a: number, b: number): boolean {
  return a <= b + Math.abs(b) * EPS + EPS;
}

/**
 * FLEXI exit engine.
 *
 * Documented semantics (regression-sensitive — see test/flexi.test.ts):
 *   1. A +7% take-profit threshold ARM trailing; it never sells by itself.
 *   2. The highest observed price since entry is tracked on every evaluation.
 *   3. Trailing exit requires the price to sit 2% below the peak for TWO
 *      consecutive polls; a poll above the threshold resets the counter.
 *   4. A stop-loss (when configured) is always active and takes priority.
 *   5. A stale quote is rejected and never mutates state or triggers a trade.
 *
 * Pure: given the same inputs it returns the same decision. Identity (trade_id)
 * is only carried, never derived.
 */
export function evaluateFlexi(
  state: PositionState,
  quote: Quote,
  config: FlexiConfig,
  ctx: EvaluationContext,
): EvaluationResult {
  const strategyVersion = ctx.strategyVersion ?? 0;
  const decisionId = ctx.decisionId ?? randomUUID();
  const ageMs = Math.max(0, ctx.now - quote.ts);
  const quoteFresh = ageMs <= ctx.maxQuoteAgeMs;

  const stopLossPrice =
    config.stopLossPct === null
      ? null
      : state.entryPrice * (1 - config.stopLossPct);

  // ---- Stale quote: reject, do not mutate state. -------------------------
  if (!quoteFresh) {
    return {
      evaluation: build({
        decisionId,
        state,
        quote,
        strategyVersion,
        action: "REJECT",
        reason: `stale quote: age ${ageMs}ms exceeds ${ctx.maxQuoteAgeMs}ms`,
        triggeringRule: null,
        rejectionReason: "stale_quote",
        quoteFresh: false,
        currentPrice: quote.price,
        highestPrice: state.peakPrice,
        tpArmed: state.tpArmed,
        trailingThreshold: thresholdOf(state, config),
        stopLossPrice,
        confirmationCount: state.trailingConfirmations,
      }),
      nextState: state,
    };
  }

  const price = quote.price;
  const next: PositionState = { ...state };
  next.peakPrice = Math.max(state.peakPrice, price);
  const peak = next.peakPrice;

  // ---- Hard stop-loss (priority). ----------------------------------------
  if (stopLossPrice !== null && lte(price, stopLossPrice)) {
    return decide(next, {
      decisionId,
      strategyVersion,
      action: "SELL",
      reason: `stop-loss: price ${price} <= ${stopLossPrice}`,
      triggeringRule: "stop_loss",
      quote,
      config,
      ctx,
      stopLossPrice,
    });
  }

  // ---- Arm trailing at the take-profit threshold. ------------------------
  if (!next.tpArmed && gte(price, state.entryPrice * (1 + config.takeProfitArmPct))) {
    next.tpArmed = true;
    // Arming never sells; confirmation resets because price sits at the peak.
    next.trailingConfirmations = 0;
    return decide(next, {
      decisionId,
      strategyVersion,
      action: "HOLD",
      reason: `take-profit threshold reached at ${price}; trailing armed`,
      triggeringRule: "take_profit_arm",
      quote,
      config,
      ctx,
      stopLossPrice,
    });
  }

  // ---- Trailing exit (only once armed). ----------------------------------
  if (next.tpArmed) {
    const threshold = peak * (1 - config.trailingPercent);
    if (lte(price, threshold)) {
      next.trailingConfirmations = state.trailingConfirmations + 1;
      const required = Math.max(1, config.trailingConfirmations);
      if (next.trailingConfirmations >= required) {
        return decide(next, {
          decisionId,
          strategyVersion,
          action: "SELL",
          reason: `trailing exit: ${price} <= ${threshold} (peak ${peak}) confirmed ${next.trailingConfirmations}x`,
          triggeringRule: "trailing_exit",
          quote,
          config,
          ctx,
          stopLossPrice,
        });
      }
      return decide(next, {
        decisionId,
        strategyVersion,
        action: "WAIT_OBSERVE",
        reason: `trailing confirm ${next.trailingConfirmations}/${required} at ${price}`,
        triggeringRule: null,
        quote,
        config,
        ctx,
        stopLossPrice,
      });
    }
    // Recovered above the trailing threshold: reset the confirmation streak.
    next.trailingConfirmations = 0;
  }

  return decide(next, {
    decisionId,
    strategyVersion,
    action: "HOLD",
    reason: next.tpArmed
      ? `holding; armed, peak ${peak}`
      : `holding; not yet armed (entry ${state.entryPrice})`,
    triggeringRule: null,
    quote,
    config,
    ctx,
    stopLossPrice,
  });
}

function thresholdOf(state: PositionState, config: FlexiConfig): number | null {
  return state.tpArmed
    ? state.peakPrice * (1 - config.trailingPercent)
    : null;
}

interface DecideInput {
  decisionId: string;
  strategyVersion: number;
  action: Evaluation["action"];
  reason: string;
  triggeringRule: TriggeringRule;
  quote: Quote;
  config: FlexiConfig;
  ctx: EvaluationContext;
  stopLossPrice: number | null;
}

function decide(next: PositionState, input: DecideInput): EvaluationResult {
  return {
    evaluation: build({
      decisionId: input.decisionId,
      state: next,
      quote: input.quote,
      strategyVersion: input.strategyVersion,
      action: input.action,
      reason: input.reason,
      triggeringRule: input.triggeringRule,
      rejectionReason: null,
      quoteFresh: true,
      currentPrice: input.quote.price,
      highestPrice: next.peakPrice,
      tpArmed: next.tpArmed,
      trailingThreshold: thresholdOf(next, input.config),
      stopLossPrice: input.stopLossPrice,
      confirmationCount: next.trailingConfirmations,
    }),
    nextState: next,
  };
}

interface BuildInput {
  decisionId: string;
  state: PositionState;
  quote: Quote;
  strategyVersion: number;
  action: Evaluation["action"];
  reason: string;
  triggeringRule: TriggeringRule;
  rejectionReason: string | null;
  quoteFresh: boolean;
  currentPrice: number;
  highestPrice: number;
  tpArmed: boolean;
  trailingThreshold: number | null;
  stopLossPrice: number | null;
  confirmationCount: number;
}

function build(i: BuildInput): Evaluation {
  return {
    decisionId: i.decisionId,
    tradeId: i.state.tradeId,
    strategyVersion: i.strategyVersion,
    action: i.action,
    reason: i.reason,
    triggeringRule: i.triggeringRule,
    rejectionReason: i.rejectionReason,
    marketDataTs: i.quote.ts,
    quoteFresh: i.quoteFresh,
    entryPrice: i.state.entryPrice,
    currentPrice: i.currentPrice,
    highestPrice: i.highestPrice,
    tpArmed: i.tpArmed,
    trailingThreshold: i.trailingThreshold,
    stopLossPrice: i.stopLossPrice,
    confirmationCount: i.confirmationCount,
  };
}
