import { searchPairs, type PairSummary } from "@/lib/market";

function money(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function pairAge(ms: number | null): string {
  if (ms === null) return "—";
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function freshness(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

function Row({ p }: { p: PairSummary }) {
  const changeClass =
    p.priceChange24h === null
      ? ""
      : p.priceChange24h > 0
        ? "pos"
        : p.priceChange24h < 0
          ? "neg"
          : "";
  return (
    <tr>
      <td>
        <span className="mono">{p.baseSymbol}</span>
        <span className="muted"> / {p.quoteSymbol}</span>
        {p.baseName ? (
          <div className="muted" style={{ fontSize: 11.5 }}>
            {p.baseName}
          </div>
        ) : null}
      </td>
      <td>{p.chainId}</td>
      <td className="muted">{p.dexId}</td>
      <td className="right mono">{p.priceUsd === null ? "—" : `$${p.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 8 })}`}</td>
      <td className="right mono">{money(p.liquidityUsd)}</td>
      <td className="right mono">{money(p.volume24hUsd)}</td>
      <td className={`right mono ${changeClass}`}>{pct(p.priceChange24h)}</td>
      <td className="right">{pairAge(p.pairCreatedAt)}</td>
      <td className="right">
        {p.url ? (
          <a href={p.url} target="_blank" rel="noreferrer noopener">
            view
          </a>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export default async function DexScreenerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const result = query.length >= 2 ? await searchPairs(query) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>DEX Screener</h1>
          <p>
            Token and pair discovery via the DEX Screener API — search, chain,
            liquidity, volume and freshness. Read-only.
          </p>
        </div>
        <span className="badge">source: dexscreener</span>
      </div>

      <div className="card">
        <form method="get" className="row-actions" style={{ gap: 8 }}>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search a token, symbol, or pair (e.g. SOL, WBNB, PEPE)"
            style={{ flex: 1, minWidth: 240 }}
          />
          <button className="btn btn-primary" type="submit">
            Search
          </button>
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Market discovery is a separate system from execution. A token
          appearing here does not mean it is safe or executable. Values are
          observations from the data source, not guarantees.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          Results
          {result ? (
            <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
              {result.count} pairs · fetched {freshness(result.fetchedAt)}
            </span>
          ) : null}
        </div>

        {query.length < 2 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Enter at least 2 characters to search.
          </p>
        ) : !result ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No response from the data source. Try again.
          </p>
        ) : result.pairs.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No pairs found for “{query}”.
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Chain</th>
                <th>DEX</th>
                <th className="right">Price</th>
                <th className="right">Liquidity</th>
                <th className="right">24h Vol</th>
                <th className="right">24h %</th>
                <th className="right">Age</th>
                <th className="right">Link</th>
              </tr>
            </thead>
            <tbody>
              {result.pairs.map((p) => (
                <Row key={`${p.chainId}:${p.pairAddress}`} p={p} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
