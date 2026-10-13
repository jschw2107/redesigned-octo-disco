import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { markCommitPaid, siteUrl } from "@/lib/fulfill";

// Stripe → your server. In the Stripe dashboard, add an endpoint for https://YOUR-SITE/api/stripe/webhook
// with the events checkout.session.completed and checkout.session.async_payment_succeeded.
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

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    const token = session.metadata?.kind === "commit" ? session.metadata?.token : null;
    if (token && session.payment_status === "paid") {
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      try {
        await markCommitPaid(token, pi, await siteUrl(req));
      } catch (e) {
        console.error("[stripe webhook]", e);
        return NextResponse.json({ error: "Handler failed" }, { status: 500 }); // Stripe will retry
      }
    }
  }
  // Expired or failed sessions need no action: the buyer keeps their spot and can try paying again.
  return NextResponse.json({ received: true });
}
