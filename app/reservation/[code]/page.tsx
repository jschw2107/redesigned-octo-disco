import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { RefreshWhilePending } from "@/components/PaymentStatus";
import { one } from "@/lib/db";
import { fmtMoney } from "@/lib/data";
import { stripe } from "@/lib/stripe";
import { markReservationPaid, siteUrl } from "@/lib/fulfill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your reservation — GroupBuy", robots: { index: false } };

type Res = {
  code: string; item_name: string; qty: number; unit_cents: number; name: string; email: string; university_name: string;
  hall_name: string; status: string; payment_method: string; stripe_session_id: string | null; refunded_cents: number;
};
const load = (code: string) => one<Res>("SELECT * FROM reservations WHERE code=?", [code]);

export default async function ReservationPage({ params, searchParams }: {
  params: Promise<{ code: string }>; searchParams: Promise<{ session_id?: string }>;
}) {
  const { code } = await params;
  const { session_id } = await searchParams;
  let r = await load(code);
  if (!r) notFound();

  if (r.status === "pending_payment" && session_id && session_id === r.stripe_session_id && stripe()) {
    try {
      const sess = await stripe()!.checkout.sessions.retrieve(session_id);
      if (sess.payment_status === "paid") {
        const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id ?? null;
        await markReservationPaid(code, pi, await siteUrl());
        r = (await load(code))!;
      }
    } catch (e) {
      console.error("[stripe] verify failed", e);
    }
  }
  const uni = await one<{ pickup_location: string }>("SELECT pickup_location FROM universities WHERE name=?", [r.university_name]);
  const total = r.unit_cents * r.qty;
  const active = r.status === "reserved" || r.status === "picked_up";

  return (
    <>
      <Header showNav={false} />
      {r.status === "pending_payment" && session_id && <RefreshWhilePending />}
      <main className="container section" style={{ paddingTop: 40, maxWidth: 680 }}>
        <div className="eyebrow">Reservation {r.code}</div>
        <h2>
          {active ? "It’s set aside for you" : r.status === "pending_payment" ? "Finishing your payment…" : r.status === "expired" ? "Payment wasn’t completed" : "This reservation was cancelled"}
        </h2>
        {r.status === "expired" && <p className="lead">Your card wasn’t charged and the item went back on the shelf.</p>}
        {r.status === "cancelled" && r.refunded_cents > 0 && <p className="lead">{fmtMoney(r.refunded_cents)} was refunded to your card.</p>}
        <div className="panel stack" style={{ marginTop: 28 }}>
          <div className="row"><span>{r.qty} × {r.item_name}</span><div className="spacer" /><strong>{fmtMoney(total)}</strong></div>
          <div className="small muted">
            {r.payment_method === "stripe" ? (active ? "Paid online" : "Card payment") : "Pay at pickup"} · Pickup at <strong>{uni?.pickup_location || "the campus pickup point"}</strong>
          </div>
          {active && <p className="small muted">We emailed the details to {r.email}.</p>}
        </div>
        <Link className="btn ghost" href="/" style={{ marginTop: 24 }}>Back to GroupBuy</Link>
      </main>
    </>
  );
}
