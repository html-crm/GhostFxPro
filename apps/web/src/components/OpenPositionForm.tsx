"use client";

import { useActionState, useState } from "react";
import { openPositionAction, type FormState } from "@/lib/actions";
import { TokenLookup } from "@/components/TokenLookup";
import type { TokenProfile } from "@/lib/market";

const initial: FormState = {};

const CHAINS = ["BNB", "SOLANA", "ROBINHOOD"];

function priceValue(profile: TokenProfile): string {
  return profile.priceUsd !== null ? String(profile.priceUsd) : "";
}

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
  const [chain, setChain] = useState(defaultChain);
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [address, setAddress] = useState(defaultAddress);
  const [decimals, setDecimals] = useState(String(defaultDecimals));
  const [price, setPrice] = useState("");

  const applyProfile = (p: TokenProfile) => {
    setChain(p.chain);
    setAddress(p.address);
    if (p.symbol) setSymbol(p.symbol);
    if (p.decimals !== null) setDecimals(String(p.decimals));
    if (p.priceUsd !== null) setPrice(priceValue(p));
  };

  return (
    <form action={formAction}>
      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.ok ? (
        <div className="alert pos">Paper position opened.</div>
      ) : null}

      <TokenLookup onFound={applyProfile} />

      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="op-chain">Chain</label>
          <select
            id="op-chain"
            name="chain"
            value={chain}
            onChange={(e) => setChain(e.target.value)}
          >
            {CHAINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="op-symbol">Symbol</label>
          <input
            id="op-symbol"
            name="symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="op-address">Contract address</label>
          <input
            id="op-address"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
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
            value={decimals}
            onChange={(e) => setDecimals(e.target.value)}
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
            value={price}
            onChange={(e) => setPrice(e.target.value)}
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
