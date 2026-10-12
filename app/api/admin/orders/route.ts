import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { all, run } from "@/lib/db";
import { csv } from "@/lib/admin";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { cancelOrder } from "@/lib/fulfill";

const STATUSES = ["placed", "picked_up", "cancelled"];

/** CSV export. ?cycle=<id>&view=orders|totals */
export const GET = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const url = new URL(req.url);
  const cycle = Number(url.searchParams.get("cycle"));
  const view = url.searchParams.get("view") === "totals" ? "totals" : "orders";
  const rows = view === "totals"
    ? await all(
        `SELECT o.university_name AS university, oi.product_name AS product, SUM(oi.qty) AS units,
                COUNT(DISTINCT o.id) AS orders, SUM(oi.qty*oi.unit_cents)/100.0 AS revenue
         FROM order_items oi JOIN orders o ON o.id=oi.order_id
         WHERE o.cycle_id=? AND o.status IN ('placed','picked_up') GROUP BY o.university_name, oi.product_name ORDER BY 1,2`, [cycle])
    : await all(
        `SELECT o.id AS order_id, o.created_at, o.status, o.name, o.email, o.phone, o.university_name AS university,
                o.hall_name AS residence, o.apartment, oi.product_name AS product, oi.qty, oi.unit_cents/100.0 AS unit_price,
                o.total_cents/100.0 AS order_total, o.payment_method, o.refunded_cents/100.0 AS refunded
         FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.cycle_id=? ORDER BY o.created_at`, [cycle]);
  return new NextResponse(csv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="groupbuy-cycle-${cycle}-${view}.csv"`,
    },
  });
});

export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  if (!STATUSES.includes(String(b.status))) throw new InputError("Unknown status");
  if (b.status === "cancelled") {
    // Cancelling a paid order refunds the card in full and emails the student.
    const { refunded } = await cancelOrder(String(b.id));
    return NextResponse.json({ ok: true, refunded });
  }
  const r = await run("UPDATE orders SET status=? WHERE id=? AND status IN ('placed','picked_up')", [String(b.status), String(b.id)]);
  if (r.rowsAffected !== 1) throw new InputError("Only placed orders can change status (cancelled or unpaid orders can't be reopened).");
  return NextResponse.json({ ok: true });
});
