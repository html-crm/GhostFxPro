import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFlexi } from "../src/strategy/flexi.ts";
import { FLEXI_DEFAULT_CONFIG } from "../src/strategy/registry.ts";
import type {
  EvaluationResult,
  FlexiConfig,
  PositionState,
  Quote,
} from "../src/strategy/types.ts";

const CONFIG: FlexiConfig = FLEXI_DEFAULT_CONFIG;

function fresh(entryPrice: number): PositionState {
  return {
    tradeId: "trade-1",
    entryPrice,
    peakPrice: entryPrice,
    tpArmed: false,
    trailingConfirmations: 0,
  };
}

function quote(price: number, ts = 900): Quote {
  return { price, ts, source: "test" };
}

function ctx(now = 1000) {
  return { now, maxQuoteAgeMs: 500, decisionId: "decision-1", strategyVersion: 1 };
}

/** Feeds a price path, threading state, and returns the final result. */
function run(
  start: PositionState,
  prices: number[],
  config: FlexiConfig = CONFIG,
): { result: EvaluationResult; states: PositionState[]; results: EvaluationResult[] } {
  let state = start;
  const states: PositionState[] = [];
  const results: EvaluationResult[] = [];
  let last: EvaluationResult | null = null;
  for (const p of prices) {
    last = evaluateFlexi(state, quote(p), config, ctx());
    state = last.nextState;
    states.push(state);
    results.push(last);
  }
  return { result: last!, states, results };
}

test("does not arm below the +7% threshold", () => {
  const { result } = run(fresh(10), [10.5]);
  assert.equal(result.evaluation.action, "HOLD");
  assert.equal(result.evaluation.tpArmed, false);
  assert.equal(result.evaluation.triggeringRule, null);
});

test("arms trailing at exactly +7% and does NOT sell", () => {
  const { result } = run(fresh(10), [10.7]);
  assert.equal(result.evaluation.action, "HOLD");
  assert.equal(result.evaluation.tpArmed, true);
  assert.equal(result.evaluation.triggeringRule, "take_profit_arm");
});

test("tracks the highest observed price", () => {
  const { states } = run(fresh(10), [12, 15, 13]);
  assert.equal(states[0]!.peakPrice, 12);
  assert.equal(states[1]!.peakPrice, 15);
  assert.equal(states[2]!.peakPrice, 15);
});

test("trailing exit requires two consecutive confirmations", () => {
  const armed: PositionState = {
    ...fresh(10),
    peakPrice: 18,
    tpArmed: true,
    trailingConfirmations: 0,
  };
  // threshold = 18 * 0.98 = 17.64
  const first = evaluateFlexi(armed, quote(17.5), CONFIG, ctx());
  assert.equal(first.evaluation.action, "WAIT_OBSERVE");
  assert.equal(first.evaluation.confirmationCount, 1);

  const second = evaluateFlexi(first.nextState, quote(17.5), CONFIG, ctx());
  assert.equal(second.evaluation.action, "SELL");
  assert.equal(second.evaluation.triggeringRule, "trailing_exit");
  assert.equal(second.evaluation.confirmationCount, 2);
});

test("documented example: entry $10, peak $18, exit near 2% pullback", () => {
  const { results } = run(fresh(10), [12, 18, 17.5, 17.5]);
  assert.equal(results[0]!.evaluation.triggeringRule, "take_profit_arm");
  assert.equal(results[2]!.evaluation.action, "WAIT_OBSERVE");
  assert.equal(results[3]!.evaluation.action, "SELL");
  // 18 * 0.98 = 17.64, and 17.5 is below it.
  assert.equal(results[3]!.evaluation.trailingThreshold, 18 * 0.98);
});

test("recovery above the threshold resets the confirmation streak", () => {
  const armed: PositionState = {
    ...fresh(10),
    peakPrice: 18,
    tpArmed: true,
    trailingConfirmations: 0,
  };
  const dip = evaluateFlexi(armed, quote(17.5), CONFIG, ctx());
  assert.equal(dip.evaluation.confirmationCount, 1);

  const recover = evaluateFlexi(dip.nextState, quote(17.9), CONFIG, ctx());
  assert.equal(recover.evaluation.action, "HOLD");
  assert.equal(recover.nextState.trailingConfirmations, 0);

  const dipAgain = evaluateFlexi(recover.nextState, quote(17.5), CONFIG, ctx());
  assert.equal(dipAgain.evaluation.action, "WAIT_OBSERVE");
  assert.equal(dipAgain.evaluation.confirmationCount, 1);
});

test("stop-loss takes priority when configured", () => {
  const config: FlexiConfig = { ...CONFIG, stopLossPct: 0.1 };
  const { result } = run(fresh(10), [8.9], config);
  assert.equal(result.evaluation.action, "SELL");
  assert.equal(result.evaluation.triggeringRule, "stop_loss");
  assert.equal(result.evaluation.stopLossPrice, 9);
});

test("stop-loss is inactive when not configured", () => {
  const { result } = run(fresh(10), [5]);
  assert.equal(result.evaluation.action, "HOLD");
  assert.equal(result.evaluation.stopLossPrice, null);
});

test("stale quotes are rejected without mutating state", () => {
  const state = fresh(10);
  const stale: Quote = { price: 100, ts: 400, source: "test" }; // age 600 > 500
  const { result } = (() => {
    const r = evaluateFlexi(state, stale, CONFIG, ctx());
    return { result: r };
  })();
  assert.equal(result.evaluation.action, "REJECT");
  assert.equal(result.evaluation.rejectionReason, "stale_quote");
  assert.equal(result.evaluation.quoteFresh, false);
  assert.deepEqual(result.nextState, state);
});

test("carries immutable identity and stamp of the strategy version", () => {
  const { result } = run(fresh(10), [10.1]);
  assert.equal(result.evaluation.tradeId, "trade-1");
  assert.equal(result.evaluation.strategyVersion, 1);
  assert.equal(result.evaluation.decisionId, "decision-1");
});

test("is pure: same inputs produce identical evaluations", () => {
  const state = fresh(10);
  const a = evaluateFlexi(state, quote(12), CONFIG, ctx());
  const b = evaluateFlexi(fresh(10), quote(12), CONFIG, ctx());
  assert.deepEqual(a, b);
});
