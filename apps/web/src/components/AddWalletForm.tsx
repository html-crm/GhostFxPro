"use client";

import { useActionState, useState } from "react";
import { addWalletAction, type FormState } from "@/lib/actions";

const initial: FormState = {};

const CHAINS = [
  { value: "SOLANA", label: "Solana", placeholder: "Base58 address…" },
  { value: "BNB", label: "BNB Smart Chain", placeholder: "0x…" },
] as const;

export function AddWalletForm() {
  const [state, formAction, pending] = useActionState(addWalletAction, initial);
  const [chain, setChain] = useState<string>("SOLANA");

  const selected = CHAINS.find((c) => c.value === chain) ?? CHAINS[0];

  return (
    <form action={formAction}>
      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.ok ? <div className="alert pos">Wallet connected.</div> : null}

      <div className="grid cols-3">
        <div className="field">
          <label htmlFor="w-chain">Chain</label>
          <select
            id="w-chain"
            name="chain"
            value={chain}
            onChange={(e) => setChain(e.target.value)}
          >
            {CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="w-address">Public address</label>
          <input
            id="w-address"
            name="address"
            placeholder={selected.placeholder}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="w-label">Label (optional)</label>
          <input id="w-label" name="label" placeholder="e.g. Main" />
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
        Watch-only. Paste a public address — never a seed phrase or private key.
        GhostFxPro cannot move funds from a wallet it only watches.
      </p>

      <button className="btn" disabled={pending}>
        {pending ? "Connecting…" : "Connect wallet"}
      </button>
    </form>
  );
}
