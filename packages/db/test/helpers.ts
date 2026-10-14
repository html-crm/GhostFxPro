import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../src/migrate.ts";

export { PGlite };

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await migrate(db);
  return db;
}

export interface SeedIds {
  userId: string;
  walletId: string;
  tokenId: string;
  strategyId: string;
  strategyVersionId: string;
}

/** Minimal, valid fixture: one user, wallet, BNB token, strategy + version. */
export async function seed(db: PGlite): Promise<SeedIds> {
  const user = await one<{ user_id: string }>(
    db,
    `INSERT INTO users (email, display_name, role, status, email_verified)
     VALUES ('owner@example.test', 'Danialoo', 'SUPER_ADMIN', 'APPROVED', true)
     RETURNING user_id`,
  );
  const wallet = await one<{ wallet_id: string }>(
    db,
    `INSERT INTO wallets (user_id, chain, address)
     VALUES ($1, 'BNB', '0xWALLET0000000000000000000000000000000001')
     RETURNING wallet_id`,
    [user.user_id],
  );
  const token = await one<{ token_id: string }>(
    db,
    `INSERT INTO tokens (chain, contract_address, symbol, name, decimals)
     VALUES ('BNB', '0xTOKENPEPE', 'PEPE', 'Pepe', 18)
     RETURNING token_id`,
  );
  const strategy = await one<{ strategy_id: string }>(
    db,
    `INSERT INTO strategies (owner_id, name) VALUES ($1, 'FLEXI') RETURNING strategy_id`,
    [user.user_id],
  );
  const version = await one<{ strategy_version_id: string }>(
    db,
    `INSERT INTO strategy_versions (strategy_id, version, config, config_hash, is_active)
     VALUES ($1, 1, $2::jsonb, 'hash-v1', true) RETURNING strategy_version_id`,
    [strategy.strategy_id, JSON.stringify({ tp: 0.07, trail: 0.02, confirmationPolls: 2 })],
  );
  return {
    userId: user.user_id,
    walletId: wallet.wallet_id,
    tokenId: token.token_id,
    strategyId: strategy.strategy_id,
    strategyVersionId: version.strategy_version_id,
  };
}

export async function createTrade(
  db: PGlite,
  ids: SeedIds,
  note: string,
): Promise<string> {
  const row = await one<{ trade_id: string }>(
    db,
    `INSERT INTO trades (user_id, wallet_id, token_id, chain, strategy_version_id, note)
     VALUES ($1, $2, $3, 'BNB', $4, $5)
     RETURNING trade_id`,
    [ids.userId, ids.walletId, ids.tokenId, ids.strategyVersionId, note],
  );
  return row.trade_id;
}

export interface FillInput {
  tradeId: string;
  side: "BUY" | "SELL";
  qty: string;
  price: string;
  feeQuote?: string;
  idempotencyKey: string;
  txSignature?: string | null;
}

export async function insertFill(db: PGlite, f: FillInput): Promise<string> {
  const row = await one<{ fill_id: string }>(
    db,
    `INSERT INTO fills
       (trade_id, side, qty_base_units, price_quote, fee_quote, idempotency_key,
        tx_signature, source, reconciliation_status)
     VALUES ($1, $2::order_side, $3::numeric, $4::numeric, $5::numeric, $6,
             $7, 'IMPORT', 'CONFIRMED')
     RETURNING fill_id`,
    [
      f.tradeId,
      f.side,
      f.qty,
      f.price,
      f.feeQuote ?? "0",
      f.idempotencyKey,
      f.txSignature ?? null,
    ],
  );
  return row.fill_id;
}

export interface PositionRow {
  trade_id: string;
  bought_qty: string;
  sold_qty: string;
  open_qty: string;
  avg_entry_price: string | null;
  total_buy_cost: string;
  total_sell_proceeds: string;
  realized_pnl: string;
}

export async function getPosition(
  db: PGlite,
  tradeId: string,
): Promise<PositionRow> {
  return one<PositionRow>(
    db,
    `SELECT trade_id, bought_qty, sold_qty, open_qty, avg_entry_price,
            total_buy_cost, total_sell_proceeds, realized_pnl
     FROM trade_positions WHERE trade_id = $1`,
    [tradeId],
  );
}

export async function count(db: PGlite, table: string): Promise<number> {
  const row = await one<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM ${table}`,
  );
  return Number(row.n);
}

async function one<T>(db: PGlite, sql: string, params?: unknown[]): Promise<T> {
  const res = await db.query<T>(sql, params as never);
  if (res.rows.length !== 1) {
    throw new Error(`expected exactly one row, got ${res.rows.length}`);
  }
  return res.rows[0] as T;
}
