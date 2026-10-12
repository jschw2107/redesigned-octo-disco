import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { run } from "@/lib/db";
import { insertRow, updateRow } from "@/lib/admin";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";

const FIELDS = {
  name: "text", description: "text", tag: "text", image_url: "text",
  price_cents: "nullable_money", retail_cents: "nullable_money", min_group: "int", active: "bool", sort: "int",
} as const;

export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  if (!String(b.name ?? "").trim()) throw new InputError("Product name is required");
  const id = await insertRow("products", b, FIELDS);
  return NextResponse.json({ id });
});

export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  await updateRow("products", b.id, b, FIELDS);
  return NextResponse.json({ ok: true });
});

// Order history stores product names and prices, so deleting a product doesn't change past orders.
export const DELETE = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  await run("DELETE FROM products WHERE id=?", [Number(b.id)]);
  return NextResponse.json({ ok: true });
});
