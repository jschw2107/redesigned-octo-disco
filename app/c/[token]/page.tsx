import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Header } from "@/components/Header";
import { CampaignVisual } from "@/components/CampaignCard";
import { CardButton, CommitEditor, PayButton, RefreshWhilePending } from "@/components/CommitManager";
import { saveCardFromSession, sendJoinedReceipt } from "@/lib/cards";
import { chargeConsent, feePerUnit, pct } from "@/lib/consent";
import { ShareBox } from "@/components/ShareBox";
import { all, one, run } from "@/lib/db";
import { UpdatesList, type Update } from "@/components/Updates";
import { updateApplies } from "@/lib/updates";
import { fmtDate, getSettings } from "@/lib/data";
import { campaignPath, code, getCampaign, isOpen, ladder, parseOptions, plural, usd } from "@/lib/campaigns";
import { getCommitment, markCommitPaid, siteUrl } from "@/lib/fulfill";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your GroupBuy commitment", robots: { index: false } };

export default async function CommitmentPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ confirm?: string; session_id?: string; setup_session?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  let m = await getCommitment(token);
  if (!m) notFound();
  let justConfirmed = false;

  // Email confirmation link: proves the buyer owns the address, so they count toward the group.
  if (sp.confirm === "1" && m.status === "pending") {
    await run("UPDATE commitments SET status='active', confirmed_at=?, updated_at=? WHERE id=? AND status='pending'",
      [new Date().toISOString(), new Date().toISOString(), m.id]);
    m = (await getCommitment(token))!;
    justConfirmed = true;
  }
  // Returning from Stripe after saving a card: store it now in case the webhook hasn't arrived yet.
  if (sp.setup_session && stripe()) {
    try {
      if (await saveCardFromSession(token, sp.setup_session)) {
        const wasPending = m.status === "pending_card";
        await sendJoinedReceipt(token, await siteUrl());
        justConfirmed = wasPending;
      }
      m = (await getCommitment(token))!;
    } catch (e) { console.error("[stripe] card save failed", e); }
  }
  // Returning from Stripe: confirm the payment directly in case the webhook hasn't arrived yet.
  if (m.status === "won" && sp.session_id && sp.session_id === m.stripe_session_id && stripe()) {
    try {
      const sess = await stripe()!.checkout.sessions.retrieve(sp.session_id);
      if (sess.payment_status === "paid") {
        const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id ?? null;
        await markCommitPaid(token, pi, await siteUrl());
        m = (await getCommitment(token))!;
      }
    } catch (e) { console.error("[stripe] verify failed", e); }
  }

  const c = (await getCampaign({ id: m.campaign_id }))!;
  const tz = (await getSettings()).timezone;
  const base = await siteUrl();
  const l = ladder(c);
  const open = isOpen(c);
  const unitPl = (n: number) => plural(n, c.unit);
  const refs = await one<{ n: number }>("SELECT COUNT(*) AS n FROM commitments WHERE ref=? AND status IN ('active','won','paid')", [token]);
  const shareUrl = `${base}${campaignPath(c.number)}?ref=${token}`;
  const nextTierText = l.next ? `${l.toNext} more ${unitPl(l.toNext)} to ${l.goalReached ? `unlock the ${usd(l.next.cents)} tier` : "hit the goal"}.` : "Top tier reached. More buyers still add bargaining power.";
  const first = m.name.split(" ")[0];
  const updates = (await all<Update>("SELECT * FROM updates WHERE campaign_id=? ORDER BY created_at DESC", [c.id]))
    .filter((u) => updateApplies(u.audience, m!.status));

  return (
    <>
      <Header />
      {m.status === "won" && sp.session_id && <RefreshWhilePending />}
      <main className="container section" style={{ paddingTop: 32, maxWidth: 820 }}>
        <Link href={campaignPath(c.number)} className="small muted">← GroupBuy #{code(c.number)}: {c.title}</Link>
        <div className="row" style={{ marginTop: 14, alignItems: "center", flexWrap: "nowrap", gap: 18 }}>
          <div style={{ width: 84, flexShrink: 0 }}><CampaignVisual c={c} /></div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Your commitment</div>
            <h2 style={{ fontSize: "2rem" }}>
              {m.status === "pending" && "Confirm your email to count"}
              {m.status === "pending_card" && "Add a card to finish joining"}
              {m.status === "active" && (justConfirmed ? `Confirmed: you’re in, ${first}!` : `You’re in, ${first}`)}
              {m.status === "withdrawn" && "You withdrew"}
              {m.status === "won" && `Deal secured at ${usd(c.final_cents)}`}
              {m.status === "paid" && "Paid: you’re all set ✓"}
              {m.status === "not_matched" && "This deal landed above your price"}
              {m.status === "cancelled" && "This order was cancelled"}
            </h2>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 22 }}>
          <div className="choices" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <div><div className="small muted">You’ll buy</div><strong>{m.qty} {unitPl(m.qty)}</strong></div>
            <div><div className="small muted">Your maximum</div><strong>{usd(m.max_cents)} each</strong></div>
            <div><div className="small muted">{c.status === "deal" ? "Final price" : "Current target"}</div><strong>{usd(c.status === "deal" ? c.final_cents : l.current)}</strong></div>
            <div><div className="small muted">{open ? "Joining closes" : "Group"}</div><strong>{open ? fmtDate(c.deadline, tz) : `${c.units} ${unitPl(c.units)}`}</strong></div>
          </div>
        </div>

        <div className="stack" style={{ gap: 18, marginTop: 18 }}>
          {m.status === "pending" && <div className="alert info">We emailed {m.email} a confirmation link. Click it to be counted.</div>}
          {m.status === "pending_card" && open && (
            <div className="panel stack">
              <p>You’re not counted yet. Save a card with Stripe to lock in your spot. <strong>Nothing is charged now.</strong></p>
              <p className="small muted">{chargeConsent(c, m.max_cents, m.qty, m.fee_bps ?? 0)}</p>
              <CardButton token={token} label="Save card & join" primary />
            </div>
          )}
          {m.card_label && ["active", "withdrawn", "pending_card"].includes(m.status) && (
            <div className="panel row" style={{ padding: 16 }}>
              <span>💳 <strong>{m.card_label}</strong> <span className="muted small">· charged automatically only if a deal lands at or below {usd(m.max_cents)}</span></span>
              <div className="spacer" />
              {open && <CardButton token={token} label="Update card" />}
            </div>
          )}

          {m.status === "won" && (
            <div className="panel stack">
              <p>Sellers competed and the group landed at <strong>{usd(c.final_cents)}</strong> per {c.unit}, at or below your maximum. Everyone in the group pays this same price.</p>
              {m.charge_error && <div className="alert warn small">We couldn’t charge your saved card ({m.charge_error}). Please pay below to keep your spot.</div>}
              <DealBreakdown qty={m.qty} unit={c.unit} price={c.final_cents ?? 0} normal={c.normal_cents} feeBps={m.fee_bps ?? 0} total={m.amount_cents ?? 0} />
              {c.pay_by && <p className="small muted">Please pay by {fmtDate(c.pay_by, tz)} to keep your spot.</p>}
              {c.deal_note && <p className="small">{c.deal_note}</p>}
              {stripe() ? <PayButton token={token} label={`Pay ${usd(m.amount_cents)}`} /> : <div className="alert info">We’ll email you payment and pickup details.</div>}
            </div>
          )}
          {m.status === "paid" && (
            <div className="panel stack">
              <DealBreakdown qty={m.qty} unit={c.unit} price={c.final_cents ?? 0} normal={c.normal_cents} feeBps={m.fee_bps ?? 0} total={m.amount_cents ?? 0} />
              <p>
                {m.payment_method_id && !m.stripe_session_id && m.card_label ? <>We charged <strong>{usd(m.amount_cents)}</strong> to {m.card_label} automatically, as you authorized.</> : <>We received <strong>{usd(m.amount_cents)}</strong>.</>}{" "}
                {c.deal_note || "We’ll email you pickup or delivery details."}
              </p>
            </div>
          )}
          {m.status === "not_matched" && (
            <div className="panel"><p>GroupBuy #{code(c.number)} closed at {usd(c.final_cents)}, above your maximum of {usd(m.max_cents)}. You weren’t charged. We’ll let you know about the next round.</p></div>
          )}
          {m.status === "cancelled" && (
            <div className="panel"><p>Your spot was cancelled{m.refunded_cents ? ` and ${usd(m.refunded_cents)} was refunded to your card` : ""}.</p></div>
          )}

          {open && ["active", "withdrawn", "pending"].includes(m.status) && (
            <CommitEditor token={token} options={parseOptions(c)} maxCents={m.max_cents} qty={m.qty} maxPerBuyer={c.max_per_buyer}
              unit={c.unit} withdrawn={m.status === "withdrawn"} />
          )}
          {m.status === "active" && (
            <>
              <ShareBox url={shareUrl} title={c.title} nextTierText={nextTierText} />
              {(refs?.n ?? 0) > 0 && <p className="small muted">🙌 {refs!.n} {refs!.n === 1 ? "person" : "people"} joined through your link.</p>}
            </>
          )}
          {!open && m.status === "active" && (
            <div className="alert info">Joining has closed and we’re negotiating with sellers. You’ll get an email as soon as there’s a result.</div>
          )}
          <UpdatesList updates={updates} tz={tz} />
          <p className="small muted">Your maximum price only decides whether you’re in. Everyone in the group pays the same final price plus GroupBuy’s share of their savings, never more than the total shown when they joined. Keep this link private: it lets you change your commitment.</p>
        </div>
      </main>
      <Footer />
    </>
  );
}

function DealBreakdown({ qty, unit, price, normal, feeBps, total }: { qty: number; unit: string; price: number; normal: number; feeBps: number; total: number }) {
  const fee = feePerUnit(price, normal, feeBps);
  const x = qty > 1 ? ` × ${qty}` : "";
  return (
    <div className="fee-box small">
      <div className="row"><span>{unit[0].toUpperCase() + unit.slice(1)} at the group price ({usd(price)}{x})</span><div className="spacer" /><span>{usd(price * qty)}</span></div>
      {fee > 0 && <div className="row"><span className="muted">GroupBuy fee: {pct(feeBps)} of your {usd((normal - price) * qty)} savings</span><div className="spacer" /><span className="muted">{usd(fee * qty)}</span></div>}
      <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 6 }}><strong>Total</strong><div className="spacer" /><strong style={{ fontSize: "1.15rem" }}>{usd(total)}</strong></div>
      <div className="muted">You saved {usd(Math.max(0, normal * qty - total))} vs the normal price.</div>
    </div>
  );
}
