import { fetchAlerts, fetchAlertEvents, type Alert, type AlertKind } from "@/lib/alerts";
import {
  deleteAlertAction,
  evaluateAlertsAction,
  toggleAlertAction,
} from "@/lib/actions";
import { CreateAlertForm } from "@/components/CreateAlertForm";

function money(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  // Keep precision for very small token prices.
  if (n !== 0 && Math.abs(n) < 0.001) return n.toPrecision(6);
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function condition(a: Alert): string {
  switch (a.kind) {
    case "PRICE_ABOVE":
      return `price ≥ ${money(a.threshold)}`;
    case "PRICE_BELOW":
      return `price ≤ ${money(a.threshold)}`;
    case "PCT_MOVE_UP":
      return `+${a.pct}% from ${money(a.baselinePrice)}`;
    case "PCT_MOVE_DOWN":
      return `−${a.pct}% from ${money(a.baselinePrice)}`;
    case "POSITION_OPENED":
      return "a position opens";
    case "POSITION_CLOSED":
      return "a position closes";
    default:
      return "—";
  }
}

function kindLabel(kind: AlertKind): string {
  return kind.replace(/_/g, " ").toLowerCase();
}

function time(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default async function AlertsPage() {
  const [alerts, events] = await Promise.all([fetchAlerts(), fetchAlertEvents(50)]);
  const active = alerts.filter((a) => a.isActive).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Alerts</h1>
          <p>
            Passive observations on price and position events. An alert records
            that a condition became true — it never places an order or moves
            funds.
          </p>
        </div>
        <form action={evaluateAlertsAction}>
          <button className="btn" type="submit">
            Evaluate alerts now
          </button>
        </form>
      </div>

      <div className="grid cols-3">
        <div className="stat">
          <div className="stat-label">Total alerts</div>
          <div className="stat-value">{alerts.length}</div>
          <div className="stat-sub">Configured by you</div>
        </div>
        <div className="stat">
          <div className="stat-label">Active</div>
          <div className="stat-value">{active}</div>
          <div className="stat-sub">Evaluated every bot tick</div>
        </div>
        <div className="stat">
          <div className="stat-label">Events recorded</div>
          <div className="stat-value">{events.length}</div>
          <div className="stat-sub">Most recent first</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Create an alert</div>
        <CreateAlertForm />
      </div>

      <div className="card">
        <div className="card-title">Your alerts</div>
        {alerts.length === 0 ? (
          <div className="empty">
            <h3>No alerts yet</h3>
            <p>Create one above to start watching a token or a position event.</p>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Token</th>
                <th>Kind</th>
                <th>Condition</th>
                <th>Status</th>
                <th>Last fired</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.alertId}>
                  <td>
                    <span className="mono">{a.symbol}</span>
                    <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                      {a.chain}
                    </span>
                  </td>
                  <td>{kindLabel(a.kind)}</td>
                  <td className="mono">{condition(a)}</td>
                  <td>
                    {a.isActive ? (
                      <span className="badge pos">active</span>
                    ) : (
                      <span className="badge">paused</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {time(a.lastTriggeredAt)}
                  </td>
                  <td>
                    <div className="row-actions">
                      <form action={toggleAlertAction}>
                        <input type="hidden" name="alertId" value={a.alertId} />
                        <input type="hidden" name="isActive" value={String(a.isActive)} />
                        <button className="btn btn-sm" type="submit">
                          {a.isActive ? "Pause" : "Resume"}
                        </button>
                      </form>
                      <form action={deleteAlertAction}>
                        <input type="hidden" name="alertId" value={a.alertId} />
                        <button className="btn btn-sm danger" type="submit">
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">Event history</div>
        {events.length === 0 ? (
          <div className="empty">
            <h3>No events yet</h3>
            <p>Alerts fire during the bot tick; anything that triggers shows up here.</p>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Fired</th>
                <th>Token</th>
                <th>Kind</th>
                <th className="right">Observed</th>
                <th className="right">Threshold</th>
                <th>Reason</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.eventId}>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {time(e.firedAt)}
                  </td>
                  <td>
                    <span className="mono">{e.symbol}</span>
                    <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                      {e.chain}
                    </span>
                  </td>
                  <td>{kindLabel(e.kind)}</td>
                  <td className="mono right">{money(e.observedValue)}</td>
                  <td className="mono right">{money(e.threshold)}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {e.reason}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {e.quoteSource ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
