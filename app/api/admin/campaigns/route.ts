import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { one, run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { CAMPAIGN_STATUSES, getCampaign } from "@/lib/campaigns";
import { cancelCampaignOrders, notifyRequestVoters, siteUrl } from "@/lib/fulfill";

const cents = (v: unknown, field: string) => {
  const n = Math.round(Number(String(v ?? "").replace(/[$,\s]/g, "")) * 100);
  if (!Number.isFinite(n) || n <= 0) throw new InputError(`${field} must be a price like 199 or 19.99`);
  return n;
};
const int = (v: unknown, field: string, min = 1) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new InputError(`${field} must be a whole number of at least ${min}`);
  return n;
};
const text = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

/** "199, 189, 179" → [19900, 18900, 17900] */
function parseOptionsInput(v: unknown) {
  const arr = String(v ?? "").split(/[,\s]+/).filter(Boolean).map((x) => cents(x, "Price options"));
  return [...new Set(arr)].sort((a, b) => b - a);
}
/** lines "150 = 189" → [{units:150,cents:18900}] */
function parseTiersInput(v: unknown) {
  return String(v ?? "").split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(\d+)\s*(?:=|→|->|:|buyers?|units?)?\s*\$?\s*([\d.,]+)$/i.exec(l.replace(/\s+/g, " "));
    if (!m) throw new InputError(`Couldn't read tier "${l}". Use the format: 150 = 189`);
    return { units: int(m[1], "Tier size"), cents: cents(m[2], "Tier price") };
  }).sort((a, b) => a.units - b.units);
}

function fields(b: Record<string, unknown>) {
  const out: Record<string, string | number | null> = {};
  if ("title" in b) { out.title = text(b.title, 120); if (!out.title) throw new InputError("Title is required"); }
  for (const k of ["summary", "category", "emoji", "image_url", "unit"]) if (k in b) out[k] = text(b[k], k === "summary" ? 200 : 300);
  if ("description" in b) out.description = text(b.description, 4000);
  if ("deal_note" in b) out.deal_note = text(b.deal_note, 2000);
  if ("normal" in b) out.normal_cents = cents(b.normal, "Normal price");
  if ("target" in b) out.target_cents = cents(b.target, "Target price");
  if ("options" in b) out.price_options = JSON.stringify(parseOptionsInput(b.options));
  if ("tiers" in b) out.tiers = JSON.stringify(parseTiersInput(b.tiers));
  if ("goal" in b) out.goal = int(b.goal, "Buyers needed");
  if ("max_per_buyer" in b) out.max_per_buyer = int(b.max_per_buyer, "Max per buyer");
  if ("fee" in b) out.fee_cents = String(b.fee ?? "").trim() === "" ? 0 : Math.round(Number(String(b.fee).replace(/[$,\s]/g, "")) * 100);
  if ("sort" in b) out.sort = int(b.sort, "Sort", 0);
  if ("deadline" in b) {
    const t = Date.parse(String(b.deadline));
    if (!Number.isFinite(t)) throw new InputError("Pick a valid deadline");
    out.deadline = new Date(t).toISOString();
  }
  if ("status" in b) {
    if (!CAMPAIGN_STATUSES.includes(String(b.status))) throw new InputError("Unknown status");
    if (b.status === "deal") throw new InputError("Use “Lock in deal” to set a deal price.");
    out.status = String(b.status);
  }
  if (out.fee_cents != null && (!Number.isFinite(out.fee_cents as number) || (out.fee_cents as number) < 0)) throw new InputError("Fee must be 0 or more");
  return out;
}

export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const f = fields({ title: "New GroupBuy", normal: 100, target: 80, goal: 50, max_per_buyer: 1, ...b });
  const next = await one<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 AS n FROM campaigns");
  const deadline = f.deadline ?? new Date(Date.now() + 7 * 86400000).toISOString();
  const r = await run(
    `INSERT INTO campaigns (number, title, summary, description, category, emoji, unit, normal_cents, target_cents, price_options, tiers,
       goal, max_per_buyer, fee_cents, deadline, status, created_at, sort, request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [next!.n, f.title, f.summary ?? "", f.description ?? "", f.category ?? "", f.emoji ?? "🛍️", f.unit ?? "item", f.normal_cents, f.target_cents,
      f.price_options ?? JSON.stringify([f.target_cents]), f.tiers ?? "[]", f.goal, f.max_per_buyer, f.fee_cents ?? 0, deadline, "draft",
      new Date().toISOString(), f.sort ?? 99, b.request_id ? Number(b.request_id) : null]);
  return NextResponse.json({ id: Number(r.lastInsertRowid), number: next!.n });
});

export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const id = Number(b.id);
  const camp = await getCampaign({ id });
  if (!camp) throw new InputError("GroupBuy not found");
  const f = fields(b);
  if (camp.status === "deal" && f.status && !["closed", "cancelled"].includes(String(f.status))) {
    throw new InputError("A deal has been locked in. You can only close or cancel this GroupBuy now.");
  }
  const keys = Object.keys(f);
  if (!keys.length) throw new InputError("Nothing to update");
  await run(`UPDATE campaigns SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`, [...keys.map((k) => f[k]), id]);
  const fresh = (await getCampaign({ id }))!;
  const base = await siteUrl(req);
  // Cancelling a GroupBuy cancels every order in it: paid ones are refunded and everyone gets an email.
  if (f.status === "cancelled" && camp.status !== "cancelled") {
    const r = await cancelCampaignOrders(id, base);
    return NextResponse.json({ ok: true, ...r });
  }
  const notified = await notifyRequestVoters(fresh, base);
  return NextResponse.json({ ok: true, notified });
});

export const DELETE = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const id = Number(b.id);
  const used = await one("SELECT 1 FROM commitments WHERE campaign_id=? LIMIT 1", [id]);
  if (used) throw new InputError("People have joined this GroupBuy, so it can't be deleted. Cancel or close it instead.");
  await run("DELETE FROM campaigns WHERE id=?", [id]);
  return NextResponse.json({ ok: true });
});
