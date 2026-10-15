import {
  fetchWalletBalances,
  type TokenBalance,
  type WalletWithBalances,
} from "@/lib/wallets";
import {
  deleteWalletAction,
  refreshWalletsAction,
  renameWalletAction,
} from "@/lib/actions";
import { AddWalletForm } from "@/components/AddWalletForm";
import { GenerateWalletForm } from "@/components/GenerateWalletForm";

function shortAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function chainLabel(chain: string): string {
  if (chain === "SOLANA") return "Solana";
  if (chain === "BNB") return "BNB Smart Chain";
  if (chain === "ROBINHOOD") return "Robinhood";
  return chain;
}

function explorerUrl(chain: string, address: string): string | null {
  if (chain === "SOLANA") return `https://solscan.io/account/${address}`;
  if (chain === "BNB") return `https://bscscan.com/address/${address}`;
  return null;
}

function amount(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n !== 0 && Math.abs(n) < 0.000001) return n.toPrecision(6);
  return n.toLocaleString("en-US", { maximumFractionDigits: 9 });
}

function tokenLabel(t: TokenBalance): string {
  return t.symbol ?? shortAddress(t.address);
}

function freshness(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

function WalletCard({ w }: { w: WalletWithBalances }) {
  const b = w.balances;
  const link = explorerUrl(w.chain, w.address);
  return (
    <div className="card">
      <div className="card-title">
        <span>
          {w.label ? <strong>{w.label}</strong> : shortAddress(w.address)}
          <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12.5 }}>
            {chainLabel(w.chain)}
          </span>
        </span>
        <span className="badge" style={{ fontWeight: 400 }}>
          non-custodial
        </span>
      </div>

      <div className="muted mono" style={{ fontSize: 12, marginBottom: 10 }}>
        {w.address}
        {link ? (
          <>
            {" · "}
            <a href={link} target="_blank" rel="noreferrer noopener">
              explorer
            </a>
          </>
        ) : null}
      </div>

      {!b ? (
        <div className="alert error">
          Balances are unavailable right now (the RPC endpoint did not respond).
          The wallet is still connected and watch-only.
        </div>
      ) : (
        <>
          <div className="grid cols-3">
            <div className="stat">
              <div className="stat-label">Network-fee balance</div>
              <div className="stat-value mono">{amount(b.native.amount)}</div>
              <div className="stat-sub">{b.native.symbol}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Token holdings</div>
              <div className="stat-value">{b.tokens.length}</div>
              <div className="stat-sub">Non-zero balances</div>
            </div>
            <div className="stat">
              <div className="stat-label">Read at</div>
              <div className="stat-value" style={{ fontSize: 18 }}>
                {freshness(b.fetchedAt)}
              </div>
              <div className="stat-sub">source: {b.source}</div>
            </div>
          </div>

          {b.truncated ? (
            <p className="muted" style={{ fontSize: 12 }}>
              Showing the largest holdings only (results capped).
            </p>
          ) : null}

          {b.tokens.length > 0 ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Token</th>
                  <th className="right">Balance</th>
                  <th>Contract</th>
                </tr>
              </thead>
              <tbody>
                {b.tokens.map((t) => (
                  <tr key={t.address}>
                    <td>
                      <span className="mono">{tokenLabel(t)}</span>
                      {t.name ? (
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          {t.name}
                        </div>
                      ) : null}
                    </td>
                    <td className="right mono">{amount(t.amount)}</td>
                    <td className="muted mono" style={{ fontSize: 11.5 }}>
                      {shortAddress(t.address)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ fontSize: 12.5 }}>
              No token balances observed for platform-known tokens on this chain.
            </p>
          )}
        </>
      )}

      <div className="row-actions" style={{ marginTop: 12 }}>
        <form action={renameWalletAction} className="row-actions">
          <input type="hidden" name="walletId" value={w.walletId} />
          <input
            name="label"
            defaultValue={w.label ?? ""}
            placeholder="Label"
            style={{ width: 160 }}
          />
          <button className="btn btn-sm" type="submit">
            Save label
          </button>
        </form>
        <form action={deleteWalletAction}>
          <input type="hidden" name="walletId" value={w.walletId} />
          <button className="btn btn-sm danger" type="submit">
            Remove
          </button>
        </form>
      </div>
    </div>
  );
}

export default async function WalletsPage() {
  const wallets = await fetchWalletBalances();
  const chains = new Set(wallets.map((w) => w.chain));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Wallets</h1>
          <p>
            Non-custodial wallet connections, token balances, and network-fee
            balances across supported chains. Read-only.
          </p>
        </div>
        <form action={refreshWalletsAction}>
          <button className="btn" type="submit">
            Refresh balances
          </button>
        </form>
      </div>

      <div className="grid cols-3">
        <div className="stat">
          <div className="stat-label">Wallets connected</div>
          <div className="stat-value">{wallets.length}</div>
          <div className="stat-sub">Watch-only</div>
        </div>
        <div className="stat">
          <div className="stat-label">Chains in use</div>
          <div className="stat-value">{chains.size}</div>
          <div className="stat-sub">Solana · BNB Smart Chain</div>
        </div>
        <div className="stat">
          <div className="stat-label">Key material stored</div>
          <div className="stat-value">0</div>
          <div className="stat-sub">Never stored or returned</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Connect a wallet</div>
        <AddWalletForm />
      </div>

      <div className="card">
        <div className="card-title">Generate a new wallet</div>
        <GenerateWalletForm />
      </div>

      {wallets.length === 0 ? (
        <div className="card">
          <div className="empty">
            <h3>No wallets connected</h3>
            <p>
              Connect a public address above to view its token and network-fee
              balances across supported chains.
            </p>
          </div>
        </div>
      ) : (
        wallets.map((w) => <WalletCard key={w.walletId} w={w} />)
      )}

      <div className="card">
        <div className="card-title">Supported chains &amp; limits</div>
        <table className="data">
          <thead>
            <tr>
              <th>Chain</th>
              <th>Network-fee balance</th>
              <th>Token balances</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Solana</td>
              <td>SOL via on-chain RPC</td>
              <td>All SPL token accounts held by the address</td>
              <td>
                <span className="badge pos">supported</span>
              </td>
            </tr>
            <tr>
              <td>BNB Smart Chain</td>
              <td>BNB via on-chain RPC</td>
              <td>Platform-known BEP-20 tokens (no holder indexer)</td>
              <td>
                <span className="badge pos">supported</span>
              </td>
            </tr>
            <tr>
              <td>Robinhood</td>
              <td>—</td>
              <td>—</td>
              <td>
                <span className="badge warn">only if officially available</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          Seed phrases and private keys are never stored in plaintext or returned
          by the API. Connecting a wallet never grants the ability to move funds
          — balances are observations from public RPC endpoints, not guarantees.
        </p>
      </div>
    </>
  );
}
