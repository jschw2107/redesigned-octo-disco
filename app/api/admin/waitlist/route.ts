import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { all, run } from "@/lib/db";
import { csv } from "@/lib/admin";
import { handle, body } from "@/lib/http";

export const GET = handle(async () => {
  const denied = await requireAdmin(); if (denied) return denied;
  const rows = await all(
    "SELECT created_at, email, university_name AS university, hall_name AS residence FROM waitlist ORDER BY created_at");
  return new NextResponse(csv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="groupbuy-waitlist.csv"' },
  });
});

export const DELETE = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  await run("DELETE FROM waitlist WHERE id=?", [Number(b.id)]);
  return NextResponse.json({ ok: true });
});
