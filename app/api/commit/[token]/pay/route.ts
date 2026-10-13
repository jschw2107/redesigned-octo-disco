import { NextResponse } from "next/server";
import { run } from "@/lib/db";
import { handle } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { code, getCampaign } from "@/lib/campaigns";
import { getCommitment, siteUrl } from "@/lib/fulfill";
import { feePerUnit, pct } from "@/lib/consent";
import { sessionExpiry, stripe } from "@/lib/stripe";

/** A buyer who won the deal pays the clearing price through Stripe Checkout. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const m = await getCommitment(token);
  if (!m) throw new InputError("Commitment not found");
  const camp = (await getCampaign({ id: m.campaign_id }))!;
  if (m.status === "paid") throw new InputError("You've already paid. You're all set.");
  if (m.status !== "won" || camp.status !== "deal" || !camp.final_cents) throw new InputError("There's nothing to pay for yet.");
  if (camp.pay_by && Date.parse(camp.pay_by) < Date.now()) throw new InputError("The payment window for this deal has closed. Reply to your deal email if you still want in.");
  const s = stripe();
  if (!s) throw new InputError("Online payment isn't set up yet. We'll email you how to pay.");

  const base = await siteUrl(req);
  const fee = feePerUnit(camp.final_cents, camp.normal_cents, m.fee_bps ?? 0);
  if (m.amount_cents != null && m.amount_cents !== m.qty * (camp.final_cents + fee)) throw new InputError("Amount mismatch. Please contact us.");
  const session = await s.checkout.sessions.create({
    mode: "payment",
    customer_email: m.email,
    client_reference_id: m.token,
    metadata: { kind: "commit", token: m.token },
    payment_intent_data: { metadata: { kind: "commit", token: m.token }, description: `GroupBuy #${code(camp.number)} ${camp.title}` },
    line_items: [
      {
        quantity: m.qty,
        price_data: {
          currency: "usd", unit_amount: camp.final_cents,
          product_data: { name: `GroupBuy #${code(camp.number)}: ${camp.title}`, ...(camp.summary ? { description: camp.summary } : {}), ...(camp.image_url ? { images: [camp.image_url] } : {}) },
        },
      },
      ...(fee > 0 ? [{
        quantity: m.qty,
        price_data: {
          currency: "usd", unit_amount: fee,
          product_data: { name: `GroupBuy fee: ${pct(m.fee_bps ?? 0)} of your savings`, description: `You save $${((camp.normal_cents - camp.final_cents) / 100).toFixed(2)} per item vs the normal price` },
        },
      }] : []),
    ],
    expires_at: sessionExpiry(),
    success_url: `${base}/c/${m.token}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/c/${m.token}`,
  });
  await run("UPDATE commitments SET stripe_session_id=? WHERE id=?", [session.id, m.id]);
  return NextResponse.json({ url: session.url });
});
