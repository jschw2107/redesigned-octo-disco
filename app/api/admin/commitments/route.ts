import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { all } from "@/lib/db";
import { csv } from "@/lib/admin";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { cancelCommitment } from "@/lib/fulfill";

/** CSV export of buyers. ?campaign=<id> (optional) */
export const GET = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = new URL(req.url).searchParams.get("campaign");
  const rows = await all(
    `SELECT printf('%03d', c.number) AS groupbuy, c.title, m.created_at, m.status, m.name, m.email, m.university_name AS university,
            m.hall_name AS residence, m.apartment, m.qty, m.max_cents/100.0 AS max_price, m.amount_cents/100.0 AS amount_due,
            m.paid_at, m.refunded_cents/100.0 AS refunded, (SELECT name FROM commitments r WHERE r.token=m.ref) AS referred_by
     FROM commitments m JOIN campaigns c ON c.id=m.campaign_id ${id ? "WHERE c.id=?" : ""} ORDER BY c.number, m.created_at`,
    id ? [Number(id)] : []);
  return new NextResponse(csv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="groupbuy-buyers${id ? "-" + id : ""}.csv"` },
  });
});

/** Cancel a buyer's spot (refunds a card payment). */
export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  if (b.action !== "cancel") throw new InputError("Unknown action");
  const r = await cancelCommitment(Number(b.id));
  return NextResponse.json({ ok: true, ...r });
});
