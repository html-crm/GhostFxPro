export function Placeholder({
  title,
  phase,
  description,
  bullets,
}: {
  title: string;
  phase: string;
  description: string;
  bullets?: string[];
}) {
  return (
    <div className="card">
      <div className="empty">
        <h3>{title}</h3>
        <p style={{ margin: "0 auto", maxWidth: 560 }}>{description}</p>
        {bullets && bullets.length > 0 ? (
          <ul
            style={{
              maxWidth: 560,
              margin: "16px auto 0",
              textAlign: "left",
              color: "var(--muted)",
              fontSize: 13,
            }}
          >
            {bullets.map((b) => (
              <li key={b} style={{ marginBottom: 4 }}>
                {b}
              </li>
            ))}
          </ul>
        ) : null}
        <span className="placeholder-tag">Planned · {phase}</span>
      </div>
    </div>
  );
}
