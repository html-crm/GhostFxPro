import {
  evaluateAlert,
  type AlertKind,
  type AlertRule as BotAlertRule,
  type MarketDataProvider,
} from "@ghostfx/bot";
import type { SqlExecutor } from "../db.ts";
import { fromScaled, toScaled } from "./decimal.ts";

export type AlertChain = "SOLANA" | "BNB" | "ROBINHOOD";

const CHAINS: readonly AlertChain[] = ["SOLANA", "BNB", "ROBINHOOD"];
const KINDS: readonly AlertKind[] = [
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PCT_MOVE_UP",
  "PCT_MOVE_DOWN",
  "POSITION_OPENED",
  "POSITION_CLOSED",
];
const PRICE_KINDS: readonly AlertKind[] = [
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PCT_MOVE_UP",
  "PCT_MOVE_DOWN",
];

const DEFAULT_MAX_QUOTE_AGE_MS = 15_000;
/** Upper bound on a fractional move so a typo cannot create a dead alert. */
const MAX_PCT = 100;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface AlertView {
  alertId: string;
  kind: AlertKind;
  chain: AlertChain;
  address: string;
  symbol: string;
  threshold: string | null;
  pct: string | null;
  baselinePrice: string | null;
  oneShot: boolean;
  cooldownMs: number;
  isActive: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface AlertEventView {
  eventId: string;
  alertId: string;
  kind: AlertKind;
  symbol: string;
  chain: AlertChain;
  observedValue: string | null;
  threshold: string | null;
  reason: string;
  quoteSource: string | null;
  marketDataTs: string | null;
  firedAt: string;
}

interface AlertRow {
  alert_id: string;
  user_id: string;
  kind: AlertKind;
  chain: AlertChain;
  contract_address: string;
  symbol: string;
  threshold: string | null;
  pct: string | null;
  baseline_price: string | null;
  one_shot: boolean;
  cooldown_ms: number;
  is_active: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

function norm(value: string | null): string | null {
  if (value === null) return null;
  return fromScaled(toScaled(value));
}

function mapAlert(r: AlertRow): AlertView {
  return {
    alertId: r.alert_id,
    kind: r.kind,
    chain: r.chain,
    address: r.contract_address,
    symbol: r.symbol,
    threshold: norm(r.threshold),
    pct: norm(r.pct),
    baselinePrice: norm(r.baseline_price),
    oneShot: r.one_shot,
    cooldownMs: Number(r.cooldown_ms),
    isActive: r.is_active,
    lastTriggeredAt: r.last_triggered_at,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export interface AlertInput {
  kind: AlertKind;
  chain: AlertChain;
  address: string;
  symbol: string;
  threshold?: string;
  pct?: string;
  baselinePrice?: string;
  oneShot?: boolean;
  cooldownMs?: number;
}

function positiveDecimalString(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`invalid_${field}`);
  }
  const trimmed = typeof value === "number" ? String(value) : value.trim();
  if (!trimmed) throw new Error(`invalid_${field}`);
  const scaled = toScaled(trimmed); // throws if not a decimal
  if (scaled <= 0n) throw new Error(`invalid_${field}`);
  return fromScaled(scaled);
}

function pctFraction(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("invalid_pct");
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PCT) throw new Error("invalid_pct");
  return String(n);
}

export function validateAlertInput(raw: unknown): AlertInput {
  const b = raw as Partial<AlertInput> | undefined;
  if (!b || typeof b !== "object") throw new Error("invalid_alert");
  if (!KINDS.includes(b.kind as AlertKind)) throw new Error("invalid_kind");
  if (!CHAINS.includes(b.chain as AlertChain)) throw new Error("invalid_chain");
  const address = (b.address ?? "").trim();
  const symbol = (b.symbol ?? "").trim();
  if (!address) throw new Error("invalid_address");
  if (!symbol) throw new Error("invalid_symbol");

  const oneShot = b.oneShot === undefined ? true : Boolean(b.oneShot);
  const cooldownMs =
    b.cooldownMs === undefined || b.cooldownMs === null
      ? 0
      : Number(b.cooldownMs);
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) {
    throw new Error("invalid_cooldown");
  }

  const kind = b.kind as AlertKind;
  const needsThreshold = kind === "PRICE_ABOVE" || kind === "PRICE_BELOW";
  const needsPct = kind === "PCT_MOVE_UP" || kind === "PCT_MOVE_DOWN";

  let threshold: string | undefined;
  if (needsThreshold) {
    threshold = positiveDecimalString(b.threshold, "threshold");
  }
  let pct: string | undefined;
  if (needsPct) {
    pct = pctFraction(b.pct);
  }
  let baselinePrice: string | undefined;
  if (b.baselinePrice !== undefined && b.baselinePrice !== null && b.baselinePrice !== "") {
    baselinePrice = positiveDecimalString(b.baselinePrice, "baseline");
  }

  return {
    kind,
    chain: b.chain as AlertChain,
    address,
    symbol,
    ...(threshold !== undefined ? { threshold } : {}),
    ...(pct !== undefined ? { pct } : {}),
    ...(baselinePrice !== undefined ? { baselinePrice } : {}),
    oneShot,
    cooldownMs,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createAlert(
  db: SqlExecutor,
  userId: string,
  input: AlertInput,
  provider?: MarketDataProvider,
): Promise<AlertView> {
  // PCT_MOVE alerts need a baseline. Default it to the current market price
  // so the user does not have to know it; fall back to an explicit value.
  let baseline = input.baselinePrice ?? null;
  if ((input.kind === "PCT_MOVE_UP" || input.kind === "PCT_MOVE_DOWN") && !baseline) {
    const quote = await provider?.getQuote({
      chain: input.chain,
      address: input.address,
    });
    if (quote && Number.isFinite(quote.price)) {
      baseline = String(quote.price);
    }
  }

  const res = await db.query<{ alert_id: string }>(
    `INSERT INTO alert_rules
       (user_id, kind, chain, contract_address, symbol, threshold, pct,
        baseline_price, one_shot, cooldown_ms)
     VALUES ($1, $2::alert_kind, $3::chain_kind, $4, $5, $6::numeric, $7::numeric,
             $8::numeric, $9, $10)
     RETURNING alert_id`,
    [
      userId,
      input.kind,
      input.chain,
      input.address,
      input.symbol,
      input.threshold ?? null,
      input.pct ?? null,
      baseline,
      input.oneShot,
      input.cooldownMs,
    ],
  );
  const alertId = res.rows[0]!.alert_id;
  return (await getAlert(db, userId, alertId))!;
}

export async function getAlert(
  db: SqlExecutor,
  userId: string,
  alertId: string,
): Promise<AlertView | null> {
  const res = await db.query<AlertRow>(
    `SELECT * FROM alert_rules WHERE alert_id = $1 AND user_id = $2`,
    [alertId, userId],
  );
  return res.rows[0] ? mapAlert(res.rows[0]) : null;
}

export async function listAlerts(
  db: SqlExecutor,
  userId: string,
): Promise<AlertView[]> {
  const res = await db.query<AlertRow>(
    `SELECT * FROM alert_rules WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return res.rows.map(mapAlert);
}

export interface AlertUpdate {
  isActive?: boolean;
  threshold?: string;
  pct?: string;
  baselinePrice?: string;
  oneShot?: boolean;
  cooldownMs?: number;
}

export async function updateAlert(
  db: SqlExecutor,
  userId: string,
  alertId: string,
  patch: AlertUpdate,
): Promise<AlertView | null> {
  const existing = await getAlert(db, userId, alertId);
  if (!existing) return null;

  const threshold =
    patch.threshold !== undefined
      ? positiveDecimalString(patch.threshold, "threshold")
      : existing.threshold;
  const pct =
    patch.pct !== undefined ? pctFraction(patch.pct) : existing.pct;
  const baselinePrice =
    patch.baselinePrice !== undefined
      ? positiveDecimalString(patch.baselinePrice, "baseline")
      : existing.baselinePrice;
  const isActive = patch.isActive ?? existing.isActive;
  const oneShot = patch.oneShot ?? existing.oneShot;
  const cooldownMs =
    patch.cooldownMs !== undefined ? Number(patch.cooldownMs) : existing.cooldownMs;
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) {
    throw new Error("invalid_cooldown");
  }

  await db.query(
    `UPDATE alert_rules
     SET threshold = $3::numeric, pct = $4::numeric, baseline_price = $5::numeric,
         is_active = $6, one_shot = $7, cooldown_ms = $8, updated_at = now()
     WHERE alert_id = $1 AND user_id = $2`,
    [alertId, userId, threshold, pct, baselinePrice, isActive, oneShot, cooldownMs],
  );
  return getAlert(db, userId, alertId);
}

export async function deleteAlert(
  db: SqlExecutor,
  userId: string,
  alertId: string,
): Promise<boolean> {
  const res = await db.query(
    `DELETE FROM alert_rules WHERE alert_id = $1 AND user_id = $2 RETURNING alert_id`,
    [alertId, userId],
  );
  return res.rows.length === 1;
}

export async function listAlertEvents(
  db: SqlExecutor,
  userId: string,
  limit = 50,
): Promise<AlertEventView[]> {
  const capped = Math.max(1, Math.min(limit, 200));
  const res = await db.query<{
    event_id: string;
    alert_id: string;
    kind: AlertKind;
    symbol: string;
    chain: AlertChain;
    observed_value: string | null;
    threshold: string | null;
    reason: string;
    quote_source: string | null;
    market_data_ts: string | null;
    fired_at: string;
  }>(
    `SELECT e.event_id, e.alert_id, e.kind, a.symbol, a.chain,
            e.observed_value, e.threshold, e.reason, e.quote_source,
            to_char(e.market_data_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS market_data_ts,
            e.fired_at
     FROM alert_events e
     JOIN alert_rules a ON a.alert_id = e.alert_id
     WHERE e.user_id = $1
     ORDER BY e.fired_at DESC
     LIMIT $2`,
    [userId, capped],
  );
  return res.rows.map((r) => ({
    eventId: r.event_id,
    alertId: r.alert_id,
    kind: r.kind,
    symbol: r.symbol,
    chain: r.chain,
    observedValue: norm(r.observed_value),
    threshold: norm(r.threshold),
    reason: r.reason,
    quoteSource: r.quote_source,
    marketDataTs: r.market_data_ts,
    firedAt: r.fired_at,
  }));
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

interface RecordEventInput {
  alertId: string;
  userId: string;
  kind: AlertKind;
  observedValue: number | null;
  threshold: number | null;
  reason: string;
  quoteSource: string | null;
  marketDataTs: number | null;
  oneShot: boolean;
}

async function recordEventAndAdvance(
  db: SqlExecutor,
  input: RecordEventInput,
): Promise<void> {
  await db.query(
    `INSERT INTO alert_events
       (alert_id, user_id, kind, observed_value, threshold, reason, quote_source, market_data_ts)
     VALUES ($1, $2, $3::alert_kind, $4::numeric, $5::numeric, $6, $7,
             CASE WHEN $8::bigint IS NULL THEN NULL ELSE to_timestamp($8::double precision / 1000) END)`,
    [
      input.alertId,
      input.userId,
      input.kind,
      input.observedValue === null ? null : input.observedValue.toString(),
      input.threshold === null ? null : input.threshold.toString(),
      input.reason,
      input.quoteSource,
      input.marketDataTs,
    ],
  );
  // A one-shot alert disarms after firing so it does not spam events.
  await db.query(
    `UPDATE alert_rules
     SET last_triggered_at = now(),
         is_active = CASE WHEN $2 THEN false ELSE is_active END,
         updated_at = now()
     WHERE alert_id = $1`,
    [input.alertId, input.oneShot],
  );
}

function withinCooldown(lastTriggeredAt: string | null, cooldownMs: number, now: number): boolean {
  if (!lastTriggeredAt || cooldownMs <= 0) return false;
  const last = Date.parse(lastTriggeredAt);
  if (Number.isNaN(last)) return false;
  return now - last < cooldownMs;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates every active *price* alert (optionally scoped to one user) against
 * the live market and records any that fire. Returns how many fired.
 *
 * Alerts are passive: a firing alert only writes an event row. It never places
 * an order or changes a position.
 */
export async function evaluateAlerts(
  db: SqlExecutor,
  provider: MarketDataProvider,
  userId?: string,
  now: number = Date.now(),
): Promise<number> {
  const params: unknown[] = userId ? [userId] : [];
  const where = userId ? "AND a.user_id = $1" : "";
  const res = await db.query<AlertRow>(
    `SELECT a.* FROM alert_rules a
     WHERE a.is_active = true
       AND a.kind IN ('PRICE_ABOVE','PRICE_BELOW','PCT_MOVE_UP','PCT_MOVE_DOWN')
       ${where}`,
    params,
  );

  let fired = 0;
  for (const row of res.rows) {
    if (withinCooldown(row.last_triggered_at, Number(row.cooldown_ms), now)) {
      continue;
    }
    const quote = await provider.getQuote({
      chain: row.chain,
      address: row.contract_address,
    });
    if (!quote) continue;

    const rule: BotAlertRule = {
      kind: row.kind,
      threshold: row.threshold === null ? null : Number(row.threshold),
      // Stored as a percentage (e.g. "5"); the evaluator works in fractions.
      pct: row.pct === null ? null : Number(row.pct) / 100,
    };
    const outcome = evaluateAlert(rule, {
      price: quote.price,
      baselinePrice: row.baseline_price === null ? null : Number(row.baseline_price),
    });
    if (!outcome.triggered) continue;

    await recordEventAndAdvance(db, {
      alertId: row.alert_id,
      userId: row.user_id,
      kind: row.kind,
      observedValue: outcome.observed,
      threshold: rule.threshold,
      reason: outcome.reason ?? "triggered",
      quoteSource: quote.source,
      marketDataTs: quote.ts,
      oneShot: row.one_shot,
    });
    fired += 1;
  }
  return fired;
}

/**
 * Fires any active position-event alerts (POSITION_OPENED / POSITION_CLOSED)
 * for the trade's token. Called from the paper engine on open and on close.
 */
export async function firePositionAlerts(
  db: SqlExecutor,
  args: {
    userId: string;
    tradeId: string;
    kind: Extract<AlertKind, "POSITION_OPENED" | "POSITION_CLOSED">;
    now?: number;
  },
): Promise<number> {
  const now = args.now ?? Date.now();
  const token = await db.query<{ chain: AlertChain; contract_address: string }>(
    `SELECT t.chain, tok.contract_address
     FROM trades t JOIN tokens tok ON tok.token_id = t.token_id
     WHERE t.trade_id = $1 AND t.user_id = $2`,
    [args.tradeId, args.userId],
  );
  const row = token.rows[0];
  if (!row) return 0;

  const res = await db.query<AlertRow>(
    `SELECT * FROM alert_rules
     WHERE user_id = $1 AND is_active = true AND chain = $2::chain_kind
       AND contract_address = $3 AND kind = $4::alert_kind`,
    [args.userId, row.chain, row.contract_address, args.kind],
  );

  let fired = 0;
  for (const alert of res.rows) {
    if (withinCooldown(alert.last_triggered_at, Number(alert.cooldown_ms), now)) {
      continue;
    }
    await recordEventAndAdvance(db, {
      alertId: alert.alert_id,
      userId: args.userId,
      kind: alert.kind,
      observedValue: null,
      threshold: null,
      reason: `position ${args.kind === "POSITION_OPENED" ? "opened" : "closed"}`,
      quoteSource: "paper",
      marketDataTs: now,
      oneShot: alert.one_shot,
    });
    fired += 1;
  }
  return fired;
}

export { DEFAULT_MAX_QUOTE_AGE_MS, PRICE_KINDS };
