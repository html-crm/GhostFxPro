import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { logoutAction } from "@/lib/actions";
import { SideNav } from "@/components/SideNav";
import pkg from "../../../package.json";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const initials = user.display_name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Ghost<span>Fx</span>Pro
          <span className="muted" style={{ fontSize: 11, fontWeight: 400, marginLeft: 6 }}>
            v{pkg.version}
          </span>
        </div>
        <SideNav showAdmin={isAdmin(user)} />
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>Trading Terminal</h1>
          <div className="user-chip">
            <span className={`badge ${user.status === "APPROVED" ? "pos" : "warn"}`}>
              {user.status}
            </span>
            <div style={{ textAlign: "right", lineHeight: 1.2 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user.display_name}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {user.role.replace("_", " ")}
              </div>
            </div>
            <div className="avatar">{initials || "?"}</div>
            <form action={logoutAction}>
              <button className="btn btn-sm" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
