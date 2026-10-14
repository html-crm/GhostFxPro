import { fetchTokens } from "@/lib/trading";
import { OpenPositionForm } from "@/components/OpenPositionForm";
import { AddTokenForm } from "@/components/AddTokenForm";

export default async function MarketsPage() {
  const tokens = await fetchTokens();

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Markets</h1>
          <p>
            Register a token by its contract identity, then open a paper
            position. Prices are observations, never execution guarantees.
          </p>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">Open a paper position</div>
          <OpenPositionForm />
        </div>
        <div className="card">
          <div className="card-title">Add a token</div>
          <AddTokenForm />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Tracked tokens</div>
        {tokens.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No tokens yet. Add one above to begin.
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Chain</th>
                <th>Contract</th>
                <th className="right">Decimals</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.token_id}>
                  <td className="mono">{t.symbol}</td>
                  <td>{t.chain}</td>
                  <td className="mono muted" style={{ fontSize: 12 }}>
                    {t.contract_address}
                  </td>
                  <td className="right">{t.decimals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
