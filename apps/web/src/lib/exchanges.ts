import { apiFetch } from "./api";
import { getToken } from "./session";

export type ExchangeKind = "BROKER" | "CEX" | "DEX";

export type ExchangeStatus = "not_implemented" | "blocked" | "paper_only";

export interface StablecoinAsset {
  symbol: string;
  name: string;
  note: string;
}

export interface ExchangeProvider {
  providerId: string;
  displayName: string;
  kind: ExchangeKind;
  status: ExchangeStatus;
  summary: string;
  reasons: string[];
  requirements: string[];
  limitations: string[];
  markets: string[];
}

export interface ExchangeStatusSummary {
  canSubmitLiveOrders: false;
  reason: string;
  providers: ExchangeProvider[];
  stablecoins: StablecoinAsset[];
  limitations: string[];
}

export async function fetchExchangeStatus(): Promise<ExchangeStatusSummary | null> {
  const token = await getToken();
  if (!token) return null;
  const res = await apiFetch<{ status: ExchangeStatusSummary }>("/exchange/status", {
    token,
  });
  return res.ok && res.data ? res.data.status : null;
}

export function statusLabel(status: ExchangeStatus): string {
  return status.replace(/_/g, " ");
}
