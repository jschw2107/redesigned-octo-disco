import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";

export const PATCH = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  if ("email_domains" in b) {
    const list = String(b.email_domains ?? "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
    for (const d of list) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new InputError(`"${d}" doesn't look like an email domain`);
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('email_domains', ?)", [list.join(", ")]);
  }
  if ("fee_pct" in b) {
    const v = Number(String(b.fee_pct).replace("%", "").trim());
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new InputError("Fee must be a percentage between 0 and 100");
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('savings_fee_bps', ?)", [String(Math.round(v * 100))]);
  }
  if ("timezone" in b) {
    const tz = String(b.timezone);
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { throw new InputError("Unknown time zone"); }
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', ?)", [tz]);
  }
  return NextResponse.json({ ok: true });
});
