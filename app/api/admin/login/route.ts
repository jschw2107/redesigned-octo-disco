import { NextResponse } from "next/server";
import { adminConfigured, checkPassword, setAdminCookie } from "@/lib/auth";
import { all, run } from "@/lib/db";
import { handle, body } from "@/lib/http";

const MAX_FAILURES = 5;
const WINDOW_MIN = 15;

const clientIp = (req: Request) =>
  (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();

export const POST = handle(async (req: Request) => {
  if (!adminConfigured()) return NextResponse.json({ error: "Set ADMIN_PASSWORD in your environment first." }, { status: 503 });
  const ip = clientIp(req);
  const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();
  // Lock out after too many wrong passwords from the same address.
  const recent = await all<{ at: string }>("SELECT at FROM login_failures WHERE ip=? AND at > ? ORDER BY at", [ip, since]);
  if (recent.length >= MAX_FAILURES) {
    const mins = Math.max(1, Math.ceil((Date.parse(recent[0].at) + WINDOW_MIN * 60000 - Date.now()) / 60000));
    return NextResponse.json({ error: `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` }, { status: 429 });
  }
  const b = await body(req);
  if (typeof b.password !== "string" || !checkPassword(b.password)) {
    await run("INSERT INTO login_failures (ip, at) VALUES (?, ?)", [ip, new Date().toISOString()]);
    await run("DELETE FROM login_failures WHERE at < ?", [new Date(Date.now() - 864e5).toISOString()]);
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    const left = MAX_FAILURES - recent.length - 1;
    return NextResponse.json({ error: left > 0 ? `Wrong password (${left} ${left === 1 ? "try" : "tries"} left)` : `Wrong password. Locked for ${WINDOW_MIN} minutes.` }, { status: 401 });
  }
  await run("DELETE FROM login_failures WHERE ip=?", [ip]);
  await setAdminCookie();
  return NextResponse.json({ ok: true });
});
