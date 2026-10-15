/**
 * Strategy configuration comparison ("comparison report").
 *
 * Activating a new strategy version can change real trading behaviour, so a
 * change must be explainable before it takes effect. This module turns a
 * before/after config pair into a list of field-level changes, each with a
 * plain-language statement of the behavioural impact, plus the strategy's
 * explicit rule precedence.
 *
 * Pure: no I/O, no DB, no clock. Given the same configs it returns the same
 * report, so it can be unit-tested and rendered identically anywhere.
 */

import { FLEXI_RULES, type StrategyRule } from "./registry.ts";
import type { FlexiConfig } from "./types.ts";
import type { StrategyKind } from "./registry.ts";

export type FlexiConfigKey = keyof FlexiConfig;

export interface ConfigChange {
  key: FlexiConfigKey;
  /** Human-readable name of the field. */
  label: string;
  /** Value before (fractions for percentages; null for a disabled stop). */
  before: number | null;
  /** Value after. */
  after: number | null;
  changed: boolean;
  /** Plain-language description of the behavioural impact. */
  impact: string;
}

export interface ConfigComparison {
  kind: StrategyKind;
  changes: ConfigChange[];
  hasChanges: boolean;
  /** Rules in priority order — precedence is explicit, never implicit. */
  precedence: readonly StrategyRule[];
}

const FIELDS: readonly {
  key: FlexiConfigKey;
  label: string;
}[] = [
  { key: "takeProfitArmPct", label: "Take-profit arm" },
  { key: "trailingPercent", label: "Trailing distance" },
  { key: "trailingConfirmations", label: "Trailing confirmations" },
  { key: "stopLossPct", label: "Stop-loss" },
];

const DEFAULT_KIND: StrategyKind = "FLEXI";

function pct(value: number): string {
  return `${Number((value * 100).toFixed(6))}%`;
}

function impact(key: FlexiConfigKey, before: number | null, after: number | null): string {
  switch (key) {
    case "takeProfitArmPct": {
      const dir = (after ?? 0) > (before ?? 0) ? "later" : "earlier";
      return `Trailing is armed ${dir} (${pct(after!)} vs ${pct(before!)}): the position needs a ${
        (after ?? 0) > (before ?? 0) ? "larger" : "smaller"
      } gain before a trailing exit becomes possible.`;
    }
    case "trailingPercent": {
      const dir = (after ?? 0) > (before ?? 0) ? "deeper" : "tighter";
      return `Trailing exit allows a ${dir} pullback (${pct(after!)} vs ${pct(before!)}): the position ${
        (after ?? 0) > (before ?? 0) ? "holds longer before exiting" : "exits sooner after a peak"
      }.`;
    }
    case "trailingConfirmations": {
      const dir = (after ?? 0) > (before ?? 0) ? "more" : "fewer";
      return `Trailing exit requires ${dir} confirmations (${after} vs ${before}): exits are ${
        (after ?? 0) > (before ?? 0) ? "slower to confirm" : "quicker to confirm"
      }.`;
    }
    case "stopLossPct": {
      if (before === null && after !== null) {
        return `Adds a hard stop-loss at −${pct(after)} (downside is now bounded by a stop).`;
      }
      if (before !== null && after === null) {
        return "Removes the hard stop-loss (downside is no longer bounded by a stop).";
      }
      const dir = (after ?? 0) > (before ?? 0) ? "loosened" : "tightened";
      return `Stop-loss ${dir} to −${pct(after!)} (vs −${pct(before!)}).`;
    }
  }
}

/**
 * Compares two FLEXI configs and returns a report. `hasChanges` is false when
 * the two configs are behaviourally identical.
 */
export function compareFlexiConfig(
  before: FlexiConfig,
  after: FlexiConfig,
): ConfigComparison {
  const changes: ConfigChange[] = FIELDS.map(({ key, label }) => {
    const b = before[key];
    const a = after[key];
    const changed = b !== a;
    return {
      key,
      label,
      before: b,
      after: a,
      changed,
      impact: changed ? impact(key, b, a) : "No change.",
    };
  });
  return {
    kind: DEFAULT_KIND,
    changes,
    hasChanges: changes.some((c) => c.changed),
    precedence: FLEXI_RULES,
  };
}
