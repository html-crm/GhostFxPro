export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "APPROVED"
      ? "pos"
      : status === "PENDING"
        ? "warn"
        : status === "REJECTED" || status === "SUSPENDED"
          ? "neg"
          : "";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function RoleBadge({ role }: { role: string }) {
  const cls = role === "SUPER_ADMIN" ? "accent" : role === "ADMIN" ? "" : "";
  return <span className={`badge ${cls}`}>{role.replace("_", " ")}</span>;
}

export function FreshnessBadge({ live }: { live: boolean }) {
  return (
    <span className={`badge ${live ? "pos" : "warn"}`}>
      {live ? "live" : "no feed"}
    </span>
  );
}
