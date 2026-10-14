import { getToken } from "@/lib/session";
import { apiFetch } from "@/lib/api";
import { StatusBadge, RoleBadge } from "@/components/Badges";
import {
  approveUserAction,
  rejectUserAction,
  suspendUserAction,
  restoreUserAction,
  revokeSessionsAction,
  changeRoleAction,
} from "@/lib/actions";

interface AdminUser {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  email_verified: boolean;
  mfa_enabled: boolean;
  created_at: string;
  password_set: boolean;
}

const ROLES = ["USER", "ADMIN", "SUPER_ADMIN"];

export default async function AdminUsersPage() {
  const token = await getToken();
  if (!token) return null;

  const [pendingRes, allRes] = await Promise.all([
    apiFetch<{ users: AdminUser[] }>("/admin/users/pending", { token }),
    apiFetch<{ users: AdminUser[] }>("/admin/users", { token }),
  ]);
  const pending = pendingRes.data?.users ?? [];
  const all = allRes.data?.users ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>User Management</h1>
          <p>Approve, suspend, and manage roles. All actions are audited.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Pending approval
          <span className="badge warn">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <div className="empty">No users awaiting approval.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Requested</th>
                  <th style={{ width: 200 }}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((u) => (
                  <tr key={u.user_id}>
                    <td>{u.display_name}</td>
                    <td className="muted">{u.email}</td>
                    <td className="muted mono">
                      {new Date(u.created_at).toLocaleString()}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <form action={approveUserAction}>
                          <input type="hidden" name="userId" value={u.user_id} />
                          <button className="btn btn-sm btn-primary">Approve</button>
                        </form>
                        <form action={rejectUserAction}>
                          <input type="hidden" name="userId" value={u.user_id} />
                          <button className="btn btn-sm btn-danger">Reject</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">All users ({all.length})</div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>MFA</th>
                <th style={{ width: 150 }}>Set role</th>
                <th style={{ width: 230 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {all.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.display_name}</td>
                  <td className="muted">{u.email}</td>
                  <td>
                    <RoleBadge role={u.role} />
                  </td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td>{u.mfa_enabled ? "On" : "—"}</td>
                  <td>
                    <form action={changeRoleAction} style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="userId" value={u.user_id} />
                      <select name="role" defaultValue={u.role} className="mono">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-sm">Set</button>
                    </form>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {u.status === "SUSPENDED" ? (
                        <form action={restoreUserAction}>
                          <input type="hidden" name="userId" value={u.user_id} />
                          <button className="btn btn-sm">Restore</button>
                        </form>
                      ) : (
                        <form action={suspendUserAction}>
                          <input type="hidden" name="userId" value={u.user_id} />
                          <button className="btn btn-sm btn-danger">Suspend</button>
                        </form>
                      )}
                      <form action={revokeSessionsAction}>
                        <input type="hidden" name="userId" value={u.user_id} />
                        <button className="btn btn-sm">Revoke sessions</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {all.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    No users yet.
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
