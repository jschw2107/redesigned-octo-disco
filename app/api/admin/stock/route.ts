import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { one, run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";

const cents = (v: unknown, field: string, min = 50) => {
  const n = Math.round(Number(String(v ?? "").replace(/[$,\s]/g, "")) * 100);
  if (!Number.isFinite(n) || n < min) throw new InputError(`${field} must be a price like 199 or 19.99`);
  return n;
};
const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Adds a product straight to the In stock page, without a GroupBuy round. */
export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const title = text(b.title, 120);
  if (!title) throw new InputError("Product name is required");
  const price = cents(b.price, "Sale price");
  const normal = String(b.normal ?? "").trim() ? cents(b.normal, "Normal price") : price;
  if (normal < price) throw new InputError("Normal price should be at least the sale price");
  const units = Number(b.units);
  if (!Number.isInteger(units) || units < 1) throw new InputError("Units must be a whole number of at least 1");
  const now = new Date().toISOString();
  const next = await one<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 AS n FROM campaigns");
  const r = await run(
    `INSERT INTO campaigns (number, title, summary, description, category, emoji, unit, normal_cents, target_cents, price_options, tiers,
       goal, max_per_buyer, fee_cents, deadline, status, created_at, sort, final_cents, pay_by, deal_note, bought_units, extra_units, extra_cents, stock_only)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'deal',?,?,?,NULL,'',?,?,?,1)`,
    [next!.n, title, text(b.summary, 200), text(b.description, 4000), text(b.category, 60), text(b.emoji, 8) || "📦", text(b.unit, 40) || "item",
      normal, price, JSON.stringify([price]), "[]", units, 10, 0, now, now, 99, price, units, units, price]);
  return NextResponse.json({ id: Number(r.lastInsertRowid), number: next!.n });
});
