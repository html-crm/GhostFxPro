import {
  isSupportedWalletChain,
  validateWalletAddress,
  type TokenRefMeta,
  type WalletBalanceProvider,
  type WalletBalances,
  type WalletChain,
} from "@ghostfx/bot";
import type { SqlExecutor } from "../db.ts";
import { isUniqueViolation } from "../http.ts";

/**
 * Watch-only wallets. A wallet is a public address plus a label; no key
 * material is ever accepted, stored, or returned by these functions.
 */

/**
 * Synthetic wallets created by the paper engine use this address prefix
 * (`paper:<chain>:<user>`). They are trading plumbing, not user wallets, and
 * are hidden from the wallet UI. Solana/EVM addresses can never contain ":".
 */
const PAPER_ADDRESS_PREFIX = "paper:";
const MAX_LABEL_LENGTH = 64;

export type WalletCustody = "NON_CUSTODIAL" | "UNSUPPORTED";

export interface WalletView {
  walletId: string;
  chain: WalletChain;
  address: string;
  label: string | null;
  custody: WalletCustody;
  createdAt: string;
  updatedAt: string;
}

interface WalletRow {
  wallet_id: string;
  chain: WalletChain;
  address: string;
  label: string | null;
  custody: string;
  created_at: string;
  updated_at: string;
}

function mapWallet(r: WalletRow): WalletView {
  return {
    walletId: r.wallet_id,
    chain: r.chain,
    address: r.address,
    label: r.label,
    custody: r.custody === "UNSUPPORTED" ? "UNSUPPORTED" : "NON_CUSTODIAL",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export interface WalletInput {
  chain: WalletChain;
  address: string;
  label: string | null;
}

export function validateWalletInput(raw: unknown): WalletInput {
  const b = raw as { chain?: unknown; address?: unknown; label?: unknown } | undefined;
  if (!b || typeof b !== "object") throw new Error("invalid_wallet");

  const chain = String(b.chain ?? "").trim().toUpperCase();
  if (chain === "ROBINHOOD") throw new Error("unsupported_chain");
  if (!isSupportedWalletChain(chain)) throw new Error("invalid_chain");

  const address = String(b.address ?? "").trim();
  if (!address) throw new Error("invalid_address");
  if (!validateWalletAddress(chain, address)) throw new Error("invalid_address");

  let label: string | null = null;
  if (b.label !== undefined && b.label !== null) {
    const trimmed = String(b.label).trim();
    if (trimmed.length > MAX_LABEL_LENGTH) throw new Error("invalid_label");
    label = trimmed === "" ? null : trimmed;
  }

  return { chain, address, label };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createWallet(
  db: SqlExecutor,
  userId: string,
  input: WalletInput,
): Promise<WalletView> {
  let walletId: string;
  try {
    const res = await db.query<{ wallet_id: string }>(
      `INSERT INTO wallets (user_id, chain, address, label, custody)
       VALUES ($1, $2::chain_kind, $3, $4, 'NON_CUSTODIAL')
       RETURNING wallet_id`,
      [userId, input.chain, input.address, input.label],
    );
    walletId = res.rows[0]!.wallet_id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("wallet_exists");
    throw err;
  }
  return (await getWallet(db, userId, walletId))!;
}

export async function getWallet(
  db: SqlExecutor,
  userId: string,
  walletId: string,
): Promise<WalletView | null> {
  const res = await db.query<WalletRow>(
    `SELECT * FROM wallets WHERE wallet_id = $1 AND user_id = $2`,
    [walletId, userId],
  );
  return res.rows[0] ? mapWallet(res.rows[0]) : null;
}

export async function listWallets(
  db: SqlExecutor,
  userId: string,
): Promise<WalletView[]> {
  const res = await db.query<WalletRow>(
    `SELECT * FROM wallets
     WHERE user_id = $1 AND address NOT LIKE $2
     ORDER BY created_at DESC`,
    [userId, `${PAPER_ADDRESS_PREFIX}%`],
  );
  return res.rows.map(mapWallet);
}

export async function updateWallet(
  db: SqlExecutor,
  userId: string,
  walletId: string,
  patch: { label?: string | null },
): Promise<WalletView | null> {
  const existing = await getWallet(db, userId, walletId);
  if (!existing) return null;

  let label = existing.label;
  if (patch.label !== undefined) {
    if (patch.label === null) {
      label = null;
    } else {
      const trimmed = String(patch.label).trim();
      if (trimmed.length > MAX_LABEL_LENGTH) throw new Error("invalid_label");
      label = trimmed === "" ? null : trimmed;
    }
  }

  await db.query(
    `UPDATE wallets SET label = $3, updated_at = now()
     WHERE wallet_id = $1 AND user_id = $2`,
    [walletId, userId, label],
  );
  return getWallet(db, userId, walletId);
}

export async function deleteWallet(
  db: SqlExecutor,
  userId: string,
  walletId: string,
): Promise<boolean> {
  const res = await db.query(
    `DELETE FROM wallets WHERE wallet_id = $1 AND user_id = $2 RETURNING wallet_id`,
    [walletId, userId],
  );
  return res.rows.length === 1;
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/** Platform-known tokens for a chain, used to probe EVM token balances. */
export async function candidateTokens(
  db: SqlExecutor,
  chain: WalletChain,
): Promise<TokenRefMeta[]> {
  const res = await db.query<{
    contract_address: string;
    symbol: string;
    name: string | null;
    decimals: number;
  }>(
    `SELECT contract_address, symbol, name, decimals
     FROM tokens WHERE chain = $1::chain_kind`,
    [chain],
  );
  return res.rows.map((r) => ({
    address: r.contract_address,
    symbol: r.symbol,
    name: r.name,
    decimals: Number(r.decimals),
  }));
}

export interface WalletWithBalances {
  wallet: WalletView;
  /** `null` when the read failed or the chain is unsupported. */
  balances: WalletBalances | null;
}

/**
 * Reads live balances for a single wallet. Token probes are scoped to
 * platform-known tokens for the chain (an EVM chain cannot be enumerated
 * without an indexer). A failed read yields `null`, never a fabricated value.
 */
export async function loadBalancesForWallet(
  db: SqlExecutor,
  provider: WalletBalanceProvider,
  wallet: WalletView,
): Promise<WalletBalances | null> {
  const candidates = await candidateTokens(db, wallet.chain);
  return provider.getBalances(wallet.chain, wallet.address, candidates);
}

/**
 * Reads live balances for every wallet the user owns, sharing the per-chain
 * token probe list across wallets.
 */
export async function loadWalletBalances(
  db: SqlExecutor,
  provider: WalletBalanceProvider,
  userId: string,
): Promise<WalletWithBalances[]> {
  const wallets = await listWallets(db, userId);
  const tokensByChain = new Map<WalletChain, TokenRefMeta[]>();

  const results = await Promise.all(
    wallets.map(async (wallet): Promise<WalletWithBalances> => {
      let candidates = tokensByChain.get(wallet.chain);
      if (!candidates) {
        candidates = await candidateTokens(db, wallet.chain);
        tokensByChain.set(wallet.chain, candidates);
      }
      const balances = await provider.getBalances(
        wallet.chain,
        wallet.address,
        candidates,
      );
      return { wallet, balances };
    }),
  );
  return results;
}
