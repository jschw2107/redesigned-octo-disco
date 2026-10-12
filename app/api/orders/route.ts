import { NextResponse } from "next/server";
import { db, run } from "@/lib/db";
import { currentCycle, getSettings, type Product } from "@/lib/data";
import { handle, body } from "@/lib/http";
import { InputError, email, location, newOrderId, str } from "@/lib/validate";
import { paymentsEnabled, sessionExpiry, stripe } from "@/lib/stripe";
import { confirmUnpaidOrder, siteUrl } from "@/lib/fulfill";

export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const s = await getSettings();
  if (s.ordering_paused) throw new InputError("Ordering is paused right now. Join the waitlist to hear when it reopens.");

  const name = str(b.name, "Name", { max: 100 });
  const mail = email(b.email);
  const phone = str(b.phone, "Phone", { required: false, max: 30 });
  const loc = await location(b);

  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (!rawItems.length) throw new InputError("Your cart is empty");
  if (rawItems.length > 40) throw new InputError("Too many items");
  const qtyById = new Map<number, number>();
  for (const it of rawItems as Array<Record<string, unknown>>) {
    const id = Number(it?.product_id);
    const qty = Number(it?.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new InputError("Invalid item quantity");
    qtyById.set(id, (qtyById.get(id) ?? 0) + qty);
  }

  const c = await db();
  const ids = [...qtyById.keys()];
  const res = await c.execute({
    sql: `SELECT * FROM products WHERE active=1 AND price_cents IS NOT NULL AND id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  const products = res.rows.map((r) => Object.fromEntries(res.columns.map((col, i) => [col, r[i]]))) as unknown as Product[];
  if (products.length !== ids.length) throw new InputError("Some items in your cart are no longer available. Please refresh.");

  // Prices always come from the database, never from the browser.
  const lines = products.map((p) => ({ p, qty: qtyById.get(p.id)!, unit: p.price_cents! }));
  const total = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  const online = paymentsEnabled();
  if (online && total < 50) throw new InputError("The order total must be at least $0.50 for card payment.");

  const cycle = await currentCycle();
  const id = newOrderId();
  await c.batch(
    [
      {
        sql: `INSERT INTO orders (id, created_at, cycle_id, name, email, phone, university_id, university_name, hall_id, hall_name, off_campus, apartment, total_cents, status, payment_method)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [id, new Date().toISOString(), cycle.id, name, mail, phone, loc.uni.id, loc.uni.name, loc.hall?.id ?? null,
          loc.hallName, loc.offCampus ? 1 : 0, loc.apartment, total, online ? "pending_payment" : "placed", online ? "stripe" : "pickup"],
      },
      ...lines.map((l) => ({
        sql: "INSERT INTO order_items (order_id, product_id, product_name, unit_cents, qty) VALUES (?,?,?,?,?)",
        args: [id, l.p.id, l.p.name, l.unit, l.qty],
      })),
    ],
    "write"
  );

  const base = await siteUrl(req);
  if (!online) {
    await confirmUnpaidOrder(id, base);
    return NextResponse.json({ id });
  }

  // Online payment: send the student to Stripe Checkout. The order counts once payment succeeds.
  try {
    const session = await stripe()!.checkout.sessions.create({
      mode: "payment",
      customer_email: mail,
      client_reference_id: id,
      metadata: { kind: "order", order_id: id },
      payment_intent_data: { metadata: { kind: "order", order_id: id }, description: `GroupBuy order ${id}` },
      line_items: lines.map((l) => ({
        quantity: l.qty,
        price_data: {
          currency: "usd",
          unit_amount: l.unit,
          product_data: { name: l.p.name, ...(l.p.description ? { description: l.p.description } : {}), ...(l.p.image_url ? { images: [l.p.image_url] } : {}) },
        },
      })),
      expires_at: sessionExpiry(),
      success_url: `${base}/order/${id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/checkout?cancelled=1`,
    });
    await run("UPDATE orders SET stripe_session_id=? WHERE id=?", [session.id, id]);
    return NextResponse.json({ id, url: session.url });
  } catch (e) {
    console.error("[stripe] checkout session failed", e);
    await run("UPDATE orders SET status='expired' WHERE id=?", [id]);
    throw new InputError("We couldn't start the payment. Please try again in a minute.");
  }
});
