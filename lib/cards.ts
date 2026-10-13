import type Stripe from "stripe";
import { one, run } from "./db";
import { code, campaignPath, type Campaign } from "./campaigns";
import { stripe } from "./stripe";
import type { Commitment } from "./fulfill";

import { chargeConsent, unitTotal } from "./consent";
export { chargeConsent };
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

async function customerFor(m: Commitment) {
  const s = stripe()!;
  if (m.stripe_customer_id) return m.stripe_customer_id;
  // Reuse the customer from this student's other GroupBuys so their saved card follows them.
  const prev = await one<{ stripe_customer_id: string }>(
    "SELECT stripe_customer_id FROM commitments WHERE lower(email)=lower(?) AND stripe_customer_id IS NOT NULL LIMIT 1", [m.email]);
  const id = prev?.stripe_customer_id ?? (await s.customers.create({ email: m.email, name: m.name, metadata: { source: "groupbuy" } })).id;
  await run("UPDATE commitments SET stripe_customer_id=? WHERE id=?", [id, m.id]);
  return id;
}

/** Opens Stripe Checkout in "setup" mode: saves a card without charging it. */
export async function startCardSetup(m: Commitment, camp: Campaign, base: string) {
  const s = stripe()!;
  const customer = await customerFor(m);
  const session = await s.checkout.sessions.create({
    mode: "setup",
    payment_method_types: ["card"],
    customer,
    client_reference_id: m.token,
    metadata: { kind: "setup", token: m.token },
    setup_intent_data: { metadata: { kind: "setup", token: m.token }, description: `GroupBuy #${code(camp.number)} ${camp.title}` },
    custom_text: { submit: { message: chargeConsent(camp, m.max_cents, m.qty, m.fee_bps ?? 0) } },
    success_url: `${base}/c/${m.token}?setup_session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}${campaignPath(camp.number)}?card_cancelled=${m.token}`,
  });
  await run("UPDATE commitments SET setup_session_id=? WHERE id=?", [session.id, m.id]);
  return session.url!;
}

/**
 * Stores the card from a completed setup session. Idempotent: called from the return page and the webhook.
 * Returns true if this call activated a commitment that was waiting for its card.
 */
export async function saveCardFromSession(token: string, sessionId: string) {
  const s = stripe()!;
  const session = await s.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent.payment_method"] });
  if (session.metadata?.token !== token || session.status !== "complete") return false;
  const si = session.setup_intent as Stripe.SetupIntent | null;
  const pm = si?.payment_method as Stripe.PaymentMethod | string | null | undefined;
  if (!pm) return false;
  const pmId = typeof pm === "string" ? pm : pm.id;
  const card = typeof pm === "string" ? null : pm.card;
  const label = card ? `${card.brand[0].toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}` : "Card on file";
  const now = new Date().toISOString();
  const r = await run(
    `UPDATE commitments SET payment_method_id=?, card_label=?, charge_error=NULL, updated_at=?,
       status=CASE WHEN status='pending_card' THEN 'active' ELSE status END,
       confirmed_at=COALESCE(confirmed_at, ?)
     WHERE token=? AND (payment_method_id IS NULL OR payment_method_id != ?)`,
    [pmId, label, now, now, token, pmId]);
  return r.rowsAffected === 1;
}

export type ChargeResult = { ok: true; paymentIntent: string; processing: boolean } | { ok: false; error: string };

/** Charges a winner's saved card off-session for the clearing price × quantity (+ fee). */
export async function chargeSavedCard(m: Commitment, camp: Campaign, amountCents: number): Promise<ChargeResult> {
  const s = stripe();
  if (!s || !m.payment_method_id || !m.stripe_customer_id) return { ok: false, error: "No saved card" };
  // Hard cap: never charge more than the buyer authorized (their maximum price plus the agreed fee at that price).
  if (amountCents > m.qty * unitTotal(m.max_cents, camp.normal_cents, m.fee_bps ?? 0)) return { ok: false, error: "Amount exceeds the buyer's authorization" };
  try {
    const pi = await s.paymentIntents.create({
      amount: amountCents, currency: "usd", customer: m.stripe_customer_id, payment_method: m.payment_method_id,
      off_session: true, confirm: true, receipt_email: m.email,
      description: `GroupBuy #${code(camp.number)} ${camp.title} (${m.qty} × ${money(amountCents / m.qty)})`,
      metadata: { kind: "commit", token: m.token },
    }, { idempotencyKey: `groupbuy-charge-${m.token}` });
    if (pi.status === "succeeded") return { ok: true, paymentIntent: pi.id, processing: false };
    if (pi.status === "processing") return { ok: true, paymentIntent: pi.id, processing: true };
    return { ok: false, error: `Payment ${pi.status.replace(/_/g, " ")}` };
  } catch (e) {
    const err = e as { code?: string; message?: string; decline_code?: string };
    const reason = err.code === "authentication_required" ? "Your bank asked to confirm this payment"
      : err.decline_code ? `Card declined (${err.decline_code.replace(/_/g, " ")})` : err.message ?? "Charge failed";
    return { ok: false, error: reason };
  }
}

/** After a card is saved for the first time: send the "you're in" receipt. */
export async function sendJoinedReceipt(token: string, base: string) {
  const { getCommitment } = await import("./fulfill");
  const { getCampaign } = await import("./campaigns");
  const { commitJoinedEmail, sendEmail } = await import("./email");
  const { fmtDate, getSettings } = await import("./data");
  const m = await getCommitment(token);
  if (!m) return;
  const camp = await getCampaign({ id: m.campaign_id });
  if (!camp) return;
  const tz = (await getSettings()).timezone;
  await sendEmail(commitJoinedEmail({
    email: m.email, name: m.name, code: code(camp.number), title: camp.title, unit: camp.unit, qty: m.qty, maxCents: m.max_cents,
    targetCents: camp.target_cents, normalCents: camp.normal_cents, deadline: fmtDate(camp.deadline, tz),
    manageUrl: `${base}/c/${m.token}`, shareUrl: `${base}${campaignPath(camp.number)}?ref=${m.token}`, updated: false, card: m.card_label,
  }));
}
