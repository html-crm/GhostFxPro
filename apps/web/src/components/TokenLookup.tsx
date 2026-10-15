"use client";

import { useState, useTransition } from "react";
import { lookupTokenAction } from "@/lib/actions";
import type { TokenProfile } from "@/lib/market";

function money(v: number | null): string {
  if (v === null) return "—";
  if (v !== 0 && Math.abs(v) < 0.001) return v.toPrecision(6);
  return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/**
 * Paste a contract address and pull its identity + market so the rest of the
 * form fills itself. Read-only: it never places an order.
 */
export function TokenLookup({
  onFound,
}: {
  onFound: (profile: TokenProfile) => void;
}) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<TokenProfile | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await lookupTokenAction(address);
      if (!res.ok || !res.profile) {
        setInfo(null);
        setError(res.error ?? "Lookup failed.");
        return;
      }
      setInfo(res.profile);
      onFound(res.profile);
    });
  };

  return (
    <div className="field" style={{ marginBottom: 14 }}>
      <label htmlFor="tk-address">Fetch by contract address</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          id="tk-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder="0x… (BNB) or a Solana mint"
          autoComplete="off"
          spellCheck={false}
          style={{ flex: 1 }}
        />
        <button
          className="btn"
          type="button"
          onClick={run}
          disabled={pending || address.trim().length === 0}
        >
          {pending ? "Fetching…" : "Fetch token"}
        </button>
      </div>

      {error ? (
        <div className="alert error" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}

      {info ? (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Found <span className="mono">{info.symbol ?? "unknown"}</span>
          {info.name ? ` — ${info.name}` : ""} on{" "}
          {info.chain === "SOLANA" ? "Solana" : "BNB Smart Chain"}
          {` · decimals ${info.decimals ?? "?"} · price ${money(info.priceUsd)} USD`}
          {` · ${info.pairCount} pair${info.pairCount === 1 ? "" : "s"}`}
        </div>
      ) : null}
    </div>
  );
}
