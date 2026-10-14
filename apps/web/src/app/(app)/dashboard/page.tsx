import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { apiFetch } from "@/lib/api";
import { fetchPortfolio, fetchPositions } from "@/lib/trading";
import { runTickAction } from "@/lib/actions";

function money(v: string | undefined): string {
  if (v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const health = await apiFetch<{ status: string }>("/health");
  const apiUp = health.ok && health.data?.status === "ok";

  const approved = user.status === "APPROVED";
  const portfolio = approved ? await fetchPortfolio() : null;
  const openPositions = approved ? await fetchPositions("OPEN") : [];
  const pnlClass = (v: string | undefined) =>
    v && Number(v) > 0 ? "pos" : v && Number(v) < 0 ? "neg" : "";

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
          <div className="stat-label">Equity</div>
          <div className="stat-value">${money(portfolio?.equity)}</div>
          <div className="stat-sub">Cash + open positions</div>
        </div>
        <div className="stat">
          <div className="stat-label">Open positions</div>
          <div className="stat-value">{portfolio?.openCount ?? 0}</div>
          <div className="stat-sub">{openPositions.length} marked</div>
        </div>
        <div className="stat">
          <div className="stat-label">Realized P&L</div>
          <div className={`stat-value ${pnlClass(portfolio?.realizedPnl)}`}>
            ${money(portfolio?.realizedPnl)}
          </div>
          <div className="stat-sub">From closed paper trades</div>
        </div>
        <div className="stat">
          <div className="stat-label">Unrealized P&L</div>
          <div className={`stat-value ${pnlClass(portfolio?.unrealizedPnl)}`}>
            ${money(portfolio?.unrealizedPnl)}
          </div>
          <div className="stat-sub">Mark-to-last price</div>
        </div>
      </div>

      {approved ? (
        <div className="card">
          <div className="card-title">
            Open positions
            <form action={runTickAction}>
              <button className="btn btn-sm" type="submit">
                Run bot tick
              </button>
            </form>
          </div>
          {openPositions.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No open positions. Open one from the <Link href="/markets">Markets</Link> page.
            </p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Entry</th>
                  <th>Last</th>
                  <th>Peak</th>
                  <th>Trailing</th>
                  <th className="right">Unrealized</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((p) => (
                  <tr key={p.tradeId}>
                    <td>
                      <span className="mono">{p.symbol}</span>
                      <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                        {p.chain}
                      </span>
                    </td>
                    <td className="mono">{money(p.avgEntryPrice ?? undefined)}</td>
                    <td className="mono">{money(p.lastPrice ?? undefined)}</td>
                    <td className="mono">{money(p.highestPrice ?? undefined)}</td>
                    <td>
                      {p.tpArmed ? (
                        <span className="badge accent">
                          armed · {p.trailingConfirmations}/2
                        </span>
                      ) : (
                        <span className="badge">holding</span>
                      )}
                    </td>
                    <td className={`mono right ${pnlClass(p.unrealizedPnl)}`}>
                      {money(p.unrealizedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

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
              <tr>
                <td className="muted">Paper cash</td>
                <td className="mono">${money(portfolio?.cashBalance)}</td>
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
            Running in dry-run (paper) mode. Live execution is disabled by
            default and requires explicit, audited authorization.
          </p>
        </div>
      </div>
    </>
  );
}
