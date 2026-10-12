import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { run } from "@/lib/db";
import { currentCycle, getSettings } from "@/lib/data";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { addDaysInTz } from "@/lib/tz";

/** Change when the current order window closes. */
export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin();
  if (denied) return denied;
  const b = await body(req);
  const t = Date.parse(String(b.closes_at));
  if (!Number.isFinite(t)) throw new InputError("Pick a valid date and time");
  if (t <= Date.now()) throw new InputError("The close time must be in the future. Use “Close now” to close immediately.");
  const cycle = await currentCycle();
  await run("UPDATE cycles SET closes_at=? WHERE id=?", [new Date(t).toISOString(), cycle.id]);
  return NextResponse.json({ ok: true });
});

/** Close the current window right now; the next one opens on the regular schedule from now. */
export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin();
  if (denied) return denied;
  const b = await body(req);
  if (b.action !== "close_now") throw new InputError("Unknown action");
  const s = await getSettings();
  const cycle = await currentCycle();
  const now = new Date();
  await run("UPDATE cycles SET status='closed', closed_at=?, closes_at=? WHERE id=? AND status='open'", [now.toISOString(), now.toISOString(), cycle.id]);
  await run("INSERT INTO cycles (closes_at) VALUES (?)", [addDaysInTz(now.toISOString(), s.cycle_days, s.timezone)]);
  return NextResponse.json({ ok: true });
});
