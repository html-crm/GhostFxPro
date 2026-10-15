import { apiFetch } from "./api";
import { getToken } from "./session";

export interface FlexiConfig {
  takeProfitArmPct: number;
  trailingPercent: number;
  trailingConfirmations: number;
  stopLossPct: number | null;
}

export interface StrategyRule {
  id: string;
  label: string;
  priority: number;
  description: string;
}

export interface ConfigChange {
  key: string;
  label: string;
  before: number | null;
  after: number | null;
  changed: boolean;
  impact: string;
}

export interface ConfigComparison {
  kind: string;
  changes: ConfigChange[];
  hasChanges: boolean;
  precedence: StrategyRule[];
}

export interface StrategyVersion {
  strategyVersionId: string;
  strategyId: string;
  version: number;
  config: FlexiConfig;
  configHash: string;
  isActive: boolean;
  note: string | null;
  tradeCount: number;
  createdAt: string;
  activatedAt: string | null;
}

export interface Strategy {
  strategyId: string;
  name: string;
  kind: string;
  activeVersionId: string | null;
  rules: StrategyRule[];
  versions: StrategyVersion[];
}

export interface CompareResult {
  comparison: ConfigComparison;
  from: { strategyVersionId: string; version: number };
  to: { strategyVersionId: string; version: number };
}

export async function fetchStrategies(): Promise<Strategy[]> {
  const token = await getToken();
  if (!token) return [];
  const res = await apiFetch<{ strategies: Strategy[] }>("/strategies", { token });
  return res.ok && res.data ? res.data.strategies : [];
}

export async function fetchComparison(
  versionId: string,
): Promise<CompareResult | null> {
  const token = await getToken();
  if (!token) return null;
  const res = await apiFetch<CompareResult>(
    `/strategies/versions/${versionId}/compare`,
    { token },
  );
  return res.ok && res.data ? res.data : null;
}
