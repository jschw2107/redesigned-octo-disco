import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { cancelReservation } from "@/lib/fulfill";

/** Mark a reservation picked up, or cancel it (puts units back in stock and refunds a card payment). */
export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const status = String(b.status);
  if (!["reserved", "picked_up", "cancelled"].includes(status)) throw new InputError("Unknown status");
  if (status === "cancelled") {
    const { refunded } = await cancelReservation(Number(b.id));
    return NextResponse.json({ ok: true, refunded });
  }
  const r = await run("UPDATE reservations SET status=? WHERE id=? AND status IN ('reserved','picked_up')", [status, Number(b.id)]);
  if (r.rowsAffected !== 1) throw new InputError("Only active reservations can change status.");
  return NextResponse.json({ ok: true });
});
