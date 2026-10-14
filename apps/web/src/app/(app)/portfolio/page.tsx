import Link from "next/link";
import { fetchPortfolio, fetchPositions } from "@/lib/trading";

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

export default async function PortfolioPage() {
  const portfolio = await fetchPortfolio();
  const open = await fetchPositions("OPEN");

  const cash = Number(portfolio?.cashBalance ?? 0);
  const invested = open.reduce((s, p) => s + Number(p.marketValue), 0);
  const cashPct = portfolio ? (cash / (cash + invested || 1)) * 100 : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Portfolio</h1>
          <p>Simulated account value, allocation, and P&L (dry-run).</p>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat">
          <div className="stat-label">Equity</div>
          <div className="stat-value">${money(portfolio?.equity)}</div>
          <div className="stat-sub">Started at ${money(portfolio?.initialBalance)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Cash</div>
          <div className="stat-value">${money(portfolio?.cashBalance)}</div>
          <div className="stat-sub">{cashPct.toFixed(1)}% of equity</div>
        </div>
        <div className="stat">
          <div className="stat-label">Realized P&L</div>
          <div className={`stat-value ${pnlClass(portfolio?.realizedPnl)}`}>
            ${money(portfolio?.realizedPnl)}
          </div>
          <div className="stat-sub">{portfolio?.closedCount ?? 0} closed trades</div>
        </div>
        <div className="stat">
          <div className="stat-label">Unrealized P&L</div>
          <div className={`stat-value ${pnlClass(portfolio?.unrealizedPnl)}`}>
            ${money(portfolio?.unrealizedPnl)}
          </div>
          <div className="stat-sub">{portfolio?.openCount ?? 0} open trades</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Allocation
          <Link href="/positions" className="btn btn-sm">
            Manage positions
          </Link>
        </div>
        {open.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No open positions yet.
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Token</th>
                <th className="right">Market value</th>
                <th className="right">Unrealized</th>
                <th className="right">Weight</th>
              </tr>
            </thead>
            <tbody>
              {open.map((p) => {
                const mv = Number(p.marketValue);
                const w = (mv / (cash + invested || 1)) * 100;
                return (
                  <tr key={p.tradeId}>
                    <td className="mono">{p.symbol}</td>
                    <td className="mono right">${money(p.marketValue)}</td>
                    <td className={`mono right ${pnlClass(p.unrealizedPnl)}`}>
                      ${money(p.unrealizedPnl)}
                    </td>
                    <td className="right">{w.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
