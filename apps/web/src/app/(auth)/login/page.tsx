"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type FormState } from "@/lib/actions";

const initial: FormState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <div className="auth-card">
      <div className="auth-brand">
        Ghost<span>Fx</span>Pro
      </div>
      <p className="auth-sub">Sign in to your trading terminal.</p>

      {state.error ? <div className="alert error">{state.error}</div> : null}

      <form action={formAction}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="totp">MFA code (if enabled)</label>
          <input
            id="totp"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
        No account? <Link href="/register" className="pos">Create one</Link>
      </p>
    </div>
  );
}
