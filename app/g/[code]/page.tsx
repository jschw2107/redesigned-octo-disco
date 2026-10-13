import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Header } from "@/components/Header";
import { CampaignVisual, StateBadge } from "@/components/CampaignCard";
import { Countdown } from "@/components/Countdown";
import { JoinForm } from "@/components/JoinForm";
import { BuyExtras } from "@/components/BuyExtras";
import { cancelExtraCheckout, extrasOnSale, sweepExtraHolds } from "@/lib/extras";
import { siteUrl } from "@/lib/fulfill";
import { isAdmin } from "@/lib/auth";
import { paymentsEnabled } from "@/lib/stripe";
import { fmtDate, getSettings, getUniversities } from "@/lib/data";
import {
  allowedDomains, code, demandCurve, getCampaign, getFeeBps, isOpen, ladder, parseOptions, plural, publicState, usd,
} from "@/lib/campaigns";
import { feePerUnit, pct } from "@/lib/consent";

export const dynamic = "force-dynamic";

async function load(raw: string) {
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  const c = await getCampaign({ number: n });
  if (!c) return null;
  if (c.status === "draft" && !(await isAdmin())) return null;
  return c;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const c = await load((await params).code);
  if (!c) return { title: "GroupBuy" };
  const l = ladder(c);
  if (c.stock_only) return { title: `${c.title}: ${usd(c.extra_cents ?? c.final_cents)} in stock`, description: c.summary || `Buy now from GroupBuy while stock lasts.` };
  return {
    title: `GroupBuy #${code(c.number)}: ${c.title} at ${usd(l.current)} (normally ${usd(c.normal_cents)})`,
    description: `${c.units} ${plural(c.units, c.unit)} committed. Join at your price; everyone pays the same final price.`,
  };
}

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ card_cancelled?: string; extra_cancelled?: string }> }) {
  const raw = (await params).code;
  const sp = await searchParams;
  // Extras: release this buyer's held stock if they backed out of checkout, and any abandoned holds (before loading counts).
  if (sp.extra_cancelled) await cancelExtraCheckout(sp.extra_cancelled).catch((e) => console.error("[extras]", e));
  await sweepExtraHolds(await siteUrl()).catch((e) => console.error("[extras sweep]", e));
  const c = await load(raw);
  if (!c) notFound();
  const [settings, universities, domains, curve, feeBps] = await Promise.all([getSettings(), getUniversities(), allowedDomains(), demandCurve(c), getFeeBps()]);
  const unis = universities.map((u) => ({ id: u.id, name: u.name, pickup_location: u.pickup_location, halls: u.halls.map((h) => ({ id: h.id, name: h.name })) }));
  if (c.stock_only) {
    const price = c.extra_cents ?? c.final_cents ?? 0;
    const off = c.normal_cents > price ? Math.round((1 - price / c.normal_cents) * 100) : 0;
    return (
      <>
        <Header />
        <main className="container section" style={{ paddingTop: 32 }}>
          <Link href="/in-stock" className="small muted">← In stock</Link>
          <div className="split" style={{ marginTop: 16 }}>
            <div className="stack" style={{ gap: 22 }}>
              <div className="row" style={{ gap: 10 }}>
                {c.category && <span className="tag">{c.category}</span>}
                <span className={`badge ${extrasOnSale(c) ? "good" : "neutral"}`}>{extrasOnSale(c) ? "In stock" : "Sold out"}</span>
              </div>
              <h1 style={{ fontSize: "clamp(2.2rem, 5vw, 3.4rem)" }}>{c.title}</h1>
              {c.summary && <p className="lead" style={{ marginTop: 0 }}>{c.summary}</p>}
              <CampaignVisual c={c} size="hero" />
              <div className="gb-stats">
                {off > 0 && <div><div className="small muted">Normal price</div><div className="gb-stat"><s>{usd(c.normal_cents)}</s></div></div>}
                <div><div className="small muted">Buy now</div><div className="gb-stat accent">{usd(price)}</div></div>
                <div><div className="small muted">Left</div><div className="gb-stat">📦 {c.extra_units}</div></div>
                {off > 0 && <div><div className="small muted">You save</div><div className="gb-stat">{off}%</div></div>}
              </div>
              {c.description && <p>{c.description}</p>}
            </div>
            <aside className="stack" style={{ gap: 16, position: "sticky", top: 88 }}>
              {sp.extra_cancelled && <div className="alert warn small">Checkout cancelled: you weren’t charged and the items are back on sale.</div>}
              {extrasOnSale(c) ? (
                <BuyExtras campaign={c.number} unit={c.unit} priceCents={price} left={c.extra_units} universities={unis} online={paymentsEnabled()} stockOnly />
              ) : (
                <div className="panel stack">
                  <h3>Sold out</h3>
                  <p className="muted">Get an alert for the next GroupBuy, or see what else is in stock.</p>
                  <Link className="btn ghost" href="/in-stock">In stock now</Link>
                </div>
              )}
            </aside>
          </div>
        </main>
        <Footer />
      </>
    );
  }
  const l = ladder(c);
  const st = publicState(c);
  const open = isOpen(c);
  const tz = settings.timezone;
  const unitPl = (n: number) => plural(n, c.unit);
  const nextTierText = l.next
    ? `${l.toNext} more ${unitPl(l.toNext)} to ${l.goalReached ? `unlock the ${usd(l.next.cents)} tier` : "hit the goal"}.`
    : "We've hit the top tier. Every extra buyer adds bargaining power.";
  const steps = [{ units: c.goal, cents: c.target_cents, base: true }, ...l.tiers.filter((t) => t.units > c.goal).map((t) => ({ ...t, base: false }))];

  return (
    <>
      <Header />
      <main className="container section" style={{ paddingTop: 32 }}>
        <Link href="/#groupbuys" className="small muted">← All GroupBuys</Link>
        <div className="split" style={{ marginTop: 16 }}>
          <div className="stack" style={{ gap: 22 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="tag">GroupBuy #{code(c.number)}{c.category ? ` · ${c.category}` : ""}</span>
              <StateBadge c={c} />
            </div>
            <h1 style={{ fontSize: "clamp(2.2rem, 5vw, 3.4rem)" }}>{c.title}</h1>
            {c.summary && <p className="lead" style={{ marginTop: 0 }}>{c.summary}</p>}
            <CampaignVisual c={c} size="hero" />

            <div className="gb-stats">
              <div><div className="small muted">Normal price</div><div className="gb-stat"><s>{usd(c.normal_cents)}</s></div></div>
              <div>
                <div className="small muted">{c.status === "deal" ? "Deal price" : "Current GroupBuy target"}</div>
                <div className="gb-stat accent">{usd(c.status === "deal" && c.final_cents ? c.final_cents : l.current)}</div>
              </div>
              <div><div className="small muted">Committed</div><div className="gb-stat">👥 {c.units} <span className="small muted">{unitPl(c.units)}</span></div></div>
              <div>
                <div className="small muted">{open ? "Joining closes" : "Status"}</div>
                <div className="gb-stat small-stat">{open ? <Countdown to={c.deadline} /> : st.label}</div>
                {open && <div className="small muted">{fmtDate(c.deadline, tz)}</div>}
              </div>
            </div>

            {feeBps > 0 && (() => {
              const price = c.status === "deal" && c.final_cents ? c.final_cents : l.current;
              const fee = feePerUnit(price, c.normal_cents, feeBps);
              return (
                <div className="fee-box">
                  <strong>How GroupBuy makes money: {pct(feeBps)} of what you save, charged with your order.</strong>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    At {usd(price)} you save {usd(c.normal_cents - price)} vs the normal price. GroupBuy’s fee is {usd(fee)}, so you pay {usd(price + fee)} and keep {usd(c.normal_cents - price - fee)}.
                    No savings, no fee.
                  </div>
                </div>
              );
            })()}

            <div className="panel stack" style={{ gap: 12 }}>
              <div className="row"><h3>Price tiers</h3><div className="spacer" /><span className="small muted">🎯 {l.next ? `${l.toNext} more to next tier` : "Top tier reached"}</span></div>
              <div className={`progress ${l.goalReached ? "done" : ""}`}><span style={{ width: `${Math.round(l.progress * 100)}%` }} /></div>
              <ul className="tiers">
                {steps.map((t) => {
                  const reached = c.units >= t.units;
                  return (
                    <li key={t.units} className={reached ? "reached" : ""}>
                      <span aria-hidden>{reached ? "✅" : "🔒"}</span>
                      <span><strong>{t.units} {unitPl(t.units)}</strong> → target {usd(t.cents)}</span>
                      {t.base && <span className="badge neutral">goal</span>}
                    </li>
                  );
                })}
              </ul>
              <p className="small muted">Tiers are goals we take to sellers, not promises. We only confirm a price once a seller agrees to it.</p>
            </div>

            {c.description && <p>{c.description}</p>}

            <div className="panel stack" style={{ gap: 10 }}>
              <h3>Demand so far</h3>
              <p className="small muted">What we can show sellers right now. Each row counts everyone willing to buy at that price or more.</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Price</th><th className="num">Buyers</th><th className="num">{unitPl(2)[0].toUpperCase() + unitPl(2).slice(1)}</th></tr></thead>
                  <tbody>{curve.map((r) => <tr key={r.price}><td>{usd(r.price)}</td><td className="num">{r.buyers}</td><td className="num">{r.units}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="stack" style={{ gap: 16, position: "sticky", top: 88 }}>
            {open ? (
              <>
                <h3>Join this GroupBuy</h3>
                {sp.card_cancelled && (
                  <div className="alert warn small">
                    Your spot isn’t saved until you add a card. You weren’t charged. <Link href={`/c/${encodeURIComponent(sp.card_cancelled)}`}>Finish joining →</Link>
                  </div>
                )}
                <JoinForm campaign={c.number} title={c.title} unit={c.unit} options={parseOptions(c)} maxPerBuyer={c.max_per_buyer}
                  feeBps={feeBps} normalCents={c.normal_cents} universities={unis} domains={domains} nextTierText={nextTierText} cards={paymentsEnabled()} />
              </>
            ) : c.status === "deal" ? (
              <>
                <div className="panel stack">
                  <h3>Deal secured: {usd(c.final_cents)}</h3>
                  <p className="muted">Everyone who joined at {usd(c.final_cents)} or more is in, and pays {usd(c.final_cents)}. Saved cards were charged automatically.</p>
                </div>
                {sp.extra_cancelled && <div className="alert warn small">Checkout cancelled: you weren’t charged and the items are back on sale.</div>}
                {extrasOnSale(c) && (
                  <BuyExtras campaign={c.number} unit={c.unit} priceCents={c.extra_cents!} left={c.extra_units} universities={unis}
                    groupPriceCents={(c.final_cents ?? 0) + feePerUnit(c.final_cents ?? 0, c.normal_cents, feeBps)} online={paymentsEnabled()} />
                )}
              </>
            ) : (
              <div className="panel stack">
                <h3>{st.label}</h3>
                <p className="muted">Joining is closed while we take this group’s demand to sellers. Everyone who joined will hear from us by email.</p>
                <Link className="btn ghost" href="/requests">Request another GroupBuy</Link>
              </div>
            )}
            <div className="promise">
              <strong>Everyone pays the same final price.</strong>
              <p className="small">Say Jack joins at ≤$200, David at ≤$190, Michael at ≤$180, and a seller offers $175. All three get the same $175 deal, plus the same GroupBuy fee. Telling us your real price never costs you more.</p>
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
