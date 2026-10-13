import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { one, run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";

/** Approve (public, open for votes), reject, or turn a request into a draft GroupBuy. */
export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const id = Number(b.id);
  const r = await one<{ id: number; title: string; details: string; target_cents: number | null; status: string }>("SELECT * FROM requests WHERE id=?", [id]);
  if (!r) throw new InputError("Request not found");
  if (b.action === "approve" || b.action === "reject" || b.action === "pending") {
    await run("UPDATE requests SET status=? WHERE id=?", [b.action === "approve" ? "approved" : b.action === "reject" ? "rejected" : "pending", id]);
    return NextResponse.json({ ok: true });
  }
  if (b.action === "convert") {
    const n = await one<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 AS n FROM campaigns");
    const target = r.target_cents ?? 10000;
    const normal = Math.round(target * 1.25);
    const ins = await run(
      `INSERT INTO campaigns (number, title, summary, description, unit, normal_cents, target_cents, price_options, tiers, goal, max_per_buyer,
         deadline, status, created_at, sort, request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [n!.n, r.title, "", r.details, "item", normal, target, JSON.stringify([target]), "[]", 50, 1,
        new Date(Date.now() + 7 * 86400000).toISOString(), "draft", new Date().toISOString(), 99, r.id]);
    await run("UPDATE requests SET status='converted', campaign_id=? WHERE id=?", [Number(ins.lastInsertRowid), id]);
    return NextResponse.json({ ok: true, campaign_id: Number(ins.lastInsertRowid) });
  }
  throw new InputError("Unknown action");
});

export const DELETE = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  await run("DELETE FROM requests WHERE id=?", [Number(b.id)]);
  return NextResponse.json({ ok: true });
});
