import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { all, run } from "@/lib/db";
import { csv } from "@/lib/admin";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { cancelExtraOrder, defaultExtraPrice } from "@/lib/extras";
import { getCampaign } from "@/lib/campaigns";

/** Edit extras stock/price, or cancel an extras order (refund + email). */
export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  if (b.action === "cancel") {
    const r = await cancelExtraOrder(Number(b.order_id));
    return NextResponse.json({ ok: true, ...r });
  }
  const id = Number(b.campaign_id);
  if ("units" in b) {
    const n = Number(b.units);
    if (!Number.isInteger(n) || n < 0) throw new InputError("Units must be 0 or more");
    await run("UPDATE campaigns SET extra_units=? WHERE id=?", [n, id]);
  }
  if ("price" in b && String(b.price ?? "").trim() !== "") {
    const c = Math.round(Number(String(b.price).replace(/[$,\s]/g, "")) * 100);
    if (!Number.isFinite(c) || c < 50) throw new InputError("Price must be at least $0.50");
    await run("UPDATE campaigns SET extra_cents=? WHERE id=?", [c, id]);
  }
  // Units with no price yet: use the default (group's all-in price + markup) so they go on sale right away.
  const camp = await getCampaign({ id });
  if (camp && camp.extra_units > 0 && !camp.extra_cents) {
    const d = await defaultExtraPrice(camp);
    if (d) await run("UPDATE campaigns SET extra_cents=? WHERE id=?", [d, id]);
    else throw new InputError("Set a price per unit to put these on sale");
  }
  return NextResponse.json({ ok: true });
});

/** CSV of extras orders: ?campaign=<id> */
export const GET = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = Number(new URL(req.url).searchParams.get("campaign"));
  const rows = await all(
    `SELECT code, created_at, status, name, email, university_name AS university, hall_name AS residence, room, apartment, qty,
            unit_cents/100.0 AS unit_price, amount_cents/100.0 AS total, refunded_cents/100.0 AS refunded FROM extra_orders WHERE campaign_id=? ORDER BY created_at`, [id]);
  return new NextResponse(csv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="groupbuy-extras-${id}.csv"` } });
});
