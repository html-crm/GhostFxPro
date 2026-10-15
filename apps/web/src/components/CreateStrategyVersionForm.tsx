"use client";

import { useActionState } from "react";
import { createStrategyVersionAction, type FormState } from "@/lib/actions";

const initial: FormState = {};

export function CreateStrategyVersionForm({
  defaults,
}: {
  defaults: {
    takeProfitArmPct: number;
    trailingPercent: number;
    trailingConfirmations: number;
    stopLossPct: number | null;
  };
}) {
  const [state, formAction, pending] = useActionState(
    createStrategyVersionAction,
    initial,
  );

  return (
    <form action={formAction}>
      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.ok ? <div className="alert pos">Draft version saved.</div> : null}

      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="s-arm">Take-profit arm (%)</label>
          <input
            id="s-arm"
            name="takeProfitArmPct"
            inputMode="decimal"
            defaultValue={String(defaults.takeProfitArmPct * 100)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="s-trail">Trailing distance (%)</label>
          <input
            id="s-trail"
            name="trailingPercent"
            inputMode="decimal"
            defaultValue={String(defaults.trailingPercent * 100)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="s-conf">Trailing confirmations (polls)</label>
          <input
            id="s-conf"
            name="trailingConfirmations"
            inputMode="numeric"
            defaultValue={String(defaults.trailingConfirmations)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="s-stop">Stop-loss (%) — blank to disable</label>
          <input
            id="s-stop"
            name="stopLossPct"
            inputMode="decimal"
            placeholder="e.g. 10"
            defaultValue={
              defaults.stopLossPct === null ? "" : String(defaults.stopLossPct * 100)
            }
          />
        </div>
        <div className="field">
          <label htmlFor="s-note">Note (optional)</label>
          <input id="s-note" name="note" placeholder="Why are you changing this?" />
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
        A new version is a draft. Nothing changes until you activate it, and
        activation shows a comparison report against the current version first.
      </p>

      <button className="btn" disabled={pending}>
        {pending ? "Saving…" : "Save draft version"}
      </button>
    </form>
  );
}
