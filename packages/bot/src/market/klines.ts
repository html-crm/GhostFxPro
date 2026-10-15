/**
 * Historical price data (OHLCV candles).
 *
 * The paper engine observes prices one poll at a time, which is great for
 * live forward-testing but useless for training: you cannot replay months of
 * market history from a "current price" endpoint. This module fetches real
 * historical candles from Binance's **public** spot REST API
 * (`/api/v3/klines`), which needs no API key and no account.
 *
 * Read-only: it fetches market history and never places an order, never signs
 * a request, and never invents a value. Malformed rows are dropped rather than
 * guessed at.
 */

import type { FetchLike } from "./types.ts";

const DEFAULT_BASE = "https://api.binance.com";
const MAX_LIMIT = 1000; // Binance hard cap per klines request.

export type KlineInterval =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d"
  | "1w";

/** One OHLCV candle. All prices are in the pair's quote asset. */
export interface Candle {
  /** Candle open time, epoch ms. */
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Candle close time, epoch ms. */
  closeTime: number;
}

export interface KlinesOptions {
  interval?: KlineInterval;
  /** Number of candles (max 1000 per request; use fetchKlinesSeries for more). */
  limit?: number;
  startTime?: number;
  endTime?: number;
  /** Override the API host (e.g. a testnet mirror). */
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface KlinesSeriesOptions extends Omit<KlinesOptions, "limit"> {
  /** Total candles desired; the series pages until it reaches this or runs dry. */
  total: number;
  /** Candles per request (clamped to 1..1000). Default 1000. */
  pageSize?: number;
}

/**
 * Fetches one page of candles. Returns `[]` on any error (bad symbol, network,
 * non-200) so a caller never receives a half-built or invented series.
 */
export async function fetchKlines(
  symbol: string,
  opts: KlinesOptions = {},
): Promise<Candle[]> {
  const sym = (symbol ?? "").trim().toUpperCase();
  if (!sym) return [];

  const interval = opts.interval ?? "1h";
  const limit = clamp(opts.limit ?? MAX_LIMIT, 1, MAX_LIMIT);
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const params = new URLSearchParams({
    symbol: sym,
    interval,
    limit: String(limit),
  });
  if (opts.startTime !== undefined) params.set("startTime", String(opts.startTime));
  if (opts.endTime !== undefined) params.set("endTime", String(opts.endTime));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/api/v3/klines?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    return parseKlines(body);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches more than one page by walking forward from each page's last close
 * time. Stops when `total` is reached, when the source stops returning full
 * pages, or when a page comes back empty. Capped at `total` to avoid a runaway
 * loop.
 */
export async function fetchKlinesSeries(
  symbol: string,
  opts: KlinesSeriesOptions,
): Promise<Candle[]> {
  const pageSize = clamp(opts.pageSize ?? MAX_LIMIT, 1, MAX_LIMIT);
  const total = Math.max(0, Math.floor(opts.total));
  if (total === 0) return [];

  const out: Candle[] = [];
  let startTime = opts.startTime;
  let guard = 0;
  const maxPages = Math.ceil(total / pageSize) + 2;

  while (out.length < total && guard < maxPages) {
    guard += 1;
    const page = await fetchKlines(symbol, {
      interval: opts.interval,
      startTime,
      endTime: opts.endTime,
      limit: pageSize,
      baseUrl: opts.baseUrl,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
    if (page.length === 0) break;
    out.push(...page);
    if (page.length < pageSize) break;
    startTime = page[page.length - 1]!.closeTime + 1;
  }

  return out.slice(0, total);
}

/**
 * Parses a raw Binance klines payload (an array of fixed-shape rows) into
 * candles. Every row is validated; any row with a non-finite or non-positive
 * price is dropped. Order is preserved.
 */
export function parseKlines(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const openTime = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    const closeTime = Number(row[6]);
    const ok =
      Number.isFinite(openTime) &&
      Number.isFinite(closeTime) &&
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close) &&
      Number.isFinite(volume) &&
      open > 0 &&
      high > 0 &&
      low > 0 &&
      close > 0;
    if (!ok) continue;
    out.push({ openTime, open, high, low, close, volume, closeTime });
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}
