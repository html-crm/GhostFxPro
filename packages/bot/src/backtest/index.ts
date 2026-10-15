export type {
  PositionSnapshot,
  ExitAction,
  ExitDecision,
  ExitPolicy,
  PolicyContext,
  BacktestOptions,
  BacktestTrade,
  DecisionLabel,
  DecisionFeatures,
} from "./types.ts";
export { runBacktest, runBacktestSeries, type BacktestSeriesOptions } from "./engine.ts";
export { flexiPolicy, type FlexiPolicyOptions } from "./flexi-policy.ts";
export { summarize, type BacktestMetrics } from "./metrics.ts";
export {
  FEATURE_NAMES,
  computeDecisionFeatures,
  readFeature,
  type FeatureName,
  type FeatureOptions,
} from "./features.ts";
export {
  buildDecisionDataset,
  datasetToJsonl,
  type DatasetRow,
  type DatasetOptions,
} from "./dataset.ts";
