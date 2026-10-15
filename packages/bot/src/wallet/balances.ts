/**
 * Watch-only wallet balances.
 *
 * This module never handles key material: it only reads public balances for a
 * public address over public JSON-RPC endpoints. Seed phrases and private keys
 * are neither required nor accepted here.
 */

/** Chains a wallet address can belong to. */
export type WalletChain = "SOLANA" | "BNB" | "ROBINHOOD";

/** Chains this provider can actually read balances for. */
export const SUPPORTED_WALLET_CHAINS: readonly WalletChain[] = ["SOLANA", "BNB"];

/** Native asset metadata per chain (the asset that pays network fees). */
export const NATIVE_ASSETS: Record<WalletChain, { symbol: string; decimals: number }> = {
  SOLANA: { symbol: "SOL", decimals: 9 },
  BNB: { symbol: "BNB", decimals: 18 },
  ROBINHOOD: { symbol: "RH", decimals: 18 },
};

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** EIP-55 is not enforced; a bare 0x + 40 hex chars is accepted. */
export function isEvmAddress(address: string): boolean {
  return EVM_ADDRESS_RE.test(address.trim());
}

/** Solana addresses are base58 and 32–44 characters long. */
export function isSolanaAddress(address: string): boolean {
  const s = address.trim();
  return s.length >= 32 && s.length <= 44 && BASE58_RE.test(s);
}

export function isSupportedWalletChain(chain: string): chain is WalletChain {
  return chain === "SOLANA" || chain === "BNB";
}

export function validateWalletAddress(chain: WalletChain, address: string): boolean {
  if (chain === "SOLANA") return isSolanaAddress(address);
  if (chain === "BNB") return isEvmAddress(address);
  return false;
}

/** Parses a 0x-prefixed hex quantity (EVM results) into a BigInt. */
export function hexToBigInt(hex: string): bigint {
  const s = hex.trim();
  if (s === "" || s === "0x" || s === "0X") return 0n;
  return BigInt(s);
}

/**
 * Exact base-unit -> human-unit formatting using BigInt. Never uses floating
 * point, so large balances and small token amounts stay precise.
 */
