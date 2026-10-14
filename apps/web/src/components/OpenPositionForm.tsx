"use client";

import { useActionState } from "react";
import { openPositionAction, type FormState } from "@/lib/actions";

const initial: FormState = {};

const CHAINS = ["BNB", "SOLANA", "ROBINHOOD"];

export function OpenPositionForm({
  defaultChain = "BNB",
  defaultAddress = "",
  defaultSymbol = "",
  defaultDecimals = 18,
}: {
  defaultChain?: string;
  defaultAddress?: string;
  defaultSymbol?: string;
  defaultDecimals?: number;
}) {
  const [state, formAction, pending] = useActionState(openPositionAction, initial);

  return (
    <form action={formAction}>
      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.ok ? (
        <div className="alert pos">Paper position opened.</div>
      ) : null}

      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="op-chain">Chain</label>
          <select id="op-chain" name="chain" defaultValue={defaultChain}>
            {CHAINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="op-symbol">Symbol</label>
          <input id="op-symbol" name="symbol" defaultValue={defaultSymbol} required />
        </div>
        <div className="field">
          <label htmlFor="op-address">Contract address</label>
          <input
            id="op-address"
            name="address"
            defaultValue={defaultAddress}
            placeholder="0x…"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="op-decimals">Decimals</label>
          <input
            id="op-decimals"
            name="decimals"
            type="number"
            min={0}
            max={36}
            defaultValue={defaultDecimals}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="op-notional">Notional (quote, e.g. USD)</label>
          <input
            id="op-notional"
            name="notionalQuote"
            inputMode="decimal"
            placeholder="1000"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="op-price">Entry price (per token)</label>
          <input
            id="op-price"
            name="pricePerToken"
            inputMode="decimal"
            placeholder="0.00001"
            required
          />
        </div>
      </div>

      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Opening…" : "Open paper position"}
      </button>
    </form>
  );
}
