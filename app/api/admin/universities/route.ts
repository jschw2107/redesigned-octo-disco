import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { one, run } from "@/lib/db";
import { insertRow, updateRow } from "@/lib/admin";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";

const FIELDS = { name: "text", pickup_location: "text", active: "bool", sort: "int" } as const;

export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  if (!String(b.name ?? "").trim()) throw new InputError("University name is required");
  const id = await insertRow("universities", b, FIELDS);
  return NextResponse.json({ id });
});

export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  if ("name" in b && !String(b.name ?? "").trim()) throw new InputError("University name is required");
  await updateRow("universities", b.id, b, FIELDS);
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const id = Number(b.id);
  const used = await one("SELECT 1 FROM orders WHERE university_id=? LIMIT 1", [id]);
  if (used) throw new InputError("This university has orders, so it can't be deleted. Hide it instead.");
  await run("DELETE FROM halls WHERE university_id=?", [id]);
  await run("DELETE FROM universities WHERE id=?", [id]);
  return NextResponse.json({ ok: true });
});
