import Link from "next/link";
import { Footer, Header } from "@/components/Header";
import { CampaignCard } from "@/components/CampaignCard";
import { WaitlistForm } from "@/components/WaitlistForm";
import { getUniversities } from "@/lib/data";
import { all } from "@/lib/db";
import { demand, getFeeBps, listCampaigns, usd, usdCompact } from "@/lib/campaigns";
import { pct } from "@/lib/consent";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [campaigns, universities, week, total, feeBps] = await Promise.all([
    listCampaigns({ publicOnly: true }), getUniversities(), demand(7), demand(), getFeeBps(),
  ]);
  const requests = await all<{ id: number; title: string; target_cents: number | null; votes: number }>(
    `SELECT r.id, r.title, r.target_cents, (SELECT COUNT(*) FROM request_votes v WHERE v.request_id=r.id) + 1 AS votes
     FROM requests r WHERE r.status='approved' ORDER BY votes DESC LIMIT 3`);
  const unis = universities.map((u) => ({ id: u.id, name: u.name, pickup_location: u.pickup_location, halls: u.halls.map((h) => ({ id: h.id, name: h.name })) }));
  const campus = unis.length === 1 ? unis[0].name : "your campus";
  const live = campaigns.filter((c) => c.status === "live");
  const rest = campaigns.filter((c) => c.status !== "live");

  return (
    <>
      <Header />
      <main>
        <section className="hero">
          <div className="container">
            {total.students > 0 && (
              <div className="cycle-pill">
                <span className="cycle-dot" />
                <span>
                  <strong>{usdCompact(week.students ? week.dollars : total.dollars)}</strong> of purchasing demand committed by{" "}
                  <strong>{week.students || total.students}</strong> students{week.students ? " this week" : ""}
                </span>
              </div>
            )}
            <div className="eyebrow">Now live at {campus}</div>
            <h1>Students set the price. <span className="accent-word">Sellers compete</span> for the order.</h1>
            <p className="lead">
              Join a GroupBuy at the price you’d pay. We take the whole group’s demand to sellers, they compete for it, and everyone in the group pays the
              same final price. Nothing is charged unless we land a price at or below yours.
            </p>
            <div className="hero-actions">
              <a className="btn accent" href="#groupbuys">See live GroupBuys</a>
              <Link className="btn ghost" href="/requests">Request a GroupBuy</Link>
            </div>
          </div>
        </section>

        <section className="container">
          <div className="power">
            <div>
              <div className="eyebrow">A reverse marketplace</div>
              <h2>Imagine 300 students want MacBooks. Who wants that order?</h2>
              <p style={{ marginTop: 16, fontSize: "1.1rem" }}>
                Brands spend a fortune convincing shoppers one at a time. We show up with the buyers already lined up, and ask sellers for their best price.
              </p>
              <p className="power-foot">Customers find suppliers, not the other way around.</p>
            </div>
            <div className="dots" aria-hidden>{Array.from({ length: 30 }, (_, i) => <span key={i} />)}</div>
          </div>
        </section>

        <section className="section" id="groupbuys">
          <div className="container">
            <div className="eyebrow">Live GroupBuys</div>
            <h2>Join at your price</h2>
            <p className="lead">Targets are goals we take to sellers. The more students join, the harder sellers compete.</p>
            {live.length === 0 ? (
              <div className="empty" style={{ marginTop: 28 }}>
                <h3>No GroupBuys are open right now</h3>
                <p className="muted" style={{ marginTop: 6 }}>Get an alert when the next one opens, or propose one.</p>
              </div>
            ) : (
              <div className="grid gb-grid" style={{ marginTop: 28 }}>{live.map((c) => <CampaignCard key={c.id} c={c} />)}</div>
            )}
            {rest.length > 0 && (
              <>
                <h3 style={{ marginTop: 40, marginBottom: 14 }}>Closed &amp; negotiating</h3>
                <div className="grid gb-grid">{rest.map((c) => <CampaignCard key={c.id} c={c} />)}</div>
              </>
            )}
          </div>
        </section>

        <section className="section" id="how-it-works" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="eyebrow">How it works</div>
            <h2>More buyers. More bargaining power.</h2>
            <div className="steps four">
              <div className="step"><div className="step-num">01</div><h3>Join at your price</h3><p>Pick the most you’d pay: “I’ll buy at $199 or less”, and save a card. Nothing is charged now.</p></div>
              <div className="step"><div className="step-num">02</div><h3>Share to unlock tiers</h3><p>“23 more buyers unlocks the next tier.” Every friend who joins makes the group harder to ignore.</p></div>
              <div className="step"><div className="step-num">03</div><h3>Sellers compete</h3><p>We show retailers and distributors the real demand at each price and ask for their best offer.</p></div>
              <div className="step"><div className="step-num">04</div><h3>Automatic checkout</h3><p>If the deal lands at or below your price, your card is charged the group’s final price{feeBps > 0 ? ` plus our ${pct(feeBps)} share of what you save` : ""}. Everyone pays the same.</p></div>
            </div>
            <div className="promise" style={{ marginTop: 22 }}>
              <strong>Your maximum price decides whether you’re in the deal, not what we charge you.</strong>
              <p className="small">
                Jack joins at ≤$200, David at ≤$190, Michael at ≤$180. A seller offers $175, so all three pay $175. Nobody is charged more for being honest about what
                they’d pay.
              </p>
            </div>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="split">
              <div>
                <div className="eyebrow">Start your own</div>
                <h2>What should the group buy next?</h2>
                <p className="lead">“Who wants AirPods under $100?” “Who’d switch gyms for under $30 a month?” Propose it, rally your friends, and we’ll take it to sellers.</p>
                <Link className="btn accent" href="/requests" style={{ marginTop: 22 }}>Request a GroupBuy</Link>
              </div>
              <div className="stack" style={{ gap: 10 }}>
                {requests.map((r) => (
                  <Link key={r.id} href="/requests" className="panel row" style={{ padding: 16, textDecoration: "none" }}>
                    <span>Who wants {r.title}{r.target_cents ? ` under ${usd(r.target_cents)}` : ""}?</span>
                    <div className="spacer" />
                    <span className="badge">👋 {r.votes}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="eyebrow">Questions</div>
            <h2>Good to know</h2>
            <div className="faq">
              <details><summary>Does joining cost anything?</summary><p>No. Joining is free. You save a card securely with Stripe, and it’s charged once, automatically, only if we secure a price at or below your maximum, at the group’s final price.</p></details>
              <details><summary>What if the price isn’t reached?</summary><p>Then you’re not in that deal and your card is never charged. We’ll let you know about the next round.</p></details>
              <details><summary>Why does everyone pay the same price?</summary><p>So it’s always safe to tell us the real most you’d pay. Your maximum only decides whether you’re in; the final price is the same for everyone in the group.</p></details>
              {feeBps > 0 && <details><summary>How does GroupBuy make money?</summary><p>We keep {pct(feeBps)} of what you save versus the normal price, charged together with your order. If a deal saves you $50, our fee is ${(50 * feeBps / 10000).toFixed(0)} and you keep ${(50 - 50 * feeBps / 10000).toFixed(0)}. No savings, no fee. The fee is always included in the most you could pay, which we show before you join.</p></details>}
              <details><summary>Are the target prices guaranteed?</summary><p>No. Targets and tiers are goals we take to sellers. We only confirm a price once a seller has agreed to it.</p></details>
              <details><summary>Can I change my mind?</summary><p>Yes. Until joining closes you can change your price or withdraw from the link in your email.</p></details>
            </div>
          </div>
        </section>

        <section className="container" id="alerts">
          <div className="waitlist">
            <div className="eyebrow">Never miss a GroupBuy</div>
            <h2>Get alerts for new GroupBuys</h2>
            <p className="lead">We’ll email you when a new GroupBuy opens at {campus}.</p>
            <WaitlistForm universities={unis} />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
