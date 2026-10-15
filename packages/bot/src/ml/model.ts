/**
 * Learned exit model — TypeScript inference.
 *
 * The Python learning service trains a model and emits a small JSON blob of
 * coefficients. This module loads that blob and runs it *in TypeScript* at
 * trade time, so the live path never depends on Python. The model predicts the
 * probability that closing now is the right call; `learnedPolicy` closes when
 * that probability clears the model's threshold.
 *
 * The feature vector is built by the same `computeDecisionFeatures` used to
 * generate the training data, so training and serving cannot drift.
 */

import type { Candle } from "../market/klines.ts";
import { computeDecisionFeatures, readFeature } from "../backtest/features.ts";
import type {
  DecisionFeatures,
  ExitDecision,
  ExitPolicy,
  PositionSnapshot,
} from "../backtest/types.ts";

export interface LearnedModel {
  type: "logistic";
  /** Feature names in coefficient order. */
  features: string[];
  /** Per-feature training means (standardisation). */
  means: number[];
  /** Per-feature training std-devs (standardisation). */
  stds: number[];
  coefficients: number[];
  intercept: number;
  /** Decision boundary on the predicted probability. */
  threshold: number;
  /** Optional training metrics carried along for display. */
  metrics?: Record<string, number>;
}

const KNOWN_FEATURES = new Set([
  "returnPct",
  "peakReturnPct",
  "drawdownFromPeak",
  "barsHeld",
  "momentum",
  "volatility",
]);

/** Validates and normalises a model blob, throwing loudly on anything wrong. */
export function parseModel(raw: unknown): LearnedModel {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("model must be an object");
  }
  const m = raw as Record<string, unknown>;
  if (m.type !== "logistic") {
    throw new Error(`unsupported model type: ${String(m.type)}`);
  }
  const features = asStringArray(m.features, "features");
  for (const f of features) {
    if (!KNOWN_FEATURES.has(f)) throw new Error(`unknown feature: ${f}`);
  }
  const n = features.length;
  const means = asNumberArray(m.means, "means", n);
  const stds = asNumberArray(m.stds, "stds", n);
  const coefficients = asNumberArray(m.coefficients, "coefficients", n);
  const intercept = asNumber(m.intercept, "intercept");
  const threshold = asNumber(m.threshold, "threshold");
  if (!(threshold > 0 && threshold < 1)) {
    throw new Error(`threshold must be in (0,1), got ${threshold}`);
  }
  const model: LearnedModel = {
    type: "logistic",
    features,
    means,
    stds,
    coefficients,
    intercept,
    threshold,
  };
  if (m.metrics && typeof m.metrics === "object") {
    model.metrics = m.metrics as Record<string, number>;
  }
  return model;
}

/** Probability that closing now is the correct action, in [0,1]. */
export function predictCloseProbability(
  model: LearnedModel,
  f: DecisionFeatures,
): number {
  let z = model.intercept;
  for (let i = 0; i < model.features.length; i += 1) {
    const raw = readFeature(f, model.features[i]!);
    const std = model.stds[i]! || 1;
    z += model.coefficients[i]! * ((raw - model.means[i]!) / std);
  }
  return stableSigmoid(z);
}

/**
 * Adapts a learned model to the backtest/live `ExitPolicy` contract. It does
 * not carry FLEXI state; the model reads position features from the replay
 * context instead.
 */
export function learnedPolicy(model: LearnedModel): ExitPolicy {
  return (state: PositionSnapshot, _candle: Candle, ctx): ExitDecision => {
    const f = computeDecisionFeatures(ctx.candles, ctx.entryIndex, ctx.index);
    if (!f) {
      return { action: "HOLD", reason: "no features", next: state };
    }
    const p = predictCloseProbability(model, f);
    if (p >= model.threshold) {
      return { action: "CLOSE", reason: `learned_close p=${p.toFixed(4)}`, next: state };
    }
    return { action: "HOLD", reason: `learned_hold p=${p.toFixed(4)}`, next: state };
  };
}

function stableSigmoid(z: number): number {
  if (z >= 30) return 1;
  if (z <= -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function asNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function asNumberArray(value: unknown, name: string, len: number): number[] {
  if (!Array.isArray(value) || value.length !== len) {
    throw new Error(`${name} must be an array of length ${len}`);
  }
  return value.map((v, i) => asNumber(v, `${name}[${i}]`));
}

function asStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty array`);
  }
  return value.map((v, i) => {
    if (typeof v !== "string") throw new Error(`${name}[${i}] must be a string`);
    return v;
  });
}
