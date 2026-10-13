export type Update = { id: number; created_at: string; audience: string; subject: string; body: string; sent: number };

const fmt = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Order updates from GroupBuy, newest first (shown on a buyer's order page). */
export function UpdatesList({ updates, tz }: { updates: Update[]; tz: string }) {
  if (!updates.length) return null;
  return (
    <div className="panel stack" style={{ gap: 12 }}>
      <h3>📣 Updates</h3>
      {updates.map((u) => (
        <div key={u.id} className="update">
          <div className="row" style={{ gap: 8 }}><strong>{u.subject}</strong><div className="spacer" /><span className="small muted">{fmt(u.created_at, tz)}</span></div>
          <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{u.body}</p>
        </div>
      ))}
    </div>
  );
}
