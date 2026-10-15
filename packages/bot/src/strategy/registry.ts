import { evaluateFlexi } from "./flexi.ts";
import type {
  EvaluationContext,
  EvaluationResult,
  FlexiConfig,
  PositionState,
  Quote,
  TriggeringRule,
} from "./types.ts";

export type StrategyKind = "FLEXI";

/** A rule the engine can fire, with an explicit, documented precedence. */
export interface StrategyRule {
  id: NonNullable<TriggeringRule>;
  /** Human-readable name. */
  label: string;
  /** Lower runs first when several rules could fire on one observation. */
  priority: number;
  /** What the rule does, including what it deliberately does NOT do. */
  description: string;
}

/** A pluggable strategy: config + a pure evaluator + explicit rule precedence. */
export interface Strategy {
  kind: StrategyKind;
  version: number;
  defaultConfig: FlexiConfig;
  /** Rules in priority order. Precedence is explicit, never implicit. */
  rules: readonly StrategyRule[];
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

/**
 * FLEXI rule precedence, highest priority first. This is the explicit answer
 * to "what wins when several rules could fire on the same tick":
 *   1. A configured stop-loss always takes priority (protects downside).
 *   2. Arming the take-profit never sells on its own.
 *   3. The trailing exit is only reachable once armed.
 * The engine evaluates them in this order and returns on the first match.
 */
export const FLEXI_RULES: readonly StrategyRule[] = [
  {
    id: "stop_loss",
    label: "Hard stop-loss",
    priority: 1,
    description:
      "When a stop-loss fraction is configured, sells immediately if price reaches the stop level. Disabled (null) by default.",
  },
  {
    id: "take_profit_arm",
    label: "Arm take-profit",
    priority: 2,
    description:
      "Arms the trailing exit once price reaches the take-profit threshold. Arming never sells on its own.",
  },
  {
    id: "trailing_exit",
    label: "Trailing exit",
    priority: 3,
    description:
      "Once armed, sells after price sits the trailing distance below the peak for the configured number of consecutive polls.",
  },
];

const FLEXI: Strategy = {
  kind: "FLEXI",
  version: 1,
  defaultConfig: FLEXI_DEFAULT_CONFIG,
  rules: FLEXI_RULES,
  evaluate: evaluateFlexi,
};

const REGISTRY: Record<StrategyKind, Strategy> = { FLEXI };

export function getStrategy(kind: StrategyKind): Strategy {
  const strategy = REGISTRY[kind];
  if (!strategy) throw new Error(`unknown strategy kind: ${kind}`);
  return strategy;
}

/**
 * Validates and normalizes a config. Only the known fields are kept, so a
 * persisted config can never accumulate stray keys (which would change the
 * config_hash for no reason). Missing fields fall back to the documented
 * defaults; present-but-invalid fields are rejected rather than defaulted, so
 * a bad config fails loudly.
 */
export function normalizeConfig(
  input: Partial<Record<keyof FlexiConfig, unknown>>,
): FlexiConfig {
  const src = input ?? {};
  const cfg: FlexiConfig = {
    takeProfitArmPct: num(src.takeProfitArmPct, FLEXI_DEFAULT_CONFIG.takeProfitArmPct),
    trailingPercent: num(src.trailingPercent, FLEXI_DEFAULT_CONFIG.trailingPercent),
    trailingConfirmations: num(
      src.trailingConfirmations,
      FLEXI_DEFAULT_CONFIG.trailingConfirmations,
    ),
    stopLossPct:
      src.stopLossPct === undefined
        ? FLEXI_DEFAULT_CONFIG.stopLossPct
        : src.stopLossPct === null
          ? null
          : num(src.stopLossPct, Number.NaN),
  };
  assertPct("takeProfitArmPct", cfg.takeProfitArmPct);
  assertPct("trailingPercent", cfg.trailingPercent);
  if (!Number.isInteger(cfg.trailingConfirmations) || cfg.trailingConfirmations < 1) {
    throw new Error("trailingConfirmations must be a positive integer");
  }
  if (cfg.stopLossPct !== null) assertPct("stopLossPct", cfg.stopLossPct);
  return cfg;
}

function num(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number") return value;
  return Number(value);
}

function assertPct(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${name} must be a fraction in (0, 1), got ${value}`);
  }
}
