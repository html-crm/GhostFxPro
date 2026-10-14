import { createHash } from "node:crypto";
import {
  evaluateFlexi,
  normalizeConfig,
  FLEXI_DEFAULT_CONFIG,
  type EvaluationResult,
  type FlexiConfig,
  type MarketDataProvider,
  type PositionState,
  type Quote,
} from "@ghostfx/bot";
import type { SqlExecutor } from "../db.ts";
import { logAudit } from "../audit.ts";
import {
  baseUnitsToCostScaled,
  fromScaled,
  pricePerBaseScaled,
  quoteToBaseUnits,
  toScaled,
} from "./decimal.ts";

export type ChainKind = "SOLANA" | "BNB" | "ROBINHOOD";

const DEFAULT_INITIAL_BALANCE = "100000";
const DEFAULT_MAX_QUOTE_AGE_MS = 15_000;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface PaperAccount {
  userId: string;
  initialBalance: string;
  cashBalance: string;
}

export async function getOrCreatePaperAccount(
  db: SqlExecutor,
  userId: string,
  initialBalance: string = DEFAULT_INITIAL_BALANCE,
): Promise<PaperAccount> {
  const existing = await db.query<{
    initial_balance: string;
    cash_balance: string;
  }>(
    `SELECT initial_balance, cash_balance FROM paper_accounts WHERE user_id = $1`,
    [userId],
  );
  if (existing.rows[0]) return mapAccount(userId, existing.rows[0]);

  const initial = fromScaled(toScaled(initialBalance)); // validate + normalise
  await db.query(
    `INSERT INTO paper_accounts (user_id, initial_balance, cash_balance)
     VALUES ($1, $2, $2) ON CONFLICT (user_id) DO NOTHING`,
    [userId, initial],
  );
  const row = await db.query<{ initial_balance: string; cash_balance: string }>(
    `SELECT initial_balance, cash_balance FROM paper_accounts WHERE user_id = $1`,
    [userId],
  );
  return mapAccount(userId, row.rows[0]!);
}

function mapAccount(
  userId: string,
  row: { initial_balance: string; cash_balance: string },
): PaperAccount {
  return {
    userId,
    initialBalance: norm(row.initial_balance),
    cashBalance: norm(row.cash_balance),
  };
}

/** Normalises a Postgres numeric string to a canonical decimal string. */
function norm(value: string): string {
  return fromScaled(toScaled(value));
}

/** Nullable variant of {@link norm}. */
function normOrNull(value: string | null): string | null {
  return value === null ? null : norm(value);
}

// ---------------------------------------------------------------------------
// Tokens & wallets
// ---------------------------------------------------------------------------

export interface TokenInput {
  chain: ChainKind;
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
}

export interface ResolvedToken {
  tokenId: string;
  decimals: number;
}

/**
 * Creates the token if absent. The stored decimals are authoritative once a
 * token exists (changing them would corrupt unit math for existing trades).
 */
export async function upsertToken(
  db: SqlExecutor,
  token: TokenInput,
): Promise<ResolvedToken> {
  const address = token.address.trim();
  if (!address) throw new Error("token_address_required");
  await db.query(
    `INSERT INTO tokens (chain, contract_address, symbol, name, decimals)
     VALUES ($1::chain_kind, $2, $3, $4, $5)
     ON CONFLICT (chain, contract_address) DO NOTHING`,
    [token.chain, address, token.symbol, token.name ?? null, token.decimals],
  );
  const res = await db.query<{ token_id: string; decimals: number }>(
    `SELECT token_id, decimals FROM tokens WHERE chain = $1::chain_kind AND contract_address = $2`,
    [token.chain, address],
  );
  const row = res.rows[0];
  if (!row) throw new Error("token_resolution_failed");
  return { tokenId: row.token_id, decimals: Number(row.decimals) };
}

