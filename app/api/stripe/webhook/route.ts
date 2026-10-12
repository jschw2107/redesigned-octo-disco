import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { expireOrder, expireReservation, markOrderPaid, markReservationPaid, siteUrl } from "@/lib/fulfill";

// Stripe → your server. In the Stripe dashboard, add an endpoint for https://YOUR-SITE/api/stripe/webhook
// with the events checkout.session.completed, checkout.session.async_payment_succeeded,
// checkout.session.async_payment_failed and checkout.session.expired.
export async function POST(req: Request) {
  const s = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) return NextResponse.json({ error: "Payments not configured" }, { status: 503 });

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(payload, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!event.type.startsWith("checkout.session.")) return NextResponse.json({ received: true });
  const session = event.data.object as Stripe.Checkout.Session;
  const kind = session.metadata?.kind;
  const ref = kind === "order" ? session.metadata?.order_id : session.metadata?.code;
  if (!ref) return NextResponse.json({ received: true });
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const base = await siteUrl(req);

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (session.payment_status === "paid") {
          if (kind === "order") await markOrderPaid(ref, pi, base);
          else await markReservationPaid(ref, pi, base);
        }
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        if (kind === "order") await expireOrder(ref);
        else await expireReservation(ref);
        break;
    }
  } catch (e) {
    console.error("[stripe webhook]", e);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 }); // Stripe will retry
  }
  return NextResponse.json({ received: true });
}
