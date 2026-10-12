import { headers } from "next/headers";
import { all, db, one, run } from "./db";
import { currentCycle, fmtDate, getSettings, pickupTime, type Cycle } from "./data";
import { adminNewOrderEmail, orderCancelledEmail, orderConfirmationEmail, reservationEmail, sendEmail, type OrderEmailData } from "./email";
import { stripe } from "./stripe";

/** Public base URL for links in emails and Stripe redirects. Set SITE_URL in production. */
export async function siteUrl(req?: Request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (req) return new URL(req.url).origin;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

type OrderRow = {
  id: string; name: string; email: string; university_id: number; university_name: string; hall_name: string; apartment: string;
  total_cents: number; status: string; cycle_id: number; payment_method: string; payment_intent: string | null; refunded_cents: number;
};

export async function orderEmailData(id: string, base: string): Promise<OrderEmailData | null> {
  const o = await one<OrderRow>("SELECT * FROM orders WHERE id=?", [id]);
  if (!o) return null;
  const [items, cycle, uni, s] = await Promise.all([
    all<{ product_name: string; qty: number; unit_cents: number }>("SELECT product_name, qty, unit_cents FROM order_items WHERE order_id=?", [id]),
    one<Cycle>("SELECT * FROM cycles WHERE id=?", [o.cycle_id]),
    one<{ pickup_location: string }>("SELECT pickup_location FROM universities WHERE id=?", [o.university_id]),
    getSettings(),
  ]);
  return {
    id: o.id, name: o.name, email: o.email, university: o.university_name,
    residence: o.apartment ? `${o.hall_name} · ${o.apartment}` : o.hall_name,
    total_cents: o.total_cents, paid: o.payment_method === "stripe",
    items: items.map((i) => ({ name: i.product_name, qty: i.qty, unit_cents: i.unit_cents })),
    closes: cycle ? fmtDate(cycle.closes_at, s.timezone) : "",
    pickup: cycle ? fmtDate(pickupTime(cycle, s), s.timezone) : "",
    pickupLocation: uni?.pickup_location || "We'll email you before pickup",
    url: `${base}/order/${o.id}`,
  };
}

async function sendOrderEmails(id: string, base: string) {
  const data = await orderEmailData(id, base);
  if (!data) return;
  await sendEmail(orderConfirmationEmail(data));
  if (process.env.ADMIN_EMAIL) await sendEmail(adminNewOrderEmail(data, process.env.ADMIN_EMAIL));
}

/** Pay-at-pickup orders: confirmed immediately. */
export async function confirmUnpaidOrder(id: string, base: string) {
  await sendOrderEmails(id, base);
}

/**
 * Marks a Stripe-paid order as placed. Idempotent: the webhook and the success page can both call it.
 * If the round closed while the student was paying, the order moves into the current round.
 */
export async function markOrderPaid(id: string, paymentIntent: string | null, base: string) {
  const r = await run(
    "UPDATE orders SET status='placed', paid_at=?, payment_intent=COALESCE(?, payment_intent) WHERE id=? AND status IN ('pending_payment','expired')",
    [new Date().toISOString(), paymentIntent, id]
  );
  if (r.rowsAffected !== 1) return false;
  const o = await one<{ cycle_id: number }>("SELECT cycle_id FROM orders WHERE id=?", [id]);
  const c = await one<Cycle>("SELECT * FROM cycles WHERE id=?", [o!.cycle_id]);
  if (c && c.status !== "open") {
    const cur = await currentCycle();
    await run("UPDATE orders SET cycle_id=? WHERE id=?", [cur.id, id]);
  }
  await sendOrderEmails(id, base);
  return true;
}

export async function expireOrder(id: string) {
  await run("UPDATE orders SET status='expired' WHERE id=? AND status='pending_payment'", [id]);
}

/* ---------- reservations ---------- */

type ResRow = {
  id: number; code: string; item_name: string; unit_cents: number; qty: number; name: string; email: string; university_name: string;
  hall_name: string; status: string; store_item_id: number; payment_method: string; payment_intent: string | null; refunded_cents: number;
  stripe_session_id: string | null; created_at: string;
};

export async function sendReservationEmail(code: string, base: string) {
  const r = await one<ResRow>("SELECT * FROM reservations WHERE code=?", [code]);
  if (!r) return;
  const uni = await one<{ pickup_location: string }>("SELECT pickup_location FROM universities WHERE name=?", [r.university_name]);
  await sendEmail(reservationEmail({
    code: r.code, name: r.name, email: r.email, item: r.item_name, qty: r.qty, unit_cents: r.unit_cents,
    paid: r.payment_method === "stripe", pickupLocation: uni?.pickup_location || "We'll email you", url: `${base}/reservation/${r.code}`,
  }));
}

export async function markReservationPaid(code: string, paymentIntent: string | null, base: string) {
  const c = await db();
  const tx = await c.transaction("write");
  let changed = false;
  try {
    const cur = await tx.execute({ sql: "SELECT status, qty, store_item_id FROM reservations WHERE code=?", args: [code] });
    if (cur.rows.length) {
      const row = cur.rows[0];
      const [status, qty, itemId] = [row[0] as string, row[1] as number, row[2] as number];
      if (status === "pending_payment" || status === "expired") {
        // An expired hold already returned its stock; take it back out (may go to 0 if it was resold — admin sees it).
        if (status === "expired") await tx.execute({ sql: "UPDATE store_items SET stock=MAX(0, stock-?) WHERE id=?", args: [qty, itemId] });
        await tx.execute({
          sql: "UPDATE reservations SET status='reserved', paid_at=?, payment_intent=COALESCE(?, payment_intent) WHERE code=?",
          args: [new Date().toISOString(), paymentIntent, code],
        });
        changed = true;
      }
    }
    await tx.commit();
  } catch (e) {
    if (!tx.closed) await tx.rollback();
    throw e;
  }
  if (changed) await sendReservationEmail(code, base);
  return changed;
}

/** Releases a held (unpaid) reservation and puts its stock back. */
export async function expireReservation(code: string) {
  const c = await db();
  const tx = await c.transaction("write");
  try {
    const r = await tx.execute({ sql: "UPDATE reservations SET status='expired' WHERE code=? AND status='pending_payment' RETURNING qty, store_item_id", args: [code] });
    if (r.rows.length) await tx.execute({ sql: "UPDATE store_items SET stock=stock+? WHERE id=?", args: [r.rows[0][0], r.rows[0][1]] });
    await tx.commit();
  } catch (e) {
    if (!tx.closed) await tx.rollback();
    throw e;
  }
}

/**
 * Safety net if a webhook is missed: unpaid checkouts older than 35 minutes are checked with Stripe,
 * then either confirmed (if paid) or released. Runs when the store or admin pages load.
 */
export async function sweepStaleCheckouts() {
  const s = stripe();
  const cutoff = new Date(Date.now() - 35 * 60000).toISOString();
  const res = await all<{ code: string; stripe_session_id: string | null }>(
    "SELECT code, stripe_session_id FROM reservations WHERE status='pending_payment' AND created_at < ? LIMIT 10", [cutoff]);
  const ords = await all<{ id: string; stripe_session_id: string | null }>(
    "SELECT id, stripe_session_id FROM orders WHERE status='pending_payment' AND created_at < ? LIMIT 10", [cutoff]);
  if (!res.length && !ords.length) return;
  const base = await siteUrl().catch(() => "");
  const check = async (sessionId: string | null) => {
    if (!s || !sessionId) return { paid: false, pi: null };
    try {
      const sess = await s.checkout.sessions.retrieve(sessionId);
      if (sess.status === "open") await s.checkout.sessions.expire(sessionId).catch(() => {});
      return { paid: sess.payment_status === "paid", pi: typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id ?? null };
    } catch {
      return null; // Stripe unreachable: try again later
    }
  };
  for (const r of res) {
    const st = await check(r.stripe_session_id);
    if (!st) continue;
    if (st.paid) await markReservationPaid(r.code, st.pi, base);
    else await expireReservation(r.code);
  }
  for (const o of ords) {
    const st = await check(o.stripe_session_id);
    if (!st) continue;
    if (st.paid) await markOrderPaid(o.id, st.pi, base);
    else await expireOrder(o.id);
  }
}

/* ---------- refunds ---------- */

/** Full refund of a Stripe payment. Returns cents refunded (0 if nothing to refund). */
export async function refund(paymentIntent: string | null, alreadyRefunded: number, amount: number) {
  const s = stripe();
  if (!s || !paymentIntent || alreadyRefunded > 0) return 0;
  const r = await s.refunds.create({ payment_intent: paymentIntent });
  return r.amount ?? amount;
}

export async function cancelOrder(id: string) {
  const o = await one<OrderRow>("SELECT * FROM orders WHERE id=?", [id]);
  if (!o || o.status === "cancelled") return { refunded: 0 };
  const wasPaid = o.payment_method === "stripe" && (o.status === "placed" || o.status === "picked_up");
  const refunded = wasPaid ? await refund(o.payment_intent, o.refunded_cents, o.total_cents) : 0;
  await run("UPDATE orders SET status='cancelled', refunded_cents=refunded_cents+? WHERE id=?", [refunded, id]);
  if (o.status !== "pending_payment" && o.status !== "expired") {
    await sendEmail(orderCancelledEmail({ id: o.id, name: o.name, email: o.email, refunded_cents: refunded }));
  }
  return { refunded };
}

export async function cancelReservation(id: number) {
  const r = await one<ResRow>("SELECT * FROM reservations WHERE id=?", [id]);
  if (!r || r.status === "cancelled") return { refunded: 0 };
  const wasPaid = r.payment_method === "stripe" && (r.status === "reserved" || r.status === "picked_up");
  const refunded = wasPaid ? await refund(r.payment_intent, r.refunded_cents, r.unit_cents * r.qty) : 0;
  const c = await db();
  const tx = await c.transaction("write");
  try {
    // Stock goes back unless the hold had already expired (expiry restocks on its own).
    if (r.status !== "expired") await tx.execute({ sql: "UPDATE store_items SET stock=stock+? WHERE id=?", args: [r.qty, r.store_item_id] });
    await tx.execute({ sql: "UPDATE reservations SET status='cancelled', refunded_cents=refunded_cents+? WHERE id=?", args: [refunded, id] });
    await tx.commit();
  } catch (e) {
    if (!tx.closed) await tx.rollback();
    throw e;
  }
  if (r.status === "reserved" || r.status === "picked_up") {
    await sendEmail(orderCancelledEmail({ id: r.code ?? `#${r.id}`, name: r.name, email: r.email, refunded_cents: refunded, kind: "reservation" }));
  }
  return { refunded };
}
