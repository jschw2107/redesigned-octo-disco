import Link from "next/link";
import { Countdown } from "./Countdown";
import { campaignPath, code, ladder, plural, publicState, usd, type CampaignWithStats } from "@/lib/campaigns";

export function CampaignVisual({ c, size = "card" }: { c: CampaignWithStats; size?: "card" | "hero" }) {
  return (
    <div className={size === "hero" ? "gb-visual hero" : "gb-visual"}>
      {c.image_url ? <img src={c.image_url} alt={c.title} /> : <span aria-hidden>{c.emoji || "🛍️"}</span>}
    </div>
  );
}

export function StateBadge({ c }: { c: CampaignWithStats }) {
  const st = publicState(c);
  const cls = st.key === "open" ? "good" : st.key === "deal" ? "" : st.key === "negotiating" ? "warn" : "neutral";
  return <span className={`badge ${cls}`}>{st.label}</span>;
}

export function CampaignCard({ c }: { c: CampaignWithStats }) {
  const l = ladder(c);
  const st = publicState(c);
  const price = c.status === "deal" && c.final_cents ? c.final_cents : l.current;
  const off = c.normal_cents > 0 ? Math.round((1 - price / c.normal_cents) * 100) : 0;
  return (
    <article className="card gb-card">
      <Link href={campaignPath(c.number)} className="gb-card-link" aria-label={`GroupBuy #${code(c.number)}: ${c.title}`}>
        <CampaignVisual c={c} />
        <div className="card-body">
          <div className="row" style={{ gap: 8 }}>
            <span className="tag">GroupBuy #{code(c.number)}</span>
            <div className="spacer" />
            <StateBadge c={c} />
          </div>
          <h3>{c.title}</h3>
          {c.summary && <p className="small muted">{c.summary}</p>}
          <div className="gb-prices">
            <div><div className="small muted">Normal price</div><s className="muted">{usd(c.normal_cents)}</s></div>
            <div>
              <div className="small muted">{c.status === "deal" ? "Deal price" : "GroupBuy target"}</div>
              <strong className="gb-target">{usd(price)}</strong>
            </div>
            {off > 0 && <span className="badge good" style={{ alignSelf: "end" }}>−{off}%</span>}
          </div>
          <div className="stack" style={{ gap: 6, marginTop: 4 }}>
            <div className="row small" style={{ gap: 6 }}>
              <span>👥 <strong>{c.units}</strong> {plural(c.units, c.unit)} committed</span>
              <div className="spacer" />
              <span className="muted">🎯 {l.next ? `${l.next.units} needed` : "Top tier reached"}</span>
            </div>
            <div className={`progress ${l.goalReached ? "done" : ""}`}><span style={{ width: `${Math.round(l.progress * 100)}%` }} /></div>
            <div className="small muted">
              {st.key === "open" ? <>Closes in <Countdown to={c.deadline} short /></> : st.label}
            </div>
            {c.status === "deal" && c.extra_units > 0 && c.extra_cents ? (
              <span className="badge good" style={{ alignSelf: "flex-start" }}>📦 {c.extra_units} extra {plural(c.extra_units, c.unit)} for sale · {usd(c.extra_cents)}</span>
            ) : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
