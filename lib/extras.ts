import crypto from "node:crypto";
import { all, db, one, run } from "./db";
import { code, campaignPath, getCampaign, getFeeBps, type Campaign } from "./campaigns";
import { feePerUnit } from "./consent";
import { sendEmail, extraPaidEmail, extraCancelledEmail } from "./email";
import { sessionExpiry, stripe } from "./stripe";

/**
 * Extras: when a seller agrees to the price but requires a bigger order than the group committed to,
 * the admin can buy the seller's minimum anyway. Units beyond what winners bought become "extras",
 * sold individually on the campaign page at a small markup over the group's all-in price.
 */

export type ExtraOrder = {
  id: number; code: string; campaign_id: number; created_at: string; updated_at: string; name: string; email: string;
  university_name: string; hall_name: string; room: string; apartment: string; qty: number; unit_cents: number; amount_cents: number;
  status: string; stripe_session_id: string | null; payment_intent: string | null; paid_at: string | null; refunded_cents: number;
};

export const DEFAULT_MARKUP_BPS = 1000; // 10%
const HOLD_MINUTES = 35; // Stripe keeps a checkout open ≥30 min; stock is held while the buyer pays

/** Price of one extra unit: the group's all-in price (deal + standard fee), plus the markup. */
export function extraPrice(dealCents: number, normalCents: number, feeBps: number, markupBps: number) {
  const allIn = dealCents + feePerUnit(dealCents, normalCents, feeBps);
  return Math.round(allIn * (1 + Math.max(0, markupBps) / 10000));
}

export const newExtraCode = () => "GX-" + crypto.randomBytes(6).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "7");

export const getExtraOrder = (c: string) => one<ExtraOrder>("SELECT * FROM extra_orders WHERE code=?", [c]);

/** Default price for leftover units of a locked deal (group's all-in price + standard markup). */
export async function defaultExtraPrice(c: Pick<Campaign, "final_cents" | "normal_cents">) {
  if (!c.final_cents) return null;
  return extraPrice(c.final_cents, c.normal_cents, await getFeeBps(), DEFAULT_MARKUP_BPS);
}

/**
 * Puts units back on the In stock page (e.g. a winner's order is cancelled after the deal was bought).
 * Keeps the admin's price if one is set; otherwise uses the default markup price.
 */
export async function addToStock(campaignId: number, qty: number) {
  const c = await getCampaign({ id: campaignId });
  if (!c || c.status !== "deal" || qty <= 0) return 0;
  const price = c.extra_cents ?? (await defaultExtraPrice(c));
  await run("UPDATE campaigns SET extra_units = extra_units + ?, extra_cents = COALESCE(extra_cents, ?) WHERE id=?", [qty, price, campaignId]);
  return qty;
}

export function extrasOnSale(c: Pick<Campaign, "status" | "extra_units" | "extra_cents">) {
  return c.status === "deal" && c.extra_units > 0 && !!c.extra_cents;
}

/**
 * Reserves stock atomically and opens Stripe Checkout. Without online payments the extras are simply
 * reserved for pickup ("reserved").
 */
