import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { run } from "@/lib/db";
import { insertRow, updateRow } from "@/lib/admin";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";

const FIELDS = { name: "text", description: "text", image_url: "text", price_cents: "money", stock: "int", active: "bool" } as const;

export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  if (!String(b.name ?? "").trim()) throw new InputError("Item name is required");
  if (b.price_cents === "" || b.price_cents == null) throw new InputError("Price is required");
  const id = await insertRow("store_items", b, FIELDS);
  return NextResponse.json({ id });
});

export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  await updateRow("store_items", b.id, b, FIELDS);
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  await run("DELETE FROM store_items WHERE id=?", [Number(b.id)]);
  return NextResponse.json({ ok: true });
});
