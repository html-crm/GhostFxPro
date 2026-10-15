export type {
  Quote,
  PositionState,
  FlexiConfig,
  DecisionAction,
  TriggeringRule,
  Evaluation,
  EvaluationResult,
  EvaluationContext,
} from "./strategy/types.ts";

export { evaluateFlexi } from "./strategy/flexi.ts";
export {
  getStrategy,
  normalizeConfig,
  FLEXI_DEFAULT_CONFIG,
  type Strategy,
  type StrategyKind,
} from "./strategy/registry.ts";

export {
  checkQuoteFreshness,
  checkSlippage,
  checkMinNotional,
  isReplay,
  type FreshnessResult,
  type SlippageInput,
  type SlippageResult,
} from "./risk/risk.ts";

export type {
  TokenRef,
  MarketDataProvider,
  FetchLike,
} from "./market/types.ts";
export {
  DexScreenerProvider,
  selectPair,
  searchPairs,
  type DexScreenerOptions,
  type PairSummary,
} from "./market/dexscreener.ts";
export { MockProvider } from "./market/mock.ts";

export {
  evaluateAlert,
  isPriceAlert,
  type AlertKind,
  type AlertRule,
  type AlertObservation,
  type AlertOutcome,
} from "./alerts/alerts.ts";
