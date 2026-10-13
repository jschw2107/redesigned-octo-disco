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
  if ("timezone" in b) {
    const tz = String(b.timezone);
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { throw new InputError("Unknown time zone"); }
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', ?)", [tz]);
  }
  return NextResponse.json({ ok: true });
});
