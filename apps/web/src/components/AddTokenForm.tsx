"use client";

import { useActionState, useState } from "react";
import { addTokenAction, type FormState } from "@/lib/actions";
import { TokenLookup } from "@/components/TokenLookup";
import type { TokenProfile } from "@/lib/market";

const initial: FormState = {};

const CHAINS = ["BNB", "SOLANA", "ROBINHOOD"];

export function AddTokenForm() {
  const [state, formAction, pending] = useActionState(addTokenAction, initial);
  const [chain, setChain] = useState("BNB");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [decimals, setDecimals] = useState("18");

  const applyProfile = (p: TokenProfile) => {
    setChain(p.chain);
    setAddress(p.address);
    if (p.symbol) setSymbol(p.symbol);
    if (p.name) setName(p.name);
    if (p.decimals !== null) setDecimals(String(p.decimals));
  };

  return (
    <form action={formAction}>
      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.ok ? <div className="alert pos">Token saved.</div> : null}

      <TokenLookup onFound={applyProfile} />

      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="t-chain">Chain</label>
          <select
            id="t-chain"
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
          <label htmlFor="t-symbol">Symbol</label>
          <input
            id="t-symbol"
            name="symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="PEPE"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="t-name">Name (optional)</label>
          <input
            id="t-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pepe"
          />
        </div>
        <div className="field">
          <label htmlFor="t-decimals">Decimals</label>
          <input
            id="t-decimals"
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
          <label htmlFor="t-address">Contract address</label>
          <input
            id="t-address"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x…"
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