export async function startExtraPurchase(opts: {
  camp: Campaign; qty: number; name: string; email: string; university: string; hall: string; room: string; apartment: string; base: string;
}) {
  const { camp, qty } = opts;
  const s = stripe();
  const c = await db();
  const now = new Date().toISOString();
  const orderCode = newExtraCode();
  const unit = camp.extra_cents!;
  const tx = await c.transaction("write");
  try {
    const upd = await tx.execute({
      sql: "UPDATE campaigns SET extra_units = extra_units - ? WHERE id=? AND status='deal' AND extra_units >= ?",
      args: [qty, camp.id, qty],
    });
    if (upd.rowsAffected !== 1) { await tx.rollback(); return { error: "Sorry, there aren't enough left for that quantity." as const }; }
    await tx.execute({
      sql: `INSERT INTO extra_orders (code, campaign_id, created_at, updated_at, name, email, university_name, hall_name, room, apartment,
              qty, unit_cents, amount_cents, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [orderCode, camp.id, now, now, opts.name, opts.email, opts.university, opts.hall, opts.room, opts.apartment,
        qty, unit, unit * qty, s ? "pending_payment" : "reserved"],
    });
    await tx.commit();
  } catch (e) {
    if (!tx.closed) await tx.rollback();
    throw e;
  }

  if (!s) {
    await sendExtraReceipt(orderCode, opts.base);
    return { code: orderCode, url: null };
  }
  try {
    const img = camp.image_url ? (camp.image_url.startsWith("/") ? `${opts.base}${camp.image_url}` : camp.image_url) : "";
    const session = await s.checkout.sessions.create({
      mode: "payment",
      customer_email: opts.email,
      client_reference_id: orderCode,
      metadata: { kind: "extra", code: orderCode },
      payment_intent_data: { metadata: { kind: "extra", code: orderCode }, description: `GroupBuy #${code(camp.number)} extras: ${camp.title}` },
      line_items: [{
        quantity: qty,
        price_data: {
          currency: "usd", unit_amount: unit,
          product_data: { name: `${camp.title} (GroupBuy #${code(camp.number)} extra)`, ...(/^https?:\/\//.test(img) ? { images: [img] } : {}) },
        },
      }],
      expires_at: sessionExpiry(),
      success_url: `${opts.base}/x/${orderCode}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${opts.base}${campaignPath(camp.number)}?extra_cancelled=${orderCode}`,
    });
    await run("UPDATE extra_orders SET stripe_session_id=? WHERE code=?", [session.id, orderCode]);
    return { code: orderCode, url: session.url };
  } catch (e) {
    console.error("[stripe] extras checkout failed", e);
    await releaseHold(orderCode);
    throw e;
  }
}

/** Puts held stock back (unpaid checkout abandoned, cancelled or expired). */
async function releaseHold(orderCode: string) {
  const c = await db();
  const tx = await c.transaction("write");
  try {
    const r = await tx.execute({
      sql: "UPDATE extra_orders SET status='expired', updated_at=? WHERE code=? AND status='pending_payment' RETURNING qty, campaign_id",
      args: [new Date().toISOString(), orderCode],
    });
    if (r.rows.length) await tx.execute({ sql: "UPDATE campaigns SET extra_units = extra_units + ? WHERE id=?", args: [r.rows[0][0], r.rows[0][1]] });
    await tx.commit();
  } catch (e) {
    if (!tx.closed) await tx.rollback();
    throw e;
  }
}

/** Marks an extras purchase as paid. Idempotent (webhook + return page). */
export async function markExtraPaid(orderCode: string, paymentIntent: string | null, base: string) {
  const now = new Date().toISOString();
  const o = await getExtraOrder(orderCode);
  if (!o) return false;
  if (o.status === "expired") {
    // Paid after the hold lapsed: take the stock back out (it can dip below zero; the admin sees it).
    await run("UPDATE campaigns SET extra_units = extra_units - ? WHERE id=?", [o.qty, o.campaign_id]);
  }
  const r = await run(
    "UPDATE extra_orders SET status='paid', paid_at=?, payment_intent=COALESCE(?, payment_intent), updated_at=? WHERE code=? AND status IN ('pending_payment','expired')",
    [now, paymentIntent, now, orderCode]);
  if (r.rowsAffected !== 1) return false;
  await sendExtraReceipt(orderCode, base);
  if (process.env.ADMIN_EMAIL) {
    await sendEmail({
      to: process.env.ADMIN_EMAIL, subject: `Extras sold: ${o.qty} × ${o.code} · $${(o.amount_cents / 100).toFixed(2)}`,
      html: `<p>${o.name} (${o.email}) bought ${o.qty} extra unit(s) for $${(o.amount_cents / 100).toFixed(2)}.</p>`,
      text: `${o.name} (${o.email}) bought ${o.qty} extra unit(s) for $${(o.amount_cents / 100).toFixed(2)}.`,
    });
  }
  return true;
}

async function sendExtraReceipt(orderCode: string, base: string) {
  const o = await getExtraOrder(orderCode);
  if (!o) return;
  const camp = await getCampaign({ id: o.campaign_id });
  if (!camp) return;
  await sendEmail(extraPaidEmail({
    email: o.email, name: o.name, code: o.code, campaignCode: code(camp.number), title: camp.title, unit: camp.unit, qty: o.qty,
    amountCents: o.amount_cents, paid: o.status === "paid", note: camp.deal_note, url: `${base}/x/${o.code}`,
  }));
}

/** Buyer backed out of Stripe Checkout: expire the session and release the stock right away. */
export async function cancelExtraCheckout(orderCode: string) {
  const o = await getExtraOrder(orderCode);
  if (!o || o.status !== "pending_payment") return;
  const s = stripe();
  if (s && o.stripe_session_id) {
    try {
      const sess = await s.checkout.sessions.retrieve(o.stripe_session_id);
      if (sess.payment_status === "paid") return; // paid after all: the webhook/return page will record it
      if (sess.status === "open") await s.checkout.sessions.expire(o.stripe_session_id);
    } catch { return; }
  }
  await releaseHold(orderCode);
}

/** Safety net: release holds whose checkout was abandoned (or record them if they were paid). */
export async function sweepExtraHolds(base: string) {
  const cutoff = new Date(Date.now() - HOLD_MINUTES * 60000).toISOString();
  const stale = await all<{ code: string; stripe_session_id: string | null }>(
    "SELECT code, stripe_session_id FROM extra_orders WHERE status='pending_payment' AND created_at < ? LIMIT 20", [cutoff]);
  const s = stripe();
  for (const o of stale) {
    if (s && o.stripe_session_id) {
      try {
        const sess = await s.checkout.sessions.retrieve(o.stripe_session_id);
        if (sess.payment_status === "paid") {
          const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id ?? null;
          await markExtraPaid(o.code, pi, base);
          continue;
        }
        if (sess.status === "open") await s.checkout.sessions.expire(o.stripe_session_id).catch(() => {});
      } catch { continue; } // Stripe unreachable: try again later
    }
    await releaseHold(o.code);
  }
}

/** Admin cancels an extras order: refunds a card payment and puts the units back on sale. */
export async function cancelExtraOrder(id: number) {
  const o = await one<ExtraOrder>("SELECT * FROM extra_orders WHERE id=?", [id]);
  if (!o || o.status === "cancelled" || o.status === "expired") return { refunded: 0 };
  let refunded = 0;
  const s = stripe();
  if (o.status === "paid" && s && o.payment_intent && o.refunded_cents === 0) {
    const r = await s.refunds.create({ payment_intent: o.payment_intent });
    refunded = r.amount ?? o.amount_cents;
  }
  const c = await db();
  await c.batch([
    { sql: "UPDATE extra_orders SET status='cancelled', refunded_cents=refunded_cents+?, updated_at=? WHERE id=?", args: [refunded, new Date().toISOString(), id] },
    { sql: "UPDATE campaigns SET extra_units = extra_units + ? WHERE id=?", args: [o.qty, o.campaign_id] },
  ], "write");
  const camp = await getCampaign({ id: o.campaign_id });
  if (camp && (o.status === "paid" || o.status === "reserved")) {
    await sendEmail(extraCancelledEmail({ email: o.email, name: o.name, code: o.code, title: camp.title, refundedCents: refunded }));
  }
  return { refunded };
}
