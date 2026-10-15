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
  FLEXI_RULES,
  type Strategy,
  type StrategyKind,
  type StrategyRule,
} from "./strategy/registry.ts";
export {
  compareFlexiConfig,
  type ConfigChange,
  type ConfigComparison,
  type FlexiConfigKey,
} from "./strategy/compare.ts";

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
export {
  getTokenProfile,
  detectTokenChain,
  type TokenProfile,
  type TokenProfileOptions,
  type TokenChain,
} from "./market/token-profile.ts";
export {
  fetchKlines,
  fetchKlinesSeries,
  parseKlines,
  type Candle,
  type KlineInterval,
  type KlinesOptions,
  type KlinesSeriesOptions,
} from "./market/klines.ts";
export { MockProvider } from "./market/mock.ts";

export {
  runBacktest,
  runBacktestSeries,
  flexiPolicy,
  summarize,
  buildDecisionDataset,
  datasetToJsonl,
  FEATURE_NAMES,
  computeDecisionFeatures,
  readFeature,
  type PositionSnapshot,
  type ExitAction,
  type ExitDecision,
  type ExitPolicy,
  type PolicyContext,
  type BacktestOptions,
  type BacktestTrade,
  type BacktestSeriesOptions,
  type FlexiPolicyOptions,
  type BacktestMetrics,
  type DecisionLabel,
  type DecisionFeatures,
  type DatasetRow,
  type DatasetOptions,
  type FeatureName,
  type FeatureOptions,
} from "./backtest/index.ts";

export {
  parseModel,
  predictCloseProbability,
  learnedPolicy,
  type LearnedModel,
} from "./ml/model.ts";

export {
  evaluateAlert,
  isPriceAlert,
  type AlertKind,
  type AlertRule,
  type AlertObservation,
  type AlertOutcome,
} from "./alerts/alerts.ts";

export {
  PublicRpcWalletProvider,
  validateWalletAddress,
  isSupportedWalletChain,
  isEvmAddress,
  isSolanaAddress,
  formatUnits,
  hexToBigInt,
  SUPPORTED_WALLET_CHAINS,
  NATIVE_ASSETS,
  type WalletChain,
  type WalletBalances,
  type WalletBalanceProvider,
  type NativeBalance,
  type TokenBalance,
  type TokenRefMeta,
  type PublicRpcWalletOptions,
  type RpcFetchLike,
} from "./wallet/balances.ts";
