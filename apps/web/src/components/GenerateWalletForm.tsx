"use client";

import { useActionState, useState } from "react";
import { addWalletAction, type FormState } from "@/lib/actions";
import { generateWallet, type GeneratedWallet } from "@/lib/walletgen";

const initial: FormState = {};

const CHAINS = [
  { value: "SOLANA", label: "Solana" },
  { value: "BNB", label: "BNB Smart Chain" },
] as const;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? "Copied" : `Copy ${label}`}
    </button>
  );
}

/**
 * Generates a fresh keypair in the browser. The secret key is shown once so the
 * user can back it up; it is never uploaded. GhostFxPro remains watch-only.
 */
export function GenerateWalletForm() {
  const [chain, setChain] = useState<"SOLANA" | "BNB">("SOLANA");
  const [wallet, setWallet] = useState<GeneratedWallet | null>(null);
  const [state, formAction, pending] = useActionState(addWalletAction, initial);

  return (
    <div>
      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="g-chain">Chain</label>
          <select
            id="g-chain"
            value={chain}
            onChange={(e) => setChain(e.target.value as "SOLANA" | "BNB")}
          >
            {CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ alignSelf: "end" }}>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setWallet(generateWallet(chain));
            }}
          >
            Generate new wallet
          </button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
        Keys are created in your browser and shown once. GhostFxPro never
        receives, stores, or transmits your private key.
      </p>

      {wallet ? (
        <div className="alert" style={{ marginTop: 8, borderColor: "var(--warn, #c98a00)" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Back up this secret key now — it will not be shown again
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Anyone with this key controls the wallet. Store it in a password
            manager or a hardware wallet. If you lose it, nobody can recover it.
          </div>

          <div className="field">
            <label>Public address ({wallet.chain === "SOLANA" ? "Solana" : "BNB"})</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input readOnly value={wallet.address} className="mono" style={{ flex: 1 }} />
              <CopyButton value={wallet.address} label="address" />
            </div>
          </div>

          <div className="field">
            <label>Secret key</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input readOnly value={wallet.privateKey} className="mono" style={{ flex: 1 }} />
              <CopyButton value={wallet.privateKey} label="key" />
            </div>
          </div>

          <form action={formAction} style={{ marginTop: 10 }}>
            {state.error ? <div className="alert error">{state.error}</div> : null}
            {state.ok ? (
              <div className="alert pos">Wallet added to your watch list.</div>
            ) : null}
            <input type="hidden" name="chain" value={wallet.chain} />
            <input type="hidden" name="address" value={wallet.address} />
            <input type="hidden" name="label" value="Generated" />
            <button className="btn btn-primary" disabled={pending || state.ok}>
              {state.ok ? "Added" : pending ? "Adding…" : "Add to my wallets"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
