import { getCurrentUser } from "@/lib/session";
import { StatusBadge, RoleBadge } from "@/components/Badges";
import { MfaSetup } from "@/components/MfaSetup";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Settings</h1>
          <p>Account, security, and session preferences.</p>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">Profile</div>
          <table className="data">
            <tbody>
              <tr>
                <td className="muted">Display name</td>
                <td>{user.display_name}</td>
              </tr>
              <tr>
                <td className="muted">Email</td>
                <td>{user.email}</td>
              </tr>
              <tr>
                <td className="muted">Role</td>
                <td>
                  <RoleBadge role={user.role} />
                </td>
              </tr>
              <tr>
                <td className="muted">Status</td>
                <td>
                  <StatusBadge status={user.status} />
                </td>
              </tr>
              <tr>
                <td className="muted">Email verified</td>
                <td>{user.email_verified ? "Yes" : "No"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Two-factor authentication</div>
          {user.mfa_enabled ? (
            <div className="alert info" style={{ marginBottom: 0 }}>
              MFA is enabled on this account.
            </div>
          ) : (
            <MfaSetup />
          )}
        </div>
      </div>
    </>
  );
}
