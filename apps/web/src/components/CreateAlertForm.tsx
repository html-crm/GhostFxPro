"use client";

import { useActionState, useState } from "react";
import { createAlertAction, type FormState } from "@/lib/actions";

const initial: FormState = {};

const CHAINS = ["BNB", "SOLANA", "ROBINHOOD"];

const KINDS = [
  { value: "PRICE_ABOVE", label: "Price at or above", needsThreshold: true },
  { value: "PRICE_BELOW", label: "Price at or below", needsThreshold: true },
  { value: "PCT_MOVE_UP", label: "Rises by % from baseline", needsPct: true },
  { value: "PCT_MOVE_DOWN", label: "Falls by % from baseline", needsPct: true },
  { value: "POSITION_OPENED", label: "A position opens", needsNone: true },
  { value: "POSITION_CLOSED", label: "A position closes", needsNone: true },
] as const;

export function CreateAlertForm() {
  const [state, formAction, pending] = useActionState(createAlertAction, initial);
  const [kind, setKind] = useState<string>("PRICE_ABOVE");

  const selected = KINDS.find((k) => k.value === kind) ?? KINDS[0];
  const needsThreshold = "needsThreshold" in selected;
  const needsPct = "needsPct" in selected;

  return (
    <form action={formAction}>
      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.ok ? <div className="alert pos">Alert created.</div> : null}

      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="a-kind">Trigger when</label>
          <select
            id="a-kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="a-chain">Chain</label>
          <select id="a-chain" name="chain" defaultValue="BNB">
            {CHAINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="a-symbol">Symbol</label>
          <input id="a-symbol" name="symbol" placeholder="PEPE" required />
        </div>
        <div className="field">
          <label htmlFor="a-address">Contract address</label>
          <input id="a-address" name="address" placeholder="0x…" required />
        </div>
        {"needsThreshold" in selected && selected.needsThreshold ? (
          <div className="field">
            <label htmlFor="a-threshold">Threshold price</label>
            <input
              id="a-threshold"
              name="threshold"
              inputMode="decimal"
              placeholder="e.g. 0.00042"
              required
            />
          </div>
        ) : null}
        {needsPct ? (
          <div className="field">
            <label htmlFor="a-pct">Percent move (0–100)</label>
            <input
              id="a-pct"
              name="pct"
              inputMode="decimal"
              placeholder="e.g. 5 for 5%"
              required
            />
          </div>
        ) : null}
      </div>

      {needsPct ? (
        <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
          The baseline defaults to the current market price when the alert is
          created.
        </p>
      ) : null}

      <button className="btn" disabled={pending}>
        {pending ? "Creating…" : "Create alert"}
      </button>
    </form>
  );
}
