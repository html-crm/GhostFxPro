import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { apiFetch } from "@/lib/api";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const health = await apiFetch<{ status: string }>("/health");
  const apiUp = health.ok && health.data?.status === "ok";

  const steps = [
    { label: "Email verified", done: user.email_verified },
    { label: "MFA enabled", done: user.mfa_enabled },
    { label: "Account approved", done: user.status === "APPROVED" },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Dashboard</h1>
          <p>Welcome back, {user.display_name}.</p>
        </div>
        <span className={`badge ${apiUp ? "pos" : "neg"}`}>
          {apiUp ? "API connected" : "API unreachable"}
        </span>
      </div>

      {!allDone ? (
        <div className="card">
          <div className="card-title">Account setup</div>
          {steps.map((s, i) => (
            <div key={s.label} className={`step${s.done ? " done" : ""}`}>
              <div className="idx">{s.done ? "✓" : i + 1}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{s.label}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {s.done
                    ? "Complete"
                    : s.label === "Account approved"
                      ? "An administrator must approve your account before trading."
                      : s.label === "MFA enabled"
                        ? "Enable MFA in Settings before trading."
                        : "Verify your email."}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid cols-4">
        <div className="stat">
          <div className="stat-label">Portfolio value</div>
          <div className="stat-value">—</div>
          <div className="stat-sub">No live feed (Phase 6)</div>
        </div>
        <div className="stat">
          <div className="stat-label">Open positions</div>
          <div className="stat-value">0</div>
          <div className="stat-sub">Trading engine disabled</div>
        </div>
        <div className="stat">
          <div className="stat-label">Realized P&L</div>
          <div className="stat-value">—</div>
          <div className="stat-sub">From reconciled fills only</div>
        </div>
        <div className="stat">
          <div className="stat-label">Unrealized P&L</div>
          <div className="stat-value">—</div>
          <div className="stat-sub">Requires live prices</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">
            Account
            <Link href="/settings" className="btn btn-sm">
              Settings
            </Link>
          </div>
          <table className="data">
            <tbody>
              <tr>
                <td className="muted">Email</td>
                <td>{user.email}</td>
              </tr>
              <tr>
                <td className="muted">Role</td>
                <td>{user.role.replace("_", " ")}</td>
              </tr>
              <tr>
                <td className="muted">Status</td>
                <td>
                  <span
                    className={`badge ${
                      user.status === "APPROVED" ? "pos" : "warn"
                    }`}
                  >
                    {user.status}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="muted">MFA</td>
                <td>{user.mfa_enabled ? "Enabled" : "Not enabled"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Execution pipeline</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            The single authoritative lifecycle every trade follows:
          </p>
          <div className="mono muted" style={{ fontSize: 12, lineHeight: 2 }}>
            market data &rarr; validation &rarr; strategy &rarr; decision
            <br />
            &rarr; risk checks &rarr; authorization &rarr; execution
            <br />
            &rarr; reconciliation &rarr; position &rarr; ledger &rarr; UI event
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            Live execution is disabled by default. No order can be submitted
            until an integration is explicitly approved.
          </p>
        </div>
      </div>
    </>
  );
}
