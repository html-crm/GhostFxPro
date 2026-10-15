/**
 * Alert-rule evaluation.
 *
 * Alerts are passive observations. They are **never** allowed to place an
 * order, move funds, or alter a position. They only record that a configured
 * condition became true, and surface it to the user.
 *
 * Evaluation is pure so it can be unit-tested without a database or network.
 * Price magnitudes are display/decision numbers derived from validated market
 * data (same convention as {@link Quote.price}); the durable record of an
 * alert firing is written by the caller as an `alert_events` row.
 */

/** The kinds of alert a user can configure. */
export type AlertKind =
  | "PRICE_ABOVE"
  | "PRICE_BELOW"
  | "PCT_MOVE_UP"
  | "PCT_MOVE_DOWN"
  | "POSITION_OPENED"
  | "POSITION_CLOSED";

/** A configured rule. Identity/ownership live in the database. */
export interface AlertRule {
  kind: AlertKind;
  /** Trigger price for PRICE_ABOVE / PRICE_BELOW. Null otherwise. */
  threshold: number | null;
  /** Fractional move for PCT_MOVE_* (e.g. 0.05 == 5%). Null otherwise. */
  pct: number | null;
}

/** The market observation an alert is evaluated against. */
export interface AlertObservation {
  /** Current observed price. */
  price: number;
  /** Baseline price for PCT_MOVE_*; null when unknown. */
  baselinePrice: number | null;
}

export interface AlertOutcome {
  triggered: boolean;
  /** Human-readable reason when triggered; null otherwise. */
  reason: string | null;
  /** The observed price; null when there is no valid observation. */
  observed: number | null;
}

/** True when the rule is driven by a price observation (vs. a trade event). */
export function isPriceAlert(kind: AlertKind): boolean {
  return (
    kind === "PRICE_ABOVE" ||
    kind === "PRICE_BELOW" ||
    kind === "PCT_MOVE_UP" ||
    kind === "PCT_MOVE_DOWN"
  );
}

function notTriggered(observed: number | null): AlertOutcome {
  return { triggered: false, reason: null, observed };
}

function triggered(reason: string, observed: number): AlertOutcome {
  return { triggered: true, reason, observed };
}

/**
 * Evaluates a single rule against an observation.
 *
 * Rules that cannot be decided from a price (POSITION_*) or that are missing
 * the value they need (no threshold, no baseline) never trigger. Nothing is
 * ever inferred: an incomplete rule simply does not fire.
 */
export function evaluateAlert(
  rule: AlertRule,
  obs: AlertObservation | null,
): AlertOutcome {
  if (!isPriceAlert(rule.kind)) return notTriggered(obs?.price ?? null);
  if (!obs || !Number.isFinite(obs.price)) return notTriggered(null);

  switch (rule.kind) {
    case "PRICE_ABOVE": {
      if (rule.threshold === null || !Number.isFinite(rule.threshold)) {
        return notTriggered(obs.price);
      }
      return obs.price >= rule.threshold
        ? triggered(
            `price ${obs.price} is at or above ${rule.threshold}`,
            obs.price,
          )
        : notTriggered(obs.price);
    }
    case "PRICE_BELOW": {
      if (rule.threshold === null || !Number.isFinite(rule.threshold)) {
        return notTriggered(obs.price);
      }
      return obs.price <= rule.threshold
        ? triggered(
            `price ${obs.price} is at or below ${rule.threshold}`,
            obs.price,
          )
        : notTriggered(obs.price);
    }
    case "PCT_MOVE_UP": {
      const baseline = obs.baselinePrice;
      if (
        baseline === null ||
        !Number.isFinite(baseline) ||
        baseline <= 0 ||
        rule.pct === null ||
        !Number.isFinite(rule.pct)
      ) {
        return notTriggered(obs.price);
      }
      const move = (obs.price - baseline) / baseline;
      return move >= rule.pct
        ? triggered(
            `moved +${(move * 100).toFixed(4)}% from baseline ${baseline} (threshold ${(rule.pct * 100).toFixed(4)}%)`,
            obs.price,
          )
        : notTriggered(obs.price);
    }
    case "PCT_MOVE_DOWN": {
      const baseline = obs.baselinePrice;
      if (
        baseline === null ||
        !Number.isFinite(baseline) ||
        baseline <= 0 ||
        rule.pct === null ||
        !Number.isFinite(rule.pct)
      ) {
        return notTriggered(obs.price);
      }
      const move = (baseline - obs.price) / baseline;
      return move >= rule.pct
        ? triggered(
            `moved -${(move * 100).toFixed(4)}% from baseline ${baseline} (threshold ${(rule.pct * 100).toFixed(4)}%)`,
            obs.price,
          )
        : notTriggered(obs.price);
    }
    default:
      return notTriggered(obs.price);
  }
}
