/**
 * Exchange integration status.
 *
 * This platform cannot place real orders: it has no venue credentials, no
 * eligibility confirmation, and live execution is disabled by default. This
 * module is the authoritative registry of which official/authorized venues
 * exist, why each one is unusable right now, and what would unblock it.
 *
 * It is a pure module: no network calls, no credentials, no order paths.
 */

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

/**
 * Stablecoins are distinct assets. USDT and USDC are never substituted for
 * each other anywhere in this platform, so they are separate rows here too.
 */
export const STABLECOINS: readonly StablecoinAsset[] = [
  {
    symbol: "USDT",
    name: "Tether USD",
    note: "Tracked on its own. Never substituted for another stablecoin.",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    note: "Tracked on its own. Never substituted for another stablecoin.",
  },
];

/** Looks up a stablecoin by exact symbol. Unknown symbols return null. */
export function resolveStablecoin(symbol: string): StablecoinAsset | null {
  const wanted = symbol.trim().toUpperCase();
  return STABLECOINS.find((s) => s.symbol === wanted) ?? null;
}

const GLOBAL_LIMITATIONS: readonly string[] = [
  "Live order submission is disabled by default; nothing in this deployment submits real trades.",
  "Unavailable pairs or regions are shown as limitations, never bypassed.",
  "USDT and USDC are treated as distinct assets and are never substituted.",
  "No exchange API keys, seed phrases, or private keys are stored or requested.",
];

const PROVIDERS: readonly ExchangeProvider[] = [
  {
    providerId: "robinhood",
    displayName: "Robinhood",
    kind: "BROKER",
    status: "blocked",
    summary: "Official Robinhood crypto API. Not integrated in this deployment.",
    reasons: [
      "No approved Robinhood credentials are configured.",
      "Region eligibility has not been verified against the provider's official availability.",
      "Live order submission is disabled by default on this platform.",
    ],
    requirements: [
      "Owner-provided approved credentials, supplied via environment or secret manager (never the repo).",
      "Eligibility confirmed for the account's region against the provider's official terms.",
      "Explicit owner approval to enable live execution.",
    ],
    limitations: [
      "Only pairs the provider officially lists are tradable; everything else stays unavailable rather than being routed elsewhere.",
      "The venue is unavailable in some regions; those users see a limitation, not a workaround.",
      "USDT and USDC are distinct assets on this venue and are never treated as interchangeable.",
    ],
    markets: ["spot"],
  },
  {
    providerId: "onchain-dex",
    displayName: "On-chain DEX (Solana, BNB)",
    kind: "DEX",
    status: "paper_only",
    summary: "On-chain swaps are evaluated in paper (dry-run) mode only.",
    reasons: [
      "Live execution is disabled; the engine cannot submit a real swap.",
      "No signing keys are held or requested by this platform.",
      "Wallet balances are read-only from public RPC and are never signed against.",
    ],
    requirements: [
      "Owner-provided approved credentials for an authorized venue.",
      "Explicit owner approval to enable live execution.",
    ],
    limitations: [
      "Network/gas fees are not simulated by paper fills.",
      "Quotes are observations, not guaranteed execution prices — on-chain liquidity and slippage at fill time differ.",
    ],
    markets: ["spot"],
  },
  {
    providerId: "cex-generic",
    displayName: "Centralized exchange (generic)",
    kind: "CEX",
    status: "not_implemented",
    summary: "No centralized exchange venue is configured for this deployment.",
    reasons: ["No venue credentials or eligibility confirmation have been provided."],
    requirements: [
      "Owner-provided approved credentials via environment or secret manager.",
      "Explicit owner approval to enable live execution.",
    ],
    limitations: ["Trading remains paper-only until a venue is officially authorized."],
    markets: ["spot"],
  },
];

export function listExchangeProviders(): ExchangeProvider[] {
  return PROVIDERS.map((p) => ({
    ...p,
    reasons: [...p.reasons],
    requirements: [...p.requirements],
    limitations: [...p.limitations],
    markets: [...p.markets],
  }));
}

export function getExchangeStatus(): ExchangeStatusSummary {
  return {
    canSubmitLiveOrders: false,
    reason:
      "This platform runs in paper (dry-run) mode. Live execution stays disabled by default, and no approved credentials or eligibility confirmation have been provided.",
    providers: listExchangeProviders(),
    stablecoins: STABLECOINS.map((s) => ({ ...s })),
    limitations: [...GLOBAL_LIMITATIONS],
  };
}
