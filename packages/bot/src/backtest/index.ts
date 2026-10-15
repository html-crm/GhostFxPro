export type {
  PositionSnapshot,
  ExitAction,
  ExitDecision,
  ExitPolicy,
  BacktestOptions,
  BacktestTrade,
} from "./types.ts";
export { runBacktest, runBacktestSeries, type BacktestSeriesOptions } from "./engine.ts";
export { flexiPolicy, type FlexiPolicyOptions } from "./flexi-policy.ts";
export { summarize, type BacktestMetrics } from "./metrics.ts";
export {
  buildDecisionDataset,
  type DecisionLabel,
  type DecisionFeatures,
  type DatasetRow,
  type DatasetOptions,
} from "./dataset.ts";