export async function getOrCreatePaperWallet(
  db: SqlExecutor,
  userId: string,
  chain: ChainKind,
): Promise<string> {
  const address = `paper:${chain}:${userId}`;
  await db.query(
    `INSERT INTO wallets (user_id, chain, address, label, custody)
     VALUES ($1, $2::chain_kind, $3, 'PAPER', 'NON_CUSTODIAL')
     ON CONFLICT (chain, address) DO NOTHING`,
    [userId, chain, address],
  );
  const res = await db.query<{ wallet_id: string }>(
    `SELECT wallet_id FROM wallets WHERE chain = $1::chain_kind AND address = $2`,
    [chain, address],
  );
  return res.rows[0]!.wallet_id;
}

// ---------------------------------------------------------------------------
// Strategy seeding
// ---------------------------------------------------------------------------

export interface FlexiStrategyRef {
  strategyVersionId: string;
  config: FlexiConfig;
}

/** Finds or creates the owner's FLEXI strategy + version 1 (idempotent). */
export async function getOrCreateFlexiStrategyVersion(
  db: SqlExecutor,
  userId: string,
): Promise<FlexiStrategyRef> {
  await db.query(
    `INSERT INTO strategies (owner_id, name) VALUES ($1, 'FLEXI')
     ON CONFLICT (owner_id, name) DO NOTHING`,
    [userId],
  );
  const strat = await db.query<{ strategy_id: string }>(
    `SELECT strategy_id FROM strategies WHERE owner_id = $1 AND name = 'FLEXI'`,
    [userId],
  );
  const strategyId = strat.rows[0]!.strategy_id;

  const existing = await db.query<{ strategy_version_id: string; config: unknown }>(
    `SELECT strategy_version_id, config FROM strategy_versions
     WHERE strategy_id = $1 AND version = 1`,
    [strategyId],
  );
  if (existing.rows[0]) {
    return {
      strategyVersionId: existing.rows[0].strategy_version_id,
      config: parseConfig(existing.rows[0].config),
    };
  }

  const config = FLEXI_DEFAULT_CONFIG;
  const json = JSON.stringify(config);
  const hash = createHash("sha256").update(json).digest("hex");
  const inserted = await db.query<{ strategy_version_id: string }>(
    `INSERT INTO strategy_versions (strategy_id, version, config, config_hash, is_active)
     VALUES ($1, 1, $2::jsonb, $3, true)
     ON CONFLICT (strategy_id, version) DO NOTHING
     RETURNING strategy_version_id`,
    [strategyId, json, hash],
  );
  const strategyVersionId =
    inserted.rows[0]?.strategy_version_id ??
    (
      await db.query<{ strategy_version_id: string }>(
        `SELECT strategy_version_id FROM strategy_versions WHERE strategy_id = $1 AND version = 1`,
        [strategyId],
      )
    ).rows[0]!.strategy_version_id;
  return { strategyVersionId, config };
}

function parseConfig(raw: unknown): FlexiConfig {
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  return normalizeConfig((obj ?? {}) as Partial<FlexiConfig>);
}

// ---------------------------------------------------------------------------
// Opening a position
// ---------------------------------------------------------------------------

export interface OpenPaperPositionInput {
  token: TokenInput;
  notionalQuote: string;
  pricePerToken: string;
  note?: string;
}

export interface OpenedPosition {
  tradeId: string;
  fillId: string;
  tokenId: string;
  baseUnits: string;
  cost: string;
  entryPricePerToken: string;
}

