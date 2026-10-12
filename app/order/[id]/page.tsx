import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { ClearCart, RefreshWhilePending } from "@/components/PaymentStatus";
import { all, one } from "@/lib/db";
import { fmtDate, fmtMoney, getSettings, pickupTime, type Cycle } from "@/lib/data";
import { stripe } from "@/lib/stripe";
import { markOrderPaid, siteUrl } from "@/lib/fulfill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your order — GroupBuy", robots: { index: false } };

type Order = {
  id: string; name: string; email: string; university_id: number; university_name: string; hall_name: string;
  apartment: string; total_cents: number; status: string; cycle_id: number; payment_method: string;
  stripe_session_id: string | null; refunded_cents: number;
};

const loadOrder = (id: string) => one<Order>("SELECT * FROM orders WHERE id=?", [id]);

export default async function OrderPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ session_id?: string }>;
}) {
  const { id } = await params;
  const { session_id } = await searchParams;
  let order = await loadOrder(id);
  if (!order) notFound();

  // Returning from Stripe: confirm the payment directly, in case the webhook hasn't arrived yet.
  if (order.status === "pending_payment" && session_id && session_id === order.stripe_session_id && stripe()) {
    try {
      const sess = await stripe()!.checkout.sessions.retrieve(session_id);
      if (sess.payment_status === "paid") {
        const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id ?? null;
        await markOrderPaid(id, pi, await siteUrl());
        order = (await loadOrder(id))!;
      }
    } catch (e) {
      console.error("[stripe] verify failed", e);
    }
  }

  const [items, cycle, uni, settings] = await Promise.all([
    all<{ product_name: string; qty: number; unit_cents: number }>("SELECT * FROM order_items WHERE order_id=?", [id]),
    one<Cycle>("SELECT * FROM cycles WHERE id=?", [order.cycle_id]),
    one<{ pickup_location: string }>("SELECT pickup_location FROM universities WHERE id=?", [order.university_id]),
    getSettings(),
  ]);
  const tz = settings.timezone;
  const first = order.name.split(" ")[0];
  const paidOnline = order.payment_method === "stripe";
  const confirmed = order.status === "placed" || order.status === "picked_up";

  const heading =
    order.status === "pending_payment" ? "Finishing your payment…"
    : order.status === "expired" ? "Payment wasn’t completed"
    : order.status === "cancelled" ? "This order was cancelled"
    : `You’re in, ${first}!`;

  return (
    <>
      <Header showNav={false} />
      {confirmed && session_id && <ClearCart />}
      {order.status === "pending_payment" && session_id && <RefreshWhilePending />}
      <main className="container section" style={{ paddingTop: 40, maxWidth: 760 }}>
        <div className="eyebrow">Order {order.id}</div>
        <h2>{heading}</h2>
        {confirmed && (
          <p className="lead">
            Your items joined {order.university_name}’s bulk buy. {paidOnline ? "Payment received. " : ""}
            We emailed a receipt to <strong>{order.email}</strong>.
          </p>
        )}
        {order.status === "pending_payment" && (
          <p className="lead">We’re waiting for confirmation from the payment processor. This page updates automatically. If you closed the payment page, your card wasn’t charged.</p>
        )}
        {order.status === "expired" && (
          <div className="stack" style={{ marginTop: 18 }}>
            <p className="lead">Your card wasn’t charged and this order didn’t go through. Your cart is still saved, so you can try again.</p>
            <div><Link className="btn accent" href="/checkout">Back to checkout</Link></div>
          </div>
        )}
        {order.status === "cancelled" && order.refunded_cents > 0 && (
          <p className="lead">{fmtMoney(order.refunded_cents)} was refunded to your card.</p>
        )}

        {order.status !== "expired" && (
          <div className="panel stack" style={{ marginTop: 32, gap: 18 }}>
            {cycle && (
              <div className="choices" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                <div><div className="small muted">Order placed with supplier</div><strong>{fmtDate(cycle.closes_at, tz)}</strong></div>
                <div><div className="small muted">Pickup starts</div><strong>{fmtDate(pickupTime(cycle, settings), tz)}</strong></div>
                <div><div className="small muted">Pickup point</div><strong>{uni?.pickup_location || "We’ll email you"}</strong></div>
                <div><div className="small muted">Residence</div><strong>{order.hall_name}{order.apartment ? ` · ${order.apartment}` : ""}</strong></div>
              </div>
            )}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th></tr></thead>
                <tbody>
                  {items.map((i, n) => (
                    <tr key={n}><td>{i.product_name}</td><td className="num">{i.qty}</td><td className="num">{fmtMoney(i.unit_cents * i.qty)}</td></tr>
                  ))}
                  <tr>
                    <td><strong>{paidOnline ? (confirmed ? "Total paid" : "Total") : "Total, paid at pickup"}</strong></td><td />
                    <td className="num"><strong>{fmtMoney(order.total_cents)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">Questions or changes? Reply to your confirmation email and mention order {order.id}.</p>
          </div>
        )}
        <Link className="btn ghost" href="/" style={{ marginTop: 24 }}>Back to GroupBuy</Link>
      </main>
    </>
  );
}
