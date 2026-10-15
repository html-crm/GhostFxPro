import Link from "next/link";
import {
  fetchStrategies,
  fetchComparison,
  type ConfigComparison,
  type CompareResult,
  type Strategy,
  type StrategyVersion,
} from "@/lib/strategies";
import {
  activateStrategyVersionAction,
  deleteStrategyVersionAction,
  updateStrategyNoteAction,
} from "@/lib/actions";
import { CreateStrategyVersionForm } from "@/components/CreateStrategyVersionForm";

function pct(v: number | null): string {
  if (v === null) return "off";
  return `${Number((v * 100).toFixed(4))}%`;
}

function configSummary(c: StrategyVersion["config"]): string {
  return `arm ${pct(c.takeProfitArmPct)} · trail ${pct(c.trailingPercent)} ×${c.trailingConfirmations} · stop ${pct(c.stopLossPct)}`;
}

function time(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function changeValue(key: string, v: number | null): string {
  if (v === null) return "off";
  if (key === "trailingConfirmations") return String(v);
  return pct(v);
}

function CompareCard({ result }: { result: CompareResult }) {
  const c: ConfigComparison = result.comparison;
  return (
    <div className="card">
      <div className="card-title">
        Comparison report — v{result.from.version} → v{result.to.version}
      </div>
      {c.hasChanges ? (
        <table className="data">
          <thead>
            <tr>
              <th>Field</th>
              <th className="right">Current</th>
              <th className="right">Proposed</th>
              <th>Behavioural impact</th>
            </tr>
          </thead>
          <tbody>
            {c.changes
              .filter((ch) => ch.changed)
              .map((ch) => (
                <tr key={ch.key}>
                  <td>{ch.label}</td>
                  <td className="right mono">{changeValue(ch.key, ch.before)}</td>
                  <td className="right mono">{changeValue(ch.key, ch.after)}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {ch.impact}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <div className="alert pos">
          No behavioural change: this version is identical to the active one.
        </div>
      )}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
        Activation never places an order, and never changes trades that are
        already open — it only changes the config future positions open under.
      </p>
    </div>
  );
}

function VersionRow({
  v,
  activeVersionNumber,
}: {
  v: StrategyVersion;
  activeVersionNumber: number | null;
}) {
  return (
    <tr>
      <td>
        <strong>v{v.version}</strong>
        {v.isActive ? (
          <span className="badge pos" style={{ marginLeft: 8 }}>
            active
          </span>
        ) : (
          <span className="badge" style={{ marginLeft: 8 }}>
            draft
          </span>
        )}
      </td>
      <td className="mono" style={{ fontSize: 12 }}>
        {configSummary(v.config)}
      </td>
      <td className="muted" style={{ fontSize: 12 }}>
        {v.note ?? "—"}
      </td>
      <td className="muted" style={{ fontSize: 12 }}>
        {time(v.createdAt)}
      </td>
      <td className="muted" style={{ fontSize: 12 }}>
        {time(v.activatedAt)}
      </td>
      <td className="right mono">{v.tradeCount}</td>
      <td>
        <div className="row-actions">
          <Link
            className="btn btn-sm"
            href={`/strategies?compare=${v.strategyVersionId}`}
          >
            Compare
          </Link>
          {!v.isActive ? (
            <>
              <form action={activateStrategyVersionAction}>
                <input type="hidden" name="versionId" value={v.strategyVersionId} />
                <button className="btn btn-sm" type="submit">
                  {activeVersionNumber !== null && v.version < activeVersionNumber
                    ? "Roll back"
                    : "Activate"}
                </button>
              </form>
              {v.version === 1 ? null : (
                <form action={deleteStrategyVersionAction}>
                  <input type="hidden" name="versionId" value={v.strategyVersionId} />
                  <button
                    className="btn btn-sm danger"
                    type="submit"
                    disabled={v.tradeCount > 0}
                    title={
                      v.tradeCount > 0
                        ? "In use by trades and cannot be deleted"
                        : undefined
                    }
                  >
                    Delete
                  </button>
                </form>
              )}
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export default async function StrategiesPage({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string }>;
}) {
  const sp = await searchParams;
  const strategies = await fetchStrategies();
  const strategy: Strategy | undefined = strategies[0];
  const comparison = sp.compare ? await fetchComparison(sp.compare) : null;

  if (!strategy) {
    return (
      <div className="card">
        <div className="empty">
          <h3>No strategy yet</h3>
          <p>
            A versioned strategy is created automatically the first time you open
            a paper position.
          </p>
        </div>
      </div>
    );
  }

  const active = strategy.versions.find((v) => v.isActive) ?? null;
  const totalTrades = strategy.versions.reduce((n, v) => n + v.tradeCount, 0);
  const defaults =
    active?.config ?? {
      takeProfitArmPct: 0.07,
      trailingPercent: 0.02,
      trailingConfirmations: 2,
      stopLossPct: null,
    };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Strategies</h1>
          <p>
            Versioned strategy configuration. A version is an immutable config;
            changing behaviour means drafting a new version and activating it
            after reviewing a comparison report.
          </p>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat">
          <div className="stat-label">Active version</div>
          <div className="stat-value">
            {active ? `v${active.version}` : "—"}
          </div>
          <div className="stat-sub">{strategy.name}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Versions</div>
          <div className="stat-value">{strategy.versions.length}</div>
          <div className="stat-sub">Immutable configs</div>
        </div>
        <div className="stat">
          <div className="stat-label">Trades under versioning</div>
          <div className="stat-value">{totalTrades}</div>
          <div className="stat-sub">Each pinned to its exact version</div>
        </div>
      </div>

      {comparison ? <CompareCard result={comparison} /> : null}

      <div className="card">
        <div className="card-title">Rule precedence (explicit)</div>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Rule</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            {strategy.rules.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.priority}</td>
                <td>
                  <strong>{r.label}</strong>
                </td>
                <td className="muted" style={{ fontSize: 12.5 }}>
                  {r.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          When several rules could fire on the same tick, the engine evaluates
          them in this order and stops at the first match. Precedence is explicit
          — there are no silent rule conflicts.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Draft a new version</div>
        <CreateStrategyVersionForm
          defaults={{
            takeProfitArmPct: defaults.takeProfitArmPct,
            trailingPercent: defaults.trailingPercent,
            trailingConfirmations: defaults.trailingConfirmations,
            stopLossPct: defaults.stopLossPct,
          }}
        />
      </div>

      <div className="card">
        <div className="card-title">Version history</div>
        <table className="data">
          <thead>
            <tr>
              <th>Version</th>
              <th>Configuration</th>
              <th>Note</th>
              <th>Created</th>
              <th>Activated</th>
              <th className="right">Trades</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {strategy.versions.map((v) => (
              <VersionRow
                key={v.strategyVersionId}
                v={v}
                activeVersionNumber={active?.version ?? null}
              />
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          The seed version (v1) is never deleted, and no version referenced by a
          trade can be removed — the ledger always explains which config a trade
          ran under.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Annotate a version</div>
        <table className="data">
          <thead>
            <tr>
              <th>Version</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {strategy.versions.map((v) => (
              <tr key={v.strategyVersionId}>
                <td className="mono">v{v.version}</td>
                <td>
                  <form action={updateStrategyNoteAction} className="row-actions">
                    <input type="hidden" name="versionId" value={v.strategyVersionId} />
                    <input
                      name="note"
                      defaultValue={v.note ?? ""}
                      placeholder="Note"
                      style={{ width: 320 }}
                    />
                    <button className="btn btn-sm" type="submit">
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
