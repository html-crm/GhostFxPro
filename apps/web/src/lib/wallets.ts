import { apiFetch } from "./api";
import { getToken } from "./session";

export type WalletChain = "SOLANA" | "BNB" | "ROBINHOOD";

export interface Wallet {
  walletId: string;
  chain: WalletChain;
  address: string;
  label: string | null;
  custody: "NON_CUSTODIAL" | "UNSUPPORTED";
  createdAt: string;
  updatedAt: string;
}

export interface NativeBalance {
  symbol: string;
  decimals: number;
  amount: string;
  raw: string;
}

export interface TokenBalance {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
  amount: string;
  raw: string;
}

export interface WalletBalances {
  chain: WalletChain;
  address: string;
  native: NativeBalance;
  tokens: TokenBalance[];
  truncated: boolean;
  fetchedAt: number;
  source: string;
}

export interface WalletWithBalances extends Wallet {
  balances: WalletBalances | null;
}

export async function fetchWallets(): Promise<Wallet[]> {
  const token = await getToken();
  if (!token) return [];
  const res = await apiFetch<{ wallets: Wallet[] }>("/wallets", { token });
  return res.ok && res.data ? res.data.wallets : [];
}

export async function fetchWalletBalances(): Promise<WalletWithBalances[]> {
  const token = await getToken();
  if (!token) return [];
  const res = await apiFetch<{ wallets: WalletWithBalances[] }>(
    "/wallets/balances",
    { token },
  );
  return res.ok && res.data ? res.data.wallets : [];
}
