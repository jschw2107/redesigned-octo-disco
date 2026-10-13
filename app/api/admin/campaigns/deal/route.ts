import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { clearing, getCampaign, getFeeBps } from "@/lib/campaigns";
import { DEFAULT_MARKUP_BPS, extraPrice } from "@/lib/extras";
import { lockDeal, siteUrl } from "@/lib/fulfill";
import { all } from "@/lib/db";
import { feePerUnit } from "@/lib/consent";

const priceOf = (v: unknown) => {
  const n = Math.round(Number(String(v ?? "").replace(/[$,\s]/g, "")) * 100);
  if (!Number.isFinite(n) || n <= 0) throw new InputError("Enter the seller's price, like 104");
  return n;
};
const capOf = (v: unknown) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new InputError("Unit cap must be a whole number");
  return n;
};

/** Seller's minimum order (units). Empty = no minimum. */
const minOf = (v: unknown) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new InputError("Seller's minimum must be a whole number");
  return n;
};
/** Markup on extra units, entered as a percent ("10"). */
const markupOf = (v: unknown) => {
  if (v === undefined || v === null || String(v).trim() === "") return DEFAULT_MARKUP_BPS;
  const n = Number(String(v).replace(/[%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 200) throw new InputError("Markup must be between 0 and 200%");
  return Math.round(n * 100);
};

/** Preview: who would get the deal at this price. */
export const GET = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const u = new URL(req.url);
  const camp = await getCampaign({ id: Number(u.searchParams.get("id")) });
  if (!camp) throw new InputError("GroupBuy not found");
  const price = priceOf(u.searchParams.get("price"));
  const r = await clearing(camp.id, price, capOf(u.searchParams.get("cap")));
  const rows = r.eligible.length
    ? await all<{ qty: number; fee_bps: number | null }>(`SELECT qty, fee_bps FROM commitments WHERE id IN (${r.eligible.map(() => "?").join(",")})`, r.eligible)
    : [];
  const fees = rows.reduce((s, x) => s + x.qty * feePerUnit(price, camp.normal_cents, x.fee_bps ?? 0), 0);
  // Seller requires a bigger order? The rest is bought anyway and sold as extras at a markup.
  const minOrder = minOf(u.searchParams.get("min"));
  const bought = Math.max(r.units, minOrder ?? 0);
  const extraUnits = bought - r.units;
  const extraUnit = extraPrice(price, camp.normal_cents, await getFeeBps(), markupOf(u.searchParams.get("markup")));
  return NextResponse.json({ price, buyers: r.buyers, units: r.units, value: r.value, left: r.left.length, fees, charged: r.value + fees,
    savings: Math.max(0, camp.normal_cents - price) * r.units,
    bought, extraUnits, extraUnit, sellerCost: bought * price, extrasValue: extraUnits * extraUnit });
});

/** Lock in the seller's price: winners get a payment link, everyone else is told they weren't charged. */
export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const camp = await getCampaign({ id: Number(b.id) });
  if (!camp) throw new InputError("GroupBuy not found");
  if (!["live", "negotiating"].includes(camp.status)) throw new InputError("This GroupBuy isn't open for a deal.");
  const price = priceOf(b.price);
  const payBy = Date.parse(String(b.pay_by));
  if (!Number.isFinite(payBy) || payBy < Date.now()) throw new InputError("Pick a payment deadline in the future");
  const r = await lockDeal({
    campaignId: camp.id, priceCents: price, unitCap: capOf(b.cap), payBy: new Date(payBy).toISOString(),
    note: String(b.note ?? "").slice(0, 2000), base: await siteUrl(req),
    minOrder: minOf(b.min), markupBps: markupOf(b.markup),
  });
  if (r.buyers === 0) return NextResponse.json({ ok: true, warning: "Nobody qualified at that price.", ...r });
  return NextResponse.json({ ok: true, won: r.won, missed: r.missed, charged: r.charged, failed: r.failed, units: r.units, value: r.value,
    bought: r.bought, extraUnits: r.extraUnits, extraUnit: r.extraUnit });
});
