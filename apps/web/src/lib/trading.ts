import { apiFetch } from "./api";
import { getToken } from "./session";

export interface PortfolioSummary {
  initialBalance: string;
  cashBalance: string;
  openPositionsValue: string;
  unrealizedPnl: string;
  realizedPnl: string;
  equity: string;
  openCount: number;
  closedCount: number;
}

export interface Position {
  tradeId: string;
  status: string;
  tokenId: string;
  symbol: string;
  contractAddress: string;
  chain: string;
  openQty: string;
  avgEntryPrice: string | null;
  totalBuyCost: string;
  highestPrice: string | null;
  lastPrice: string | null;
  tpArmed: boolean;
  trailingConfirmations: number;
  realizedPnl: string;
  unrealizedPnl: string;
  marketValue: string;
  openedAt: string;
}

export interface TokenRow {
  token_id: string;
  chain: string;
  contract_address: string;
  symbol: string;
  name: string | null;
  decimals: number;
}

export async function fetchPortfolio(): Promise<PortfolioSummary | null> {
  const token = await getToken();
  if (!token) return null;
  const res = await apiFetch<{ account: PortfolioSummary }>("/trading/account", {
    token,
  });
  return res.ok && res.data ? res.data.account : null;
}

export async function fetchPositions(
  status: "OPEN" | "CLOSED" | "ALL" = "OPEN",
): Promise<Position[]> {
  const token = await getToken();
  if (!token) return [];
  const res = await apiFetch<{ positions: Position[] }>(
    `/trading/positions?status=${status}`,
    { token },
  );
  return res.ok && res.data ? res.data.positions : [];
}

export async function fetchTokens(): Promise<TokenRow[]> {
  const token = await getToken();
  if (!token) return [];
  const res = await apiFetch<{ tokens: TokenRow[] }>("/trading/tokens", { token });
  return res.ok && res.data ? res.data.tokens : [];
}
