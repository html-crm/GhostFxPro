import { fetchExchangeStatus, statusLabel } from "@/lib/exchanges";

export default async function ExchangePage() {
  const status = await fetchExchangeStatus();

  if (!status) {
    return (
      <div className="card">
        <div className="empty">
          <h3>Sign in to see integration status</h3>
          <p>This page needs an approved account.</p>
        </div>
      </div>
    );
  }

  const blocked = status.providers.filter((p) => p.status === "blocked").length;
  const requirements = status.providers.flatMap((p) =>
    p.requirements.map((r) => ({ provider: p.displayName, requirement: r })),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Exchange</h1>
          <p>{status.reason}</p>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat">
          <div className="stat-label">Live orders</div>
          <div className="stat-value">Disabled</div>
          <div className="stat-sub">Paper (dry-run) mode only</div>
        </div>
        <div className="stat">
          <div className="stat-label">Venues tracked</div>
          <div className="stat-value">{status.providers.length}</div>
          <div className="stat-sub">Official / authorized only</div>
        </div>
        <div className="stat">
          <div className="stat-label">Blocked venues</div>
          <div className="stat-value">{blocked}</div>
          <div className="stat-sub">Needs credentials + eligibility</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Venues</div>
        <table className="data">
          <thead>
            <tr>
              <th>Venue</th>
              <th>Kind</th>
              <th>Markets</th>
              <th>Status</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {status.providers.map((p) => (
              <tr key={p.providerId}>
                <td className="mono">{p.displayName}</td>
                <td>{p.kind}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {p.markets.join(", ")}
                </td>
                <td>
                  <span className={`badge ${p.status === "paper_only" ? "accent" : p.status === "blocked" ? "warn" : ""}`}>
                    {statusLabel(p.status)}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: 12.5 }}>
                  {p.summary}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {status.providers.map((p) => (
        <div className="card" key={`${p.providerId}-detail`}>
          <div className="card-title">
            {p.displayName} — why it is not usable, and what would change that
          </div>
          <div className="grid cols-2">
            <div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                Reasons
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {p.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                Requirements to enable
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {p.requirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 6px" }}>
            Limitations (never bypassed)
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {p.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ))}

      <div className="card">
        <div className="card-title">Stablecoin identity</div>
        <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
          Stablecoins are distinct assets on this platform and are never substituted for
          one another.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th>Treatment</th>
            </tr>
          </thead>
          <tbody>
            {status.stablecoins.map((s) => (
              <tr key={s.symbol}>
                <td className="mono">{s.symbol}</td>
                <td>{s.name}</td>
                <td className="muted" style={{ fontSize: 12.5 }}>
                  {s.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-title">Platform limitations</div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          {status.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 6px" }}>
          Consolidated requirements
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          {requirements.map(({ provider, requirement }) => (
            <li key={`${provider}-${requirement}`}>
              <span className="mono" style={{ fontSize: 12 }}>{provider}</span>
              <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                — {requirement}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
