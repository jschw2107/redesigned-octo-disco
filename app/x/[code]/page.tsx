import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Header } from "@/components/Header";
import { CampaignVisual } from "@/components/CampaignCard";
import { RefreshWhilePending } from "@/components/CommitManager";
import { all } from "@/lib/db";
import { fmtDate, getSettings } from "@/lib/data";
import { campaignPath, code, getCampaign, plural, usd } from "@/lib/campaigns";
import { getExtraOrder, markExtraPaid } from "@/lib/extras";
import { siteUrl } from "@/lib/fulfill";
import { stripe } from "@/lib/stripe";
import { UpdatesList, type Update } from "@/components/Updates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your GroupBuy extras order", robots: { index: false } };

export default async function ExtraOrderPage({ params, searchParams }: {
  params: Promise<{ code: string }>; searchParams: Promise<{ session_id?: string }>;
}) {
  const { code: orderCode } = await params;
  const sp = await searchParams;
  let o = await getExtraOrder(orderCode);
  if (!o) notFound();
  // Back from Stripe: record the payment now in case the webhook hasn't arrived yet.
  if (o.status === "pending_payment" && sp.session_id && sp.session_id === o.stripe_session_id && stripe()) {
    try {
      const sess = await stripe()!.checkout.sessions.retrieve(sp.session_id);
      if (sess.payment_status === "paid") {
        const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id ?? null;
        await markExtraPaid(orderCode, pi, await siteUrl());
        o = (await getExtraOrder(orderCode))!;
      }
    } catch (e) { console.error("[stripe] verify failed", e); }
  }
  const c = (await getCampaign({ id: o.campaign_id }))!;
  const tz = (await getSettings()).timezone;
  const updates = await all<Update>(
    "SELECT * FROM updates WHERE campaign_id=? AND audience IN ('everyone','extras') ORDER BY created_at DESC", [c.id]);
  const heading = { paid: "Paid: you’re all set ✓", reserved: "Reserved for pickup", pending_payment: "Finishing your payment…",
    expired: "Payment wasn’t completed", cancelled: "This order was cancelled", picked_up: "Picked up ✓" }[o.status] ?? o.status;

  return (
    <>
      <Header />
      {o.status === "pending_payment" && sp.session_id && <RefreshWhilePending />}
      <main className="container section" style={{ paddingTop: 32, maxWidth: 760 }}>
        <Link href={campaignPath(c.number)} className="small muted">← GroupBuy #{code(c.number)}: {c.title}</Link>
        <div className="row" style={{ marginTop: 14, flexWrap: "nowrap", gap: 18 }}>
          <div style={{ width: 84, flexShrink: 0 }}><CampaignVisual c={c} /></div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Extras order {o.code}</div>
            <h2 style={{ fontSize: "2rem" }}>{heading}</h2>
          </div>
        </div>
        <div className="panel" style={{ marginTop: 22 }}>
          <div className="choices" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <div><div className="small muted">Item</div><strong>{o.qty} {plural(o.qty, c.unit)} · {c.title}</strong></div>
            <div><div className="small muted">{o.status === "paid" ? "Paid" : "Total"}</div><strong>{usd(o.amount_cents)}</strong></div>
            <div><div className="small muted">Deliver to</div><strong>{o.hall_name}{o.room ? `, Room ${o.room}` : ""}{o.apartment ? ` · ${o.apartment}` : ""}</strong></div>
            <div><div className="small muted">Ordered</div><strong>{fmtDate(o.created_at, tz)}</strong></div>
          </div>
        </div>
        <div className="stack" style={{ gap: 16, marginTop: 18 }}>
          {(o.status === "paid" || o.status === "reserved") && <div className="panel"><p>{c.deal_note || "We’ll email you pickup or delivery details."}</p></div>}
          {o.status === "expired" && <div className="alert warn">Your card wasn’t charged and the items went back on sale. <Link href={campaignPath(c.number)}>Try again →</Link></div>}
          {o.status === "cancelled" && <div className="alert info">Cancelled{o.refunded_cents ? `: ${usd(o.refunded_cents)} was refunded to your card` : ""}.</div>}
          <UpdatesList updates={updates} tz={tz} />
        </div>
      </main>
      <Footer />
    </>
  );
}
