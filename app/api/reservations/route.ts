import { NextResponse } from "next/server";
import { db, run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError, email, location, newOrderId, str } from "@/lib/validate";
import { paymentsEnabled, sessionExpiry, stripe } from "@/lib/stripe";
import { expireReservation, sendReservationEmail, siteUrl } from "@/lib/fulfill";

export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const name = str(b.name, "Name", { max: 100 });
  const mail = email(b.email);
  const loc = await location(b);
  const itemId = Number(b.store_item_id);
  const qty = Number(b.qty);
  if (!Number.isInteger(itemId)) throw new InputError("Choose an item");
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new InputError("Quantity must be between 1 and 10");

  const online = paymentsEnabled();
  const code = newOrderId().replace("GB-", "GR-");
  const c = await db();
  const tx = await c.transaction("write");
  let itemName = "";
  let price = 0;
  let image = "";
  try {
    // Atomic stock check + decrement, so two students can't reserve the last unit.
    // With online payment this is a 30-minute hold that is released if payment doesn't finish.
    const upd = await tx.execute({
      sql: "UPDATE store_items SET stock = stock - ? WHERE id=? AND active=1 AND stock >= ?",
      args: [qty, itemId, qty],
    });
    if (upd.rowsAffected !== 1) {
      await tx.rollback();
      throw new InputError("Sorry, there isn't enough stock left for that quantity.");
    }
    const item = await tx.execute({ sql: "SELECT name, price_cents, image_url FROM store_items WHERE id=?", args: [itemId] });
    [itemName, price, image] = [item.rows[0][0] as string, item.rows[0][1] as number, item.rows[0][2] as string];
    if (online && price * qty < 50) {
      await tx.rollback();
      throw new InputError("The total must be at least $0.50 for card payment.");
    }
    const hall = loc.offCampus && loc.apartment ? `${loc.hallName} (${loc.apartment})` : loc.hallName;
    await tx.execute({
      sql: `INSERT INTO reservations (created_at, store_item_id, item_name, unit_cents, qty, name, email, university_name, hall_name, status, code, payment_method)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [new Date().toISOString(), itemId, itemName, price, qty, name, mail, loc.uni.name, hall,
        online ? "pending_payment" : "reserved", code, online ? "stripe" : "pickup"],
    });
    await tx.commit();
  } catch (e) {
    if (!tx.closed) await tx.rollback();
    throw e;
  }

  const base = await siteUrl(req);
  if (!online) {
    await sendReservationEmail(code, base);
    return NextResponse.json({ code });
  }

  try {
    const session = await stripe()!.checkout.sessions.create({
      mode: "payment",
      customer_email: mail,
      client_reference_id: code,
      metadata: { kind: "reservation", code },
      payment_intent_data: { metadata: { kind: "reservation", code }, description: `GroupBuy reservation ${code}` },
      line_items: [{ quantity: qty, price_data: { currency: "usd", unit_amount: price, product_data: { name: itemName, ...(image ? { images: [image] } : {}) } } }],
      expires_at: sessionExpiry(),
      success_url: `${base}/reservation/${code}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?reservation_cancelled=1#individual-store`,
    });
    await run("UPDATE reservations SET stripe_session_id=? WHERE code=?", [session.id, code]);
    return NextResponse.json({ code, url: session.url });
  } catch (e) {
    console.error("[stripe] checkout session failed", e);
    await expireReservation(code);
    throw new InputError("We couldn't start the payment. Please try again in a minute.");
  }
});
