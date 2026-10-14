import { getToken } from "@/lib/session";
import { apiFetch } from "@/lib/api";

interface AuditEntry {
  audit_id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export default async function AdminAuditPage() {
  const token = await getToken();
  if (!token) return null;

  const res = await apiFetch<{ entries: AuditEntry[] }>("/admin/audit?limit=100", {
    token,
  });
  const entries = res.data?.entries ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Audit Log</h1>
          <p>Privileged actions with actor, target, and timestamp.</p>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Target</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.audit_id}>
                  <td className="muted mono" style={{ whiteSpace: "nowrap" }}>
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td>
                    <span className="badge accent">{e.action}</span>
                  </td>
                  <td className="muted mono">{e.actor_id?.slice(0, 8) ?? "system"}</td>
                  <td className="muted mono">
                    {e.target_type ? `${e.target_type}:${e.target_id?.slice(0, 8)}` : "—"}
                  </td>
                  <td className="muted mono" style={{ fontSize: 12 }}>
                    {JSON.stringify(e.metadata)}
                  </td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    No audit entries.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
