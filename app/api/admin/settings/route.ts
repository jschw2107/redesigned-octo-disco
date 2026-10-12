import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { setSetting } from "@/lib/data";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";

export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin();
  if (denied) return denied;
  const b = await body(req);
  if ("cycle_days" in b) {
    const n = Number(b.cycle_days);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new InputError("Frequency must be between 1 and 365 days");
    await setSetting("cycle_days", String(n));
  }
  if ("pickup_offset_hours" in b) {
    const n = Number(b.pickup_offset_hours);
    if (!Number.isFinite(n) || n < 0 || n > 24 * 60) throw new InputError("Pickup delay must be between 0 and 1440 hours");
    await setSetting("pickup_offset_hours", String(n));
  }
  if ("timezone" in b) {
    const tz = String(b.timezone);
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { throw new InputError("Unknown time zone"); }
    await setSetting("timezone", tz);
  }
  if ("ordering_paused" in b) await setSetting("ordering_paused", b.ordering_paused ? "1" : "0");
  return NextResponse.json({ ok: true });
});
