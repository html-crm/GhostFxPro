import { evaluateFlexi } from "./flexi.ts";
import type {
  EvaluationContext,
  EvaluationResult,
  FlexiConfig,
  PositionState,
  Quote,
} from "./types.ts";

export type StrategyKind = "FLEXI";

/** A pluggable strategy: config + a pure evaluator. */
export interface Strategy {
  kind: StrategyKind;
  version: number;
  defaultConfig: FlexiConfig;
  evaluate(
    state: PositionState,
    quote: Quote,
    config: FlexiConfig,
    ctx: EvaluationContext,
  ): EvaluationResult;
}

/**
 * The validated FLEXI configuration. This is the single source of truth for
 * the documented thresholds; strategy_versions rows are seeded from it so the
 * DB config and the code cannot silently drift.
 */
export const FLEXI_DEFAULT_CONFIG: FlexiConfig = {
  takeProfitArmPct: 0.07,
  trailingPercent: 0.02,
  trailingConfirmations: 2,
  // A stop-loss must be explicitly configured; the FLEXI port does not invent
  // an emergency rule. Set a fraction to enable it.
  stopLossPct: null,
};

const FLEXI: Strategy = {
  kind: "FLEXI",
  version: 1,
  defaultConfig: FLEXI_DEFAULT_CONFIG,
  evaluate: evaluateFlexi,
};

const REGISTRY: Record<StrategyKind, Strategy> = { FLEXI };

export function getStrategy(kind: StrategyKind): Strategy {
  const strategy = REGISTRY[kind];
  if (!strategy) throw new Error(`unknown strategy kind: ${kind}`);
  return strategy;
}

/**
 * Validates and normalizes a config. Unknown/invalid values are rejected
 * rather than defaulted, so a bad persisted config fails loudly.
 */
export function normalizeConfig(input: Partial<FlexiConfig>): FlexiConfig {
  const cfg: FlexiConfig = { ...FLEXI_DEFAULT_CONFIG, ...input };
  assertPct("takeProfitArmPct", cfg.takeProfitArmPct);
  assertPct("trailingPercent", cfg.trailingPercent);
  if (!Number.isInteger(cfg.trailingConfirmations) || cfg.trailingConfirmations < 1) {
    throw new Error("trailingConfirmations must be a positive integer");
  }
  if (cfg.stopLossPct !== null) assertPct("stopLossPct", cfg.stopLossPct);
  return cfg;
}

function assertPct(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${name} must be a fraction in (0, 1), got ${value}`);
  }
}
