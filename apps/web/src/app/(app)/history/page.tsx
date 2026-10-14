import Link from "next/link";
import { fetchPositions } from "@/lib/trading";

function money(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function pnlClass(v: string | null | undefined): string {
  const n = Number(v ?? 0);
  return n > 0 ? "pos" : n < 0 ? "neg" : "";
}

export default async function HistoryPage() {
  const closed = await fetchPositions("CLOSED");

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>History</h1>
          <p>Closed trades with realized P&L, one row per immutable trade ID.</p>
        </div>
      </div>

      <div className="card">
        {closed.length === 0 ? (
          <div className="empty">
            <h3>No closed trades</h3>
            <p>
              Closed paper trades will appear here. Open one from the{" "}
              <Link href="/markets">Markets</Link> page.
            </p>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Trade</th>
                <th>Token</th>
                <th className="right">Buy cost</th>
                <th className="right">Entry</th>
                <th className="right">Realized P&L</th>
                <th className="right">Opened</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((p) => (
                <tr key={p.tradeId}>
                  <td className="mono muted" style={{ fontSize: 11 }}>
                    {p.tradeId.slice(0, 8)}
                  </td>
                  <td>
                    <span className="mono">{p.symbol}</span>
                    <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                      {p.chain}
                    </span>
                  </td>
                  <td className="mono right">${money(p.totalBuyCost)}</td>
                  <td className="mono right">{money(p.avgEntryPrice)}</td>
                  <td className={`mono right ${pnlClass(p.realizedPnl)}`}>
                    ${money(p.realizedPnl)}
                  </td>
                  <td className="right muted" style={{ fontSize: 12 }}>
                    {new Date(p.openedAt).toLocaleString()}
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
