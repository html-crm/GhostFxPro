import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModel, predictCloseProbability, learnedPolicy } from "../src/ml/model.ts";
import type { LearnedModel } from "../src/ml/model.ts";
import { runBacktest } from "../src/backtest/engine.ts";
import type { DecisionFeatures } from "../src/backtest/types.ts";
import type { Candle } from "../src/market/klines.ts";

function feats(over: Partial<DecisionFeatures> = {}): DecisionFeatures {
  return {
    returnPct: 0,
    peakReturnPct: 0,
    drawdownFromPeak: 0,
    barsHeld: 1,
    momentum: 0,
    volatility: 0,
    peakAge: 0,
    momentumLong: 0,
    volatilityRatio: 1,
    smaDeviation: 0,
    rsi: 50,
    ...over,
  };
}

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    openTime: i * 1000,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
    closeTime: i * 1000 + 999,
  }));
}

function model(features: string[], coefficients: number[], threshold: number): LearnedModel {
  return parseModel({
    type: "logistic",
    features,
    means: features.map(() => 0),
    stds: features.map(() => 1),
    coefficients,
    intercept: 0,
    threshold,
  });
}

test("parseModel accepts a valid blob and carries optional metrics", () => {
  const m = parseModel({
    type: "logistic",
    features: ["returnPct"],
    means: [0],
    stds: [1],
    coefficients: [1],
    intercept: 0,
    threshold: 0.5,
    metrics: { accuracy: 0.9 },
  });
  assert.equal(m.features.length, 1);
  assert.equal(m.threshold, 0.5);
  assert.equal(m.metrics?.accuracy, 0.9);
});

test("parseModel rejects invalid blobs", () => {
  assert.throws(() => parseModel(null));
  assert.throws(() => parseModel({ type: "tree" }));
  assert.throws(() => parseModel({ type: "logistic", features: ["nope"], means: [0], stds: [1], coefficients: [1], intercept: 0, threshold: 0.5 }));
  assert.throws(() => parseModel({ type: "logistic", features: ["returnPct"], means: [], stds: [1], coefficients: [1], intercept: 0, threshold: 0.5 }));
  assert.throws(() => parseModel({ type: "logistic", features: ["returnPct"], means: [0], stds: [1], coefficients: [1], intercept: 0, threshold: 5 }));
});

test("predictCloseProbability standardises then applies the sigmoid", () => {
  const m = model(["returnPct"], [1], 0.5);
  const atZero = predictCloseProbability(m, feats());
  assert.ok(Math.abs(atZero - 0.5) < 1e-9);
  const up = predictCloseProbability(m, feats({ returnPct: 2, peakReturnPct: 2 }));
  assert.ok(Math.abs(up - 0.880797) < 1e-4);

  // Standardisation: mean 1, std 2 => raw 3 maps to z=1.
  const std = parseModel({
    type: "logistic", features: ["returnPct"], means: [1], stds: [2],
    coefficients: [1], intercept: 0, threshold: 0.5,
  });
  const z = predictCloseProbability(std, feats({ returnPct: 3 }));
  assert.ok(Math.abs(z - 0.731059) < 1e-4);
});

test("learnedPolicy closes once the drawdown-driven probability clears the threshold", () => {
  const m = model(["drawdownFromPeak"], [200], 0.99);
  const candles = candlesFromCloses([100, 110, 105]);
  const trade = runBacktest(candles, { policy: learnedPolicy(m), entryIndex: 0 });
  assert.ok(trade);
  assert.equal(trade.exitIndex, 2); // closes on the pullback, not the peak
  assert.ok(trade.exitReason.startsWith("learned_close"));
});

test("learnedPolicy holds through a steady rise when close is never favoured", () => {
  const m = model(["returnPct"], [-50], 0.5);
  const candles = candlesFromCloses([100, 101, 102, 103]);
  const trade = runBacktest(candles, { policy: learnedPolicy(m), entryIndex: 0 });
  assert.ok(trade);
  assert.equal(trade.exitReason, "horizon_end");
});
