import { test } from "node:test";
import assert from "node:assert/strict";
import { compareFlexiConfig } from "../src/strategy/compare.ts";
import { FLEXI_DEFAULT_CONFIG, FLEXI_RULES, normalizeConfig } from "../src/strategy/registry.ts";
import type { FlexiConfig } from "../src/strategy/types.ts";

const BASE: FlexiConfig = FLEXI_DEFAULT_CONFIG;

test("no change is reported when configs are identical", () => {
  const c = compareFlexiConfig(BASE, { ...BASE });
  assert.equal(c.hasChanges, false);
  assert.equal(c.kind, "FLEXI");
  assert.equal(c.changes.length, 4);
  assert.ok(c.changes.every((ch) => ch.changed === false));
});

test("a raised take-profit arm reports a later arm and larger gain", () => {
  const c = compareFlexiConfig(BASE, { ...BASE, takeProfitArmPct: 0.1 });
  assert.equal(c.hasChanges, true);
  const ch = c.changes.find((x) => x.key === "takeProfitArmPct")!;
  assert.equal(ch.changed, true);
  assert.equal(ch.before, 0.07);
  assert.equal(ch.after, 0.1);
  assert.match(ch.impact, /armed later/);
});

test("a deeper trailing distance reports holding longer", () => {
  const c = compareFlexiConfig(BASE, { ...BASE, trailingPercent: 0.05 });
  const ch = c.changes.find((x) => x.key === "trailingPercent")!;
  assert.equal(ch.changed, true);
  assert.match(ch.impact, /deeper pullback/);
});

test("more confirmations report slower exits", () => {
  const c = compareFlexiConfig(BASE, { ...BASE, trailingConfirmations: 3 });
  const ch = c.changes.find((x) => x.key === "trailingConfirmations")!;
  assert.equal(ch.changed, true);
  assert.match(ch.impact, /more confirmations/);
});

test("enabling a stop-loss reports a bounded downside", () => {
  const c = compareFlexiConfig(BASE, { ...BASE, stopLossPct: 0.1 });
  const ch = c.changes.find((x) => x.key === "stopLossPct")!;
  assert.equal(ch.changed, true);
  assert.equal(ch.before, null);
  assert.equal(ch.after, 0.1);
  assert.match(ch.impact, /Adds a hard stop-loss/);
});

test("removing a stop-loss reports an unbounded downside", () => {
  const c = compareFlexiConfig({ ...BASE, stopLossPct: 0.1 }, BASE);
  const ch = c.changes.find((x) => x.key === "stopLossPct")!;
  assert.equal(ch.changed, true);
  assert.equal(ch.after, null);
  assert.match(ch.impact, /Removes the hard stop-loss/);
});

test("exposes the FLEXI rule precedence in priority order", () => {
  const c = compareFlexiConfig(BASE, BASE);
  assert.deepEqual(
    c.precedence.map((r) => r.id),
    ["stop_loss", "take_profit_arm", "trailing_exit"],
  );
  assert.deepEqual(
    c.precedence.map((r) => r.priority),
    [1, 2, 3],
  );
  assert.equal(FLEXI_RULES.length, 3);
});

test("normalizeConfig drops unknown keys and coerces numeric strings", () => {
  const raw: Record<string, unknown> = {
    takeProfitArmPct: "0.05",
    trailingPercent: 0.03,
    trailingConfirmations: "3",
    stopLossPct: null,
    junk: 123,
  };
  const cfg = normalizeConfig(raw);
  assert.deepEqual(cfg, {
    takeProfitArmPct: 0.05,
    trailingPercent: 0.03,
    trailingConfirmations: 3,
    stopLossPct: null,
  });
  assert.equal("junk" in cfg, false);
});

test("normalizeConfig rejects out-of-range fractions", () => {
  assert.throws(() => normalizeConfig({ takeProfitArmPct: 1 }));
  assert.throws(() => normalizeConfig({ trailingPercent: 0 }));
  assert.throws(() => normalizeConfig({ trailingConfirmations: 0 }));
  assert.throws(() => normalizeConfig({ stopLossPct: 1.5 }));
});
