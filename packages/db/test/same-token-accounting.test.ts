import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../src/migrate.ts";
import {
  freshDb,
  seed,
  createTrade,
  insertFill,
  getPosition,
  count,
  type SeedIds,
  type PositionRow,
} from "./helpers.ts";

/** Normalise a Postgres numeric text to a canonical decimal for exact compare. */
function dec(s: string | null): string {
  assert.notEqual(s, null);
  let t = (s as string).trim();
  if (t.includes(".")) t = t.replace(/0+$/, "").replace(/\.$/, "");
  if (t === "-0" || t === "") t = "0";
  return t;
}

/**
 * MANDATORY REGRESSION (brief Part 2.1 / Part 7.1-7.4):
 * Three trades in the SAME token must keep independent entry price, quantity,
 * fills, fees and P&L - including a concurrent trade and after restart.
 */
describe("same-token trade accounting isolation", () => {
  let db: PGlite;
  let ids: SeedIds;
  let tradeA: string;
  let tradeB: string;
  let tradeC: string;

  before(async () => {
    db = await freshDb();
    ids = await seed(db);

    tradeA = await createTrade(db, ids, "A: single buy, partial sell");
    tradeB = await createTrade(db, ids, "B: different buy amount, no sell");
    tradeC = await createTrade(db, ids, "C: concurrent trade, full round-trip");

    // Trade A: buy 1000 @ 1.00, then sell 400 @ 3.00
    await insertFill(db, { tradeId: tradeA, side: "BUY", qty: "1000", price: "1.00", idempotencyKey: "A-buy-1" });
    await insertFill(db, { tradeId: tradeA, side: "SELL", qty: "400", price: "3.00", idempotencyKey: "A-sell-1" });

    // Trade B: buy 500 @ 2.00, no sell (cost also 1000 -> same cost, diff qty/price)
    await insertFill(db, { tradeId: tradeB, side: "BUY", qty: "500", price: "2.00", idempotencyKey: "B-buy-1" });

    // Trade C: buy 2000 @ 0.50, sell 2000 @ 0.75 with 10 quote fee
    await insertFill(db, { tradeId: tradeC, side: "BUY", qty: "2000", price: "0.50", idempotencyKey: "C-buy-1" });
    await insertFill(db, { tradeId: tradeC, side: "SELL", qty: "2000", price: "0.75", feeQuote: "10", idempotencyKey: "C-sell-1" });
  });

  after(async () => {
    await db.close();
  });

  test("all three trades share one token (regression precondition)", async () => {
    const res = await db.query<{ token_id: string }>(
      `SELECT DISTINCT token_id FROM trades`,
    );
    assert.equal(res.rows.length, 1, "all trades must use the same token");
  });

  test("each trade has its own entry price", async () => {
    const [a, b, c] = await Promise.all([
      getPosition(db, tradeA),
      getPosition(db, tradeB),
      getPosition(db, tradeC),
    ]);
    assert.equal(dec(a.avg_entry_price), "1");
    assert.equal(dec(b.avg_entry_price), "2");
    assert.equal(dec(c.avg_entry_price), "0.5");
  });

  test("each trade has the correct quantity", async () => {
    const [a, b, c] = await Promise.all([
      getPosition(db, tradeA),
      getPosition(db, tradeB),
      getPosition(db, tradeC),
    ]);
    assert.equal(dec(a.bought_qty), "1000");
    assert.equal(dec(b.bought_qty), "500");
    assert.equal(dec(c.bought_qty), "2000");
    assert.equal(dec(a.open_qty), "600");
    assert.equal(dec(b.open_qty), "500");
    assert.equal(dec(c.open_qty), "0");
  });

  test("each trade shows only its own sell fills", async () => {
    const [a, b, c] = await Promise.all([
      getPosition(db, tradeA),
      getPosition(db, tradeB),
      getPosition(db, tradeC),
    ]);
    assert.equal(dec(a.sold_qty), "400");
    assert.equal(dec(b.sold_qty), "0");
    assert.equal(dec(c.sold_qty), "2000");
  });

  test("realized P&L is independently calculated per trade", async () => {
    const [a, b, c] = await Promise.all([
      getPosition(db, tradeA),
      getPosition(db, tradeB),
      getPosition(db, tradeC),
    ]);
    // A: 400*3 - 0 - 1*400                 = 800
    // B: no sells                           = 0
    // C: 2000*0.75 - 10 - 0.5*2000          = 490
    assert.equal(dec(a.realized_pnl), "800");
    assert.equal(dec(b.realized_pnl), "0");
    assert.equal(dec(c.realized_pnl), "490");
  });

  test("no cross-trade contamination even when total cost is identical", async () => {
    const [a, b, c] = await Promise.all([
      getPosition(db, tradeA),
      getPosition(db, tradeB),
      getPosition(db, tradeC),
    ]);
    // All three bought for a total cost of exactly 1000 quote, yet differ.
    assert.equal(dec(a.total_buy_cost), "1000");
    assert.equal(dec(b.total_buy_cost), "1000");
    assert.equal(dec(c.total_buy_cost), "1000");
    assert.notEqual(dec(a.avg_entry_price), dec(b.avg_entry_price));
    assert.notEqual(dec(a.realized_pnl), dec(c.realized_pnl));
  });

  test("money math is exact decimal, not binary float", async () => {
    const t = await createTrade(db, ids, "exactness");
    await insertFill(db, { tradeId: t, side: "BUY", qty: "3", price: "0.1", idempotencyKey: "exact-buy" });
    const pos = await getPosition(db, t);
    // float would give 0.30000000000000004
    assert.equal(pos.total_buy_cost, "0.300000000000000000");
    assert.equal(Number(pos.total_buy_cost), 0.3);
  });

  test("replaying a fill event does not duplicate it or change attribution", async () => {
    const before = await count(db, "fills");
    const beforePos = await getPosition(db, tradeA);
    await assert.rejects(
      () =>
        insertFill(db, {
          tradeId: tradeA,
          side: "BUY",
          qty: "1000",
          price: "1.00",
          idempotencyKey: "A-buy-1", // same idempotency key = replay
        }),
      /duplicate key|unique/i,
    );
    assert.equal(await count(db, "fills"), before, "fill count must be unchanged");
    const afterPos = await getPosition(db, tradeA);
    assert.deepEqual(afterPos, beforePos, "attribution must be unchanged after replay");
  });

  test("the same on-chain transaction cannot be ingested twice", async () => {
    const t1 = await createTrade(db, ids, "sig-owner-1");
    const t2 = await createTrade(db, ids, "sig-owner-2");
    await insertFill(db, {
      tradeId: t1,
      side: "BUY",
      qty: "1",
      price: "1",
      idempotencyKey: "sig-1",
      txSignature: "0xSIGUNIQUE1",
    });
    await assert.rejects(
      () =>
        insertFill(db, {
          tradeId: t2,
          side: "BUY",
          qty: "1",
          price: "1",
          idempotencyKey: "sig-2",
          txSignature: "0xSIGUNIQUE1", // same tx signature
        }),
      /duplicate key|unique/i,
    );
  });

  test("trade identity is immutable", async () => {
    const other = await createTrade(db, ids, "other");
    const otherTokenRow = await db.query<{ token_id: string }>(
      `INSERT INTO tokens (chain, contract_address, symbol, name, decimals)
       VALUES ('SOLANA', 'SoLTokenOther', 'OTHER', 'Other', 9) RETURNING token_id`,
    );
    const otherToken = otherTokenRow.rows[0]!.token_id;
    await assert.rejects(
      () => db.query(`UPDATE trades SET token_id = $1 WHERE trade_id = $2`, [otherToken, tradeA]),
      /immutable/i,
    );
    assert.notEqual(other, tradeA);
  });

  test("ambiguous legacy records stay flagged and unattributed", async () => {
    await db.query(
      `INSERT INTO legacy_import_fills
         (trade_id, token_symbol, token_contract, wallet_address, side, qty_base_units, price_quote)
       VALUES (NULL, 'PEPE', '0xTOKENPEPE', '0xUNKNOWN', 'BUY', 123, 0.9)`,
    );
    const flagged = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM legacy_import_fills
       WHERE needs_reconciliation = true AND trade_id IS NULL`,
    );
    assert.equal(flagged.rows[0]!.n, "1");
    // It is NOT visible in the accounting view - no silent reassignment.
    assert.equal(await count(db, "trade_positions"), await count(db, "trades"));
  });

  test("evidence snapshot", async () => {
    const rows: PositionRow[] = await Promise.all([
      getPosition(db, tradeA),
      getPosition(db, tradeB),
      getPosition(db, tradeC),
    ]);
    const summary = rows.map((r) => ({
      trade_id: r.trade_id.slice(0, 8),
      avg_entry: dec(r.avg_entry_price),
      bought: dec(r.bought_qty),
      sold: dec(r.sold_qty),
      open: dec(r.open_qty),
      realized_pnl: dec(r.realized_pnl),
    }));
    console.log("\n  same-token isolation snapshot:\n" + JSON.stringify(summary, null, 2) + "\n");
    assert.equal(new Set(summary.map((s) => s.avg_entry)).size, 3);
  });
});

describe("persistence across restart and replay", () => {
  test("accounting survives a full database restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ghostfx-"));
    try {
      // Session 1: create schema + trades + fills.
      const db1 = new PGlite(dir);
      await migrate(db1);
      const ids = await seed(db1);
      const tA = await createTrade(db1, ids, "persist-A");
      await insertFill(db1, { tradeId: tA, side: "BUY", qty: "1000", price: "1.25", idempotencyKey: "pA-buy" });
      await insertFill(db1, { tradeId: tA, side: "SELL", qty: "250", price: "2.00", idempotencyKey: "pA-sell" });
      const before = await getPosition(db1, tA);
      await db1.close();

      // Session 2: reopen the same data directory.
      const db2 = new PGlite(dir);
      const after = await getPosition(db2, tA);
      await db2.close();

      assert.deepEqual(after, before);
      assert.equal(dec(after.avg_entry_price), "1.25");
      assert.equal(dec(after.realized_pnl), "187.5"); // 250*2 - 1.25*250
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