export async function openPaperPosition(
  db: SqlExecutor,
  userId: string,
  input: OpenPaperPositionInput,
): Promise<OpenedPosition> {
  const account = await getOrCreatePaperAccount(db, userId);
  const resolved = await upsertToken(db, input.token);
  const walletId = await getOrCreatePaperWallet(db, userId, input.token.chain);
  const strategy = await getOrCreateFlexiStrategyVersion(db, userId);

  const { baseUnits, pricePerBaseScaled } = quoteToBaseUnits(
    input.notionalQuote,
    input.pricePerToken,
    resolved.decimals,
  );
  const costScaled = baseUnitsToCostScaled(baseUnits, pricePerBaseScaled);
  const cost = fromScaled(costScaled);

  if (toScaled(account.cashBalance) < costScaled) {
    throw new Error("insufficient_funds");
  }

  const trade = await db.query<{ trade_id: string }>(
    `INSERT INTO trades (user_id, wallet_id, token_id, chain, strategy_version_id, mode, note)
     VALUES ($1, $2, $3, $4::chain_kind, $5, 'PAPER', $6)
     RETURNING trade_id`,
    [
      userId,
      walletId,
      resolved.tokenId,
      input.token.chain,
      strategy.strategyVersionId,
      input.note ?? null,
    ],
  );
  const tradeId = trade.rows[0]!.trade_id;

  const fill = await db.query<{ fill_id: string }>(
    `INSERT INTO fills
       (trade_id, side, qty_base_units, price_quote, fee_quote, source,
        reconciliation_status, idempotency_key)
     VALUES ($1, 'BUY', $2::numeric, $3::numeric, 0, 'SIMULATED', 'CONFIRMED', $4)
     RETURNING fill_id`,
    [tradeId, baseUnits.toString(), fromScaled(pricePerBaseScaled), `paper:open:${tradeId}`],
  );
  const fillId = fill.rows[0]!.fill_id;

  await db.query(
    `UPDATE paper_accounts SET cash_balance = cash_balance - $2::numeric, updated_at = now()
     WHERE user_id = $1`,
    [userId, cost],
  );

  await db.query(
    `INSERT INTO trade_strategy_state (trade_id, peak_price, tp_armed, trailing_confirmations, last_price, last_evaluated_at)
     VALUES ($1, $2::numeric, false, 0, $2::numeric, now())
     ON CONFLICT (trade_id) DO NOTHING`,
    [tradeId, input.pricePerToken],
  );

  await recordLedger(db, tradeId, fillId, "BUY", cost);
  await recordDecision(db, {
    tradeId,
    strategyVersionId: strategy.strategyVersionId,
    decision: "BUY",
    quoteSource: "paper:open",
    marketDataTs: Date.now(),
    stateVersion: 0,
    reasons: [{ rule: "open", price: input.pricePerToken }],
  });
  await logAudit(db, {
    actorId: userId,
    action: "paper.position.open",
    targetType: "trade",
    targetId: tradeId,
    metadata: { token: input.token.symbol, notional: input.notionalQuote },
  });

  return {
    tradeId,
    fillId,
    tokenId: resolved.tokenId,
    baseUnits: baseUnits.toString(),
    cost,
    entryPricePerToken: input.pricePerToken,
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface EvaluateOptions {
  now?: number;
  maxQuoteAgeMs?: number;
  decisionId?: string;
}

export interface EvaluateOutcome {
  evaluation: EvaluationResult["evaluation"];
  closed: boolean;
  tradeId: string;
}

interface OpenTradeRow {
  trade_id: string;
  status: string;
  mode: string;
  chain: ChainKind;
  decimals: number;
  contract_address: string;
  strategy_version_id: string | null;
  config: unknown;
  avg_entry_price: string | null;
  open_qty: string;
}

export async function evaluateTrade(
  db: SqlExecutor,
  tradeId: string,
  quote: Quote,
  opts: EvaluateOptions = {},
): Promise<EvaluateOutcome> {
  const loaded = await loadOpenTrade(db, tradeId);
  if (!loaded) throw new Error("trade_not_open");

  const entryScaledPerBase = toScaled(loaded.avg_entry_price ?? "0");
  const entryPriceScaled = wholePriceScaled(entryScaledPerBase, loaded.decimals);

  const stateRow = await db.query<{
    peak_price: string;
    tp_armed: boolean;
    trailing_confirmations: number;
    state_version: number;
  }>(
    `SELECT peak_price, tp_armed, trailing_confirmations, state_version
     FROM trade_strategy_state WHERE trade_id = $1`,
    [tradeId],
  );
  const state: PositionState = {
    tradeId,
    entryPrice: Number(fromScaled(entryPriceScaled)),
    peakPrice: stateRow.rows[0]
      ? Number(stateRow.rows[0].peak_price)
      : Number(fromScaled(entryPriceScaled)),
    tpArmed: stateRow.rows[0]?.tp_armed ?? false,
    trailingConfirmations: stateRow.rows[0]?.trailing_confirmations ?? 0,
  };
  const stateVersion = stateRow.rows[0]?.state_version ?? 0;

  const config = parseConfig(loaded.config);
  const result = evaluateFlexi(state, quote, config, {
    now: opts.now ?? Date.now(),
    maxQuoteAgeMs: opts.maxQuoteAgeMs ?? DEFAULT_MAX_QUOTE_AGE_MS,
    decisionId: opts.decisionId,
  });
  const ev = result.evaluation;

  await recordDecision(db, {
    decisionId: ev.decisionId,
    tradeId,
    strategyVersionId: loaded.strategy_version_id,
    decision: ev.action,
    quoteSource: quote.source,
    marketDataTs: quote.ts,
    stateVersion,
    reasons: [{ rule: ev.triggeringRule ?? ev.action, reason: ev.reason }],
  });
  await recordExitEvaluation(db, tradeId, loaded.strategy_version_id, ev);

  let closed = false;
  if (ev.action === "SELL") {
    await executeSell(db, {
      tradeId,
      userId: loaded.user_id,
      decimals: loaded.decimals,
      openQty: loaded.open_qty,
      pricePerToken: quote.price,
      reason: ev.triggeringRule ?? "strategy_exit",
    });
    closed = true;
  }

  await db.query(
    `INSERT INTO trade_strategy_state
       (trade_id, peak_price, tp_armed, trailing_confirmations, state_version, last_price, last_evaluated_at, updated_at)
     VALUES ($1, $2::numeric, $3, $4, $5, $6::numeric, now(), now())
     ON CONFLICT (trade_id) DO UPDATE SET
       peak_price = EXCLUDED.peak_price,
       tp_armed = EXCLUDED.tp_armed,
       trailing_confirmations = EXCLUDED.trailing_confirmations,
       state_version = EXCLUDED.state_version,
       last_price = EXCLUDED.last_price,
       last_evaluated_at = now(),
       updated_at = now()`,
    [
      tradeId,
      result.nextState.peakPrice.toString(),
      result.nextState.tpArmed,
      result.nextState.trailingConfirmations,
      stateVersion + 1,
      quote.price.toString(),
    ],
  );

  return { evaluation: ev, closed, tradeId };
}

interface LoadedTrade extends OpenTradeRow {
  user_id: string;
}

async function loadOpenTrade(
  db: SqlExecutor,
  tradeId: string,
): Promise<LoadedTrade | null> {
  const res = await db.query<LoadedTrade>(
    `SELECT t.trade_id, t.user_id, t.status, t.mode, t.chain,
            tok.decimals, tok.contract_address,
            t.strategy_version_id, sv.config,
            tp.avg_entry_price, tp.open_qty
     FROM trades t
     JOIN tokens tok ON tok.token_id = t.token_id
     JOIN trade_positions tp ON tp.trade_id = t.trade_id
     LEFT JOIN strategy_versions sv ON sv.strategy_version_id = t.strategy_version_id
     WHERE t.trade_id = $1 AND t.status = 'OPEN'`,
    [tradeId],
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

interface SellInput {
  tradeId: string;
  userId: string;
  decimals: number;
  openQty: string;
  pricePerToken: number;
  reason: string;
}

async function executeSell(db: SqlExecutor, input: SellInput): Promise<void> {
  const qty = BigInt(input.openQty);
  if (qty <= 0n) throw new Error("nothing_to_sell");
  const perBase = pricePerBaseScaled(input.pricePerToken, input.decimals);
  const proceedsScaled = qty * perBase;
  const proceeds = fromScaled(proceedsScaled);
  const priceQuote = fromScaled(perBase);

  const fill = await db.query<{ fill_id: string }>(
    `INSERT INTO fills
       (trade_id, side, qty_base_units, price_quote, fee_quote, source,
        reconciliation_status, idempotency_key)
     VALUES ($1, 'SELL', $2::numeric, $3::numeric, 0, 'SIMULATED', 'CONFIRMED', $4)
     RETURNING fill_id`,
    [input.tradeId, qty.toString(), priceQuote, `paper:close:${input.tradeId}`],
  );
  const fillId = fill.rows[0]!.fill_id;

  await db.query(
    `UPDATE paper_accounts SET cash_balance = cash_balance + $2::numeric, updated_at = now()
     WHERE user_id = $1`,
    [input.userId, proceeds],
  );
  await db.query(
    `UPDATE trades SET status = 'CLOSED', closed_at = now() WHERE trade_id = $1`,
    [input.tradeId],
  );
  await recordLedger(db, input.tradeId, fillId, "SELL", proceeds);
  await logAudit(db, {
    actorId: input.userId,
    action: "paper.position.close",
    targetType: "trade",
    targetId: input.tradeId,
    metadata: { reason: input.reason, proceeds },
  });
}

/** Explicit, user-initiated close at a given price. */
export async function closePaperPosition(
  db: SqlExecutor,
  tradeId: string,
  pricePerToken: number,
  reason = "manual_close",
): Promise<void> {
  const loaded = await loadOpenTrade(db, tradeId);
  if (!loaded) throw new Error("trade_not_open");
  await executeSell(db, {
    tradeId,
    userId: loaded.user_id,
    decimals: loaded.decimals,
    openQty: loaded.open_qty,
    pricePerToken,
    reason,
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface PositionView {
  tradeId: string;
  status: string;
  tokenId: string;
  symbol: string;
  contractAddress: string;
  chain: ChainKind;
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

export async function listPositions(
  db: SqlExecutor,
  userId: string,
  status: "OPEN" | "CLOSED" | "ALL" = "OPEN",
): Promise<PositionView[]> {
  const filter = status === "ALL" ? "" : "AND t.status = $2";
  const params: unknown[] = status === "ALL" ? [userId] : [userId, status];
  const res = await db.query<{
    trade_id: string;
    status: string;
    token_id: string;
    symbol: string;
    contract_address: string;
    chain: ChainKind;
    decimals: number;
    open_qty: string;
    avg_entry_price: string | null;
    total_buy_cost: string;
    realized_pnl: string;
    opened_at: string;
    peak_price: string | null;
    last_price: string | null;
    tp_armed: boolean | null;
    trailing_confirmations: number | null;
  }>(
    `SELECT t.trade_id, t.status, t.token_id, tok.symbol, tok.contract_address,
            t.chain, tok.decimals, tp.open_qty, tp.avg_entry_price,
            tp.total_buy_cost, tp.realized_pnl, t.opened_at,
            s.peak_price, s.last_price, s.tp_armed, s.trailing_confirmations
     FROM trades t
     JOIN tokens tok ON tok.token_id = t.token_id
     JOIN trade_positions tp ON tp.trade_id = t.trade_id
     LEFT JOIN trade_strategy_state s ON s.trade_id = t.trade_id
     WHERE t.user_id = $1 AND t.mode = 'PAPER' ${filter}
     ORDER BY t.opened_at DESC`,
    params,
  );
  return res.rows.map((r) => {
    const { marketValue, unrealizedPnl } = computeOpenValues(
      r.open_qty,
      r.last_price,
      r.avg_entry_price,
      Number(r.decimals),
      r.status,
    );
    return {
      tradeId: r.trade_id,
      status: r.status,
      tokenId: r.token_id,
      symbol: r.symbol,
      contractAddress: r.contract_address,
      chain: r.chain,
      openQty: norm(r.open_qty),
      avgEntryPrice: normOrNull(r.avg_entry_price),
      totalBuyCost: norm(r.total_buy_cost),
      highestPrice: normOrNull(r.peak_price),
      lastPrice: normOrNull(r.last_price),
      tpArmed: r.tp_armed ?? false,
      trailingConfirmations: r.trailing_confirmations ?? 0,
      realizedPnl: norm(r.realized_pnl),
      unrealizedPnl,
      marketValue,
      openedAt: r.opened_at,
    };
  });
}

/**
 * Market value and unrealized P&L for the currently-open quantity.
 *   perBase      = lastPrice / 10^decimals
 *   marketValue  = openQty * perBase
 *   unrealized   = marketValue - openQty * avgEntryPerBase
 * All math is exact BigInt; results are decimal strings.
 */
function computeOpenValues(
  openQty: string,
  lastPrice: string | null,
  avgEntryPerBase: string | null,
  decimals: number,
  status: string,
): { marketValue: string; unrealizedPnl: string } {
  if (status !== "OPEN" || openQty === "0" || openQty === "") {
    return { marketValue: "0", unrealizedPnl: "0" };
  }
  const qty = BigInt(openQty);
  if (qty <= 0n) return { marketValue: "0", unrealizedPnl: "0" };

  if (!lastPrice || !avgEntryPerBase) {
    // No mark yet: value at cost, zero unrealized.
    const cost = qty * toScaled(avgEntryPerBase ?? "0");
    return { marketValue: fromScaled(cost), unrealizedPnl: "0" };
  }

  const perBaseScaled = pricePerBaseScaled(lastPrice, decimals);
  const marketValue = qty * perBaseScaled;
  const costBasis = qty * toScaled(avgEntryPerBase);
  return {
    marketValue: fromScaled(marketValue),
    unrealizedPnl: fromScaled(marketValue - costBasis),
  };
}

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

export async function portfolioSummary(
  db: SqlExecutor,
  userId: string,
): Promise<PortfolioSummary> {
  const account = await getOrCreatePaperAccount(db, userId);
  const open = await listPositions(db, userId, "OPEN");
  const closed = await listPositions(db, userId, "CLOSED");

  let positionsValue = 0n;
  let unrealized = 0n;
  for (const p of open) {
    positionsValue += toScaled(p.marketValue);
    unrealized += toScaled(p.unrealizedPnl);
  }
  let realized = 0n;
  for (const c of closed) realized += toScaled(c.realizedPnl);

  const cash = toScaled(account.cashBalance);
  return {
    initialBalance: account.initialBalance,
    cashBalance: account.cashBalance,
    openPositionsValue: fromScaled(positionsValue),
    unrealizedPnl: fromScaled(unrealized),
    realizedPnl: fromScaled(realized),
    equity: fromScaled(cash + positionsValue),
    openCount: open.length,
    closedCount: closed.length,
  };
}

// ---------------------------------------------------------------------------
// The bot loop
// ---------------------------------------------------------------------------

export interface TickResult {
  evaluated: number;
  closed: number;
  skipped: number;
}

/**
 * One bot iteration: fetch a quote for every open paper trade (optionally
 * scoped to one user) and evaluate it. A missing/unavailable quote is skipped,
 * never guessed.
 */
export async function runTick(
  db: SqlExecutor,
  provider: MarketDataProvider,
  userId?: string,
  opts: EvaluateOptions = {},
): Promise<TickResult> {
  const params: unknown[] = userId ? [userId] : [];
  const where = userId ? "AND t.user_id = $1" : "";
  const trades = await db.query<{
    trade_id: string;
    chain: ChainKind;
    contract_address: string;
  }>(
    `SELECT t.trade_id, t.chain, tok.contract_address
     FROM trades t JOIN tokens tok ON tok.token_id = t.token_id
     WHERE t.status = 'OPEN' AND t.mode = 'PAPER' ${where}`,
    params,
  );

  const result: TickResult = { evaluated: 0, closed: 0, skipped: 0 };
  for (const t of trades.rows) {
    const quote = await provider.getQuote({
      chain: t.chain,
      address: t.contract_address,
    });
    if (!quote) {
      result.skipped += 1;
      continue;
    }
    const outcome = await evaluateTrade(db, t.trade_id, quote, opts);
    result.evaluated += 1;
    if (outcome.closed) result.closed += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function wholePriceScaled(perBaseScaled: bigint, decimals: number): bigint {
  return perBaseScaled * 10n ** BigInt(decimals);
}

interface DecisionInput {
  decisionId?: string;
  tradeId: string;
  strategyVersionId: string | null;
  decision: string;
  quoteSource: string;
  marketDataTs: number;
  stateVersion: number;
  reasons: unknown[];
}

async function recordDecision(db: SqlExecutor, d: DecisionInput): Promise<void> {
  await db.query(
    `INSERT INTO decisions
       (decision_id, trade_id, strategy_version_id, decision, market_data_ts,
        quote_source, position_state_version, reasons)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, to_timestamp($5::double precision / 1000), $6, $7, $8::jsonb)`,
    [
      d.decisionId ?? null,
      d.tradeId,
      d.strategyVersionId,
      d.decision,
      d.marketDataTs,
      d.quoteSource,
      d.stateVersion,
      JSON.stringify(d.reasons),
    ],
  );
}

async function recordExitEvaluation(
  db: SqlExecutor,
  tradeId: string,
  strategyVersionId: string | null,
  ev: EvaluationResult["evaluation"],
): Promise<void> {
  await db.query(
    `INSERT INTO exit_evaluations
       (trade_id, strategy_version_id, entry_price, current_price, highest_price,
        tp_armed, trailing_threshold, stop_loss_state, confirmation_count,
        quote_ts, quote_fresh, triggering_rule, result, rejection_reason)
     VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6, $7::numeric, $8, $9,
             to_timestamp($10::double precision / 1000), $11, $12, $13, $14)`,
    [
      tradeId,
      strategyVersionId,
      ev.entryPrice.toString(),
      ev.currentPrice.toString(),
      ev.highestPrice.toString(),
      ev.tpArmed,
      ev.trailingThreshold === null ? null : ev.trailingThreshold.toString(),
      stopLossState(ev),
      ev.confirmationCount,
      ev.marketDataTs,
      ev.quoteFresh,
      ev.triggeringRule,
      ev.action,
      ev.rejectionReason,
    ],
  );
}

function stopLossState(ev: EvaluationResult["evaluation"]): string {
  if (ev.stopLossPrice === null) return "INACTIVE";
  return ev.triggeringRule === "stop_loss" ? "TRIGGERED" : "ACTIVE";
}

/** Double-entry ledger: cash and position accounts move in opposite directions. */
async function recordLedger(
  db: SqlExecutor,
  tradeId: string,
  fillId: string,
  side: "BUY" | "SELL",
  amount: string,
): Promise<void> {
  const cashDirection = side === "BUY" ? "CREDIT" : "DEBIT";
  const posDirection = side === "BUY" ? "DEBIT" : "CREDIT";
  const rows: Array<[string, string]> = [
    [`fill:${fillId}:cash`, cashDirection],
    [`fill:${fillId}:position`, posDirection],
  ];
  for (const [key, direction] of rows) {
    const account = key.endsWith("cash") ? "cash" : "position";
    await db.query(
      `INSERT INTO ledger_entries (trade_id, fill_id, account, direction, amount, asset, idempotency_key)
       VALUES ($1, $2, $3, $4::ledger_direction, $5::numeric, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [tradeId, fillId, account, direction, amount, "USD", key],
    );
  }
}
