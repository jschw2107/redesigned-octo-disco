import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db, run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { getCampaign } from "@/lib/campaigns";

const MAX_BYTES = 1_500_000; // images are resized in the browser first; this is a safety limit
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Upload a product picture for a GroupBuy: { campaign_id, data_url, width?, height? }. Replaces the previous one. */
export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const camp = await getCampaign({ id: Number(b.campaign_id) });
  if (!camp) throw new InputError("GroupBuy not found");
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data_url ?? ""));
  if (!m || !TYPES.includes(m[1])) throw new InputError("Upload a JPG, PNG, WebP or GIF image");
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length) throw new InputError("The image is empty");
  if (bytes.length > MAX_BYTES) throw new InputError("That image is too large (max 1.5 MB after resizing)");

  const c = await db();
  const ins = await c.execute({
    sql: "INSERT INTO images (campaign_id, mime, data, bytes, width, height, created_at) VALUES (?,?,?,?,?,?,?)",
    args: [camp.id, m[1], new Uint8Array(bytes), bytes.length, Number(b.width) || null, Number(b.height) || null, new Date().toISOString()],
  });
  const id = Number(ins.lastInsertRowid);
  // Point the GroupBuy at the new picture and drop the old upload(s).
  await c.batch([
    { sql: "UPDATE campaigns SET image_url=? WHERE id=?", args: [`/api/images/${id}`, camp.id] },
    { sql: "DELETE FROM images WHERE campaign_id=? AND id != ?", args: [camp.id, id] },
  ], "write");
  return NextResponse.json({ ok: true, id, url: `/api/images/${id}` });
});

/** Remove the GroupBuy's picture (falls back to its emoji). */
export const DELETE = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const id = Number(b.campaign_id);
  await run("UPDATE campaigns SET image_url='' WHERE id=?", [id]);
  await run("DELETE FROM images WHERE campaign_id=?", [id]);
  return NextResponse.json({ ok: true });
});
