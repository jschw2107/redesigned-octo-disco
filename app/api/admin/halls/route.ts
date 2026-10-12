import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { run } from "@/lib/db";
import { insertRow, updateRow } from "@/lib/admin";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";

const FIELDS = { university_id: "int", name: "text", sort: "int" } as const;

export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  if (!String(b.name ?? "").trim()) throw new InputError("Hall name is required");
  const id = await insertRow("halls", b, FIELDS);
  return NextResponse.json({ id });
});

export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  await updateRow("halls", b.id, b, { name: "text", sort: "int" });
  return NextResponse.json({ ok: true });
});

// Past orders keep the hall name they were placed with, so deleting a hall is always safe.
export const DELETE = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  await run("DELETE FROM halls WHERE id=?", [Number(b.id)]);
  return NextResponse.json({ ok: true });
});
