/**
 * Export a labeled decision dataset as JSONL, ready for the Python trainer.
 *
 *   npm run export-dataset -w @ghostfx/bot -- --symbol BTCUSDT --total 2000 --out data.jsonl
 *
 * Fetches real historical candles, replays them into CLOSE/HOLD decision rows,
 * and writes one JSON row per line. Stdout is used when --out is omitted.
 */

import { writeFileSync } from "node:fs";
import { fetchKlinesSeries, type KlineInterval } from "../src/market/klines.ts";
import { buildDecisionDataset, datasetToJsonl } from "../src/backtest/index.ts";

function arg(name: string, fallback?: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main(): Promise<void> {
  const symbol = arg("symbol", "BTCUSDT")!;
  const interval = (arg("interval", "1h") ?? "1h") as KlineInterval;
  const total = Number(arg("total", "2000"));
  const horizon = Number(arg("horizon", "24"));
  const lookahead = Number(arg("lookahead", "12"));
  const stride = Number(arg("stride", "1"));
  const out = arg("out");

  const candles = await fetchKlinesSeries(symbol, { interval, total });
  if (candles.length === 0) {
    console.error(`no candles returned for ${symbol} (${interval})`);
    process.exit(1);
  }

  const rows = buildDecisionDataset(candles, {
    horizon,
    lookahead,
    entryStride: stride,
  });
  const closes = rows.filter((r) => r.label === "CLOSE").length;
  const jsonl = datasetToJsonl(rows);
  const summary =
    `[dataset] ${symbol} ${interval}: ${candles.length} candles -> ` +
    `${rows.length} rows (${closes} CLOSE / ${rows.length - closes} HOLD)`;

  if (out) {
    writeFileSync(out, jsonl + "\n");
    console.error(`${summary} -> ${out}`);
  } else {
    console.error(summary);
    console.log(jsonl);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
