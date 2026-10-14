import { fetchPositions } from "@/lib/trading";
import {
  closePositionAction,
  evaluatePositionAction,
  runTickAction,
} from "@/lib/actions";

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

export default async function PositionsPage() {
  const positions = await fetchPositions("OPEN");

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Open Positions</h1>
          <p>
            One row per trade, keyed by its immutable trade ID. No two trades in
            the same token ever share entry, quantity, or P&L.
          </p>
        </div>
        <form action={runTickAction}>
          <button className="btn" type="submit">
            Run bot tick
          </button>
        </form>
      </div>

      <div className="card">
        {positions.length === 0 ? (
          <div className="empty">
            <h3>No open positions</h3>
            <p>Open a paper position from the Markets page to start the bot.</p>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Trade</th>
                <th>Token</th>
                <th>Entry</th>
                <th>Last</th>
                <th>Peak</th>
                <th>Trailing</th>
                <th className="right">Unrealized</th>
                <th className="right">Evaluate / Close</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
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
                  <td className="mono">{money(p.avgEntryPrice)}</td>
                  <td className="mono">{money(p.lastPrice)}</td>
                  <td className="mono">{money(p.highestPrice)}</td>
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
                  <td>
                    <div className="row-actions">
                      <form action={evaluatePositionAction}>
                        <input type="hidden" name="tradeId" value={p.tradeId} />
                        <input
                          className="input input-sm"
                          name="price"
                          placeholder="price"
                          inputMode="decimal"
                        />
                        <button className="btn btn-sm" type="submit">
                          Evaluate
                        </button>
                      </form>
                      <form action={closePositionAction}>
                        <input type="hidden" name="tradeId" value={p.tradeId} />
                        <input
                          className="input input-sm"
                          name="price"
                          placeholder="price"
                          inputMode="decimal"
                          required
                        />
                        <button className="btn btn-sm danger" type="submit">
                          Close
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
    </>
  );
}
