"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type FormState } from "@/lib/actions";

const initial: FormState = {};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(registerAction, initial);

  return (
    <div className="auth-card">
      <div className="auth-brand">
        Ghost<span>Fx</span>Pro
      </div>
      <p className="auth-sub">
        Create an account. New accounts require administrator approval before
        trading.
      </p>

      {state.error ? <div className="alert error">{state.error}</div> : null}

      <form action={formAction}>
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input id="displayName" name="displayName" required />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password (min 8 characters)</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
        Already registered? <Link href="/login" className="pos">Sign in</Link>
      </p>
    </div>
  );
}
