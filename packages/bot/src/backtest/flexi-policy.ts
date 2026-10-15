/**
 * Bridges the production FLEXI strategy into the generic backtest engine.
 *
 * FLEXI is already a pure function (`evaluateFlexi`); this adapter feeds it one
 * candle at a time and maps its decision onto the engine's HOLD/CLOSE contract.
 * Only an explicit SELL closes a position — a stale-quote REJECT never does,
 * and in a backtest quotes are always fresh anyway.
 */

import { evaluateFlexi } from "../strategy/flexi.ts";
import type { PositionState, Quote, FlexiConfig } from "../strategy/types.ts";
import type { Candle } from "../market/klines.ts";
import type { ExitDecision, ExitPolicy, PositionSnapshot } from "./types.ts";

const TRADE_ID = "backtest";

export interface FlexiPolicyOptions {
  /** Quote freshness window; irrelevant for replay (default 60s). */
  maxQuoteAgeMs?: number;
  /** Stamped onto evaluations (default 1). */
  strategyVersion?: number;
}

export function flexiPolicy(
  config: FlexiConfig,
  opts: FlexiPolicyOptions = {},
): ExitPolicy {
  const maxQuoteAgeMs = opts.maxQuoteAgeMs ?? 60_000;
  const strategyVersion = opts.strategyVersion ?? 1;

  return (state: PositionSnapshot, candle: Candle): ExitDecision => {
    const ps: PositionState = {
      tradeId: TRADE_ID,
      entryPrice: state.entryPrice,
      peakPrice: state.peakPrice,
      tpArmed: state.tpArmed,
      trailingConfirmations: state.trailingConfirmations,
    };
    const quote: Quote = {
      price: candle.close,
      ts: candle.closeTime,
      source: "backtest",
    };
    const result = evaluateFlexi(ps, quote, config, {
      now: candle.closeTime,
      maxQuoteAgeMs,
      strategyVersion,
      decisionId: "backtest",
    });

    const next: PositionSnapshot = {
      entryPrice: result.nextState.entryPrice,
      peakPrice: result.nextState.peakPrice,
      tpArmed: result.nextState.tpArmed,
      trailingConfirmations: result.nextState.trailingConfirmations,
    };

    if (result.evaluation.action === "SELL") {
      return {
        action: "CLOSE",
        reason: result.evaluation.triggeringRule ?? "flexi_close",
        next,
      };
    }
    return { action: "HOLD", reason: result.evaluation.reason, next };
  };
}
