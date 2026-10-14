"use client";

import { useActionState, useState, useTransition } from "react";
import {
  mfaSetupAction,
  mfaConfirmAction,
  type MfaSetupResult,
  type FormState,
} from "@/lib/actions";

export function MfaSetup() {
  const [setup, setSetup] = useState<MfaSetupResult | null>(null);
  const [starting, startTransition] = useTransition();
  const [confirmState, confirmAction, confirming] = useActionState(
    mfaConfirmAction,
    {} as FormState,
  );

  if (confirmState.ok) {
    return (
      <div className="alert info" style={{ marginBottom: 0 }}>
        MFA is now enabled. You will be asked for a code at every sign-in.
      </div>
    );
  }

  if (!setup) {
    return (
      <>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          MFA is not enabled. Protect your account with a TOTP authenticator app.
        </p>
        <button
          className="btn btn-primary"
          disabled={starting}
          onClick={() =>
            startTransition(async () => {
              const res = await mfaSetupAction();
              setSetup(res);
            })
          }
        >
          {starting ? "Preparing…" : "Begin MFA setup"}
        </button>
      </>
    );
  }

  if (setup.error) {
    return <div className="alert error">{setup.error}</div>;
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Add this secret to your authenticator app, then enter the 6-digit code.
      </p>
      <div className="field">
        <label>Secret</label>
        <input className="mono" readOnly value={setup.secret ?? ""} />
      </div>
      <div className="field">
        <label>otpauth URI</label>
        <input className="mono" readOnly value={setup.otpauthUri ?? ""} />
      </div>
      {confirmState.error ? (
        <div className="alert error">{confirmState.error}</div>
      ) : null}
      <form action={confirmAction}>
        <div className="field">
          <label htmlFor="code">6-digit code</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
          />
        </div>
        <button className="btn btn-primary" disabled={confirming}>
          {confirming ? "Confirming…" : "Confirm and enable MFA"}
        </button>
      </form>
    </>
  );
}
