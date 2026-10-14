"use client";

import { useActionState } from "react";
import { addTokenAction, type FormState } from "@/lib/actions";

const initial: FormState = {};

const CHAINS = ["BNB", "SOLANA", "ROBINHOOD"];

export function AddTokenForm() {
  const [state, formAction, pending] = useActionState(addTokenAction, initial);

  return (
    <form action={formAction}>
      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.ok ? <div className="alert pos">Token saved.</div> : null}

      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="t-chain">Chain</label>
          <select id="t-chain" name="chain" defaultValue="BNB">
            {CHAINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-symbol">Symbol</label>
          <input id="t-symbol" name="symbol" placeholder="PEPE" required />
        </div>
        <div className="field">
          <label htmlFor="t-address">Contract address</label>
          <input id="t-address" name="address" placeholder="0x…" required />
        </div>
        <div className="field">
          <label htmlFor="t-decimals">Decimals</label>
          <input
            id="t-decimals"
            name="decimals"
            type="number"
            min={0}
            max={36}
            defaultValue={18}
            required
          />
        </div>
      </div>

      <button className="btn" disabled={pending}>
        {pending ? "Saving…" : "Add token"}
      </button>
    </form>
  );
}