export function formatUnits(raw: bigint | string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`invalid decimals: ${decimals}`);
  }
  const value = typeof raw === "string" ? BigInt(raw) : raw;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${body}` : body;
}

export interface NativeBalance {
  symbol: string;
  decimals: number;
  /** Human-readable amount, e.g. "1.25". */
  amount: string;
  /** Integer base units as a string, e.g. "1250000000". */
  raw: string;
}

export interface TokenBalance {
  /** Contract address (EVM) or mint (Solana). */
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
  /** True when token holdings were capped (largest kept). */
  truncated: boolean;
  /** When the read happened (ms). Never presented as realtime. */
  fetchedAt: number;
  source: string;
}

/** A token the caller wants probed by contract address (used for EVM). */
export interface TokenRefMeta {
  address: string;
  symbol: string;
  name?: string | null;
  decimals: number;
}

export interface WalletBalanceProvider {
  readonly name: string;
  /**
   * Reads the native (network-fee) balance plus known token balances for a
   * public address. Returns `null` when the chain is unsupported or the read
   * failed — it never invents a balance.
   */
  getBalances(
    chain: WalletChain,
    address: string,
    candidateTokens?: TokenRefMeta[],
  ): Promise<WalletBalances | null>;
}

export type RpcFetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface PublicRpcWalletOptions {
  fetchImpl?: RpcFetchLike;
  solanaRpcUrl?: string;
  bscRpcUrl?: string;
  timeoutMs?: number;
  /** Cap on token holdings kept per wallet (largest first). Default 200. */
  maxTokenAccounts?: number;
  now?: () => number;
}

const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const DEFAULT_BSC_RPC = "https://bsc-dataseed.bnbchain.org";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BALANCE_OF_SELECTOR = "0x70a08231";
const DEFAULT_MAX_TOKEN_ACCOUNTS = 200;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read-only balances over public JSON-RPC. Solana uses `getBalance` and
 * `getTokenAccountsByOwner`; BNB uses `eth_getBalance` and `eth_call` against
 * caller-supplied token contracts (EVM cannot enumerate holdings without an
 * indexer, so unknown tokens are simply not discovered — never guessed).
 */
export class PublicRpcWalletProvider implements WalletBalanceProvider {
  readonly name = "public-rpc";
  private readonly fetchImpl: RpcFetchLike;
  private readonly solanaRpcUrl: string;
  private readonly bscRpcUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTokenAccounts: number;
  private readonly now: () => number;

  constructor(opts: PublicRpcWalletOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as RpcFetchLike);
    this.solanaRpcUrl = opts.solanaRpcUrl ?? DEFAULT_SOLANA_RPC;
    this.bscRpcUrl = opts.bscRpcUrl ?? DEFAULT_BSC_RPC;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxTokenAccounts = opts.maxTokenAccounts ?? DEFAULT_MAX_TOKEN_ACCOUNTS;
    this.now = opts.now ?? (() => Date.now());
  }

  async getBalances(
    chain: WalletChain,
    address: string,
    candidateTokens: TokenRefMeta[] = [],
  ): Promise<WalletBalances | null> {
    if (chain === "SOLANA") return this.solana(address, candidateTokens);
    if (chain === "BNB") return this.bsc(address, candidateTokens);
    return null;
  }

  private nativeBalance(chain: WalletChain, raw: bigint): NativeBalance {
    const meta = NATIVE_ASSETS[chain];
    return {
      symbol: meta.symbol,
      decimals: meta.decimals,
      amount: formatUnits(raw, meta.decimals),
      raw: raw.toString(),
    };
  }

  private async solana(
    address: string,
    candidateTokens: TokenRefMeta[],
  ): Promise<WalletBalances | null> {
    const nativeRes = await this.rpc(this.solanaRpcUrl, "getBalance", [address]);
    const nativeValue = asRecord(asRecord(nativeRes)?.result)?.value;
    if (typeof nativeValue !== "number" || !Number.isFinite(nativeValue)) {
      return null;
    }

    const byMint = new Map(candidateTokens.map((t) => [t.address, t]));
    const tokens: TokenBalance[] = [];
    const tokenRes = await this.rpc(this.solanaRpcUrl, "getTokenAccountsByOwner", [
      address,
      { programId: TOKEN_PROGRAM_ID },
      { encoding: "jsonParsed" },
    ]);
    const accounts = asRecord(asRecord(tokenRes)?.result)?.value;
    if (Array.isArray(accounts)) {
      for (const item of accounts) {
        const parsed = asRecord(
          asRecord(asRecord(asRecord(item)?.account)?.data)?.parsed,
        );
        const accountInfo = asRecord(parsed?.info);
        const mint = accountInfo?.mint;
        const tokenAmount = asRecord(accountInfo?.tokenAmount);
        const amountRaw = tokenAmount?.amount;
        const decimals = tokenAmount?.decimals;
        if (
          typeof mint !== "string" ||
          typeof amountRaw !== "string" ||
          typeof decimals !== "number"
        ) {
          continue;
        }
        const raw = BigInt(amountRaw);
        if (raw <= 0n) continue;
        const meta = byMint.get(mint);
        tokens.push({
          address: mint,
          symbol: meta?.symbol ?? null,
          name: meta?.name ?? null,
          decimals,
          amount: formatUnits(raw, decimals),
          raw: amountRaw,
        });
      }
    }

    tokens.sort((a, b) => {
      const x = BigInt(a.raw);
      const y = BigInt(b.raw);
      return y > x ? 1 : y < x ? -1 : 0;
    });
    const truncated = tokens.length > this.maxTokenAccounts;

    return {
      chain: "SOLANA",
      address,
      native: this.nativeBalance(
        "SOLANA",
        BigInt(Math.trunc(nativeValue)),
      ),
      tokens: truncated ? tokens.slice(0, this.maxTokenAccounts) : tokens,
      truncated,
      fetchedAt: this.now(),
      source: this.name,
    };
  }

  private async bsc(
    address: string,
    candidateTokens: TokenRefMeta[],
  ): Promise<WalletBalances | null> {
    const nativeRes = await this.rpc(this.bscRpcUrl, "eth_getBalance", [
      address,
      "latest",
    ]);
    const nativeHex = asRecord(nativeRes)?.result;
    if (typeof nativeHex !== "string") return null;

    const data = BALANCE_OF_SELECTOR + address.slice(2).toLowerCase().padStart(64, "0");
    const tokens: TokenBalance[] = [];
    for (const token of candidateTokens) {
      if (!isEvmAddress(token.address)) continue;
      const res = await this.rpc(this.bscRpcUrl, "eth_call", [
        { to: token.address, data },
        "latest",
      ]);
      const hex = asRecord(res)?.result;
      if (typeof hex !== "string") continue;
      const raw = hexToBigInt(hex);
      if (raw <= 0n) continue;
      tokens.push({
        address: token.address,
        symbol: token.symbol,
        name: token.name ?? null,
        decimals: token.decimals,
        amount: formatUnits(raw, token.decimals),
        raw: raw.toString(),
      });
    }

    return {
      chain: "BNB",
      address,
      native: this.nativeBalance("BNB", hexToBigInt(nativeHex)),
      tokens,
      truncated: false,
      fetchedAt: this.now(),
      source: this.name,
    };
  }

  /** One JSON-RPC round trip. Returns `null` on any error or RPC error body. */
  private async rpc(
    url: string,
    method: string,
    params: unknown[],
  ): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = await res.json();
      const rec = asRecord(body);
      if (!rec || rec.error) return null;
      return body;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
