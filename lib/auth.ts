import { cookies } from "next/headers";
import crypto from "node:crypto";
import { NextResponse } from "next/server";

const COOKIE = "gb_admin";

function token(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  const secret = process.env.SESSION_SECRET || pw;
  return crypto.createHmac("sha256", secret).update(`groupbuy-admin:${pw}`).digest("hex");
}

export function adminConfigured() {
  return !!process.env.ADMIN_PASSWORD;
}

export function checkPassword(input: string) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(pw).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function isAdmin() {
  const t = token();
  if (!t) return false;
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v || v.length !== t.length) return false;
  return crypto.timingSafeEqual(Buffer.from(v), Buffer.from(t));
}

export async function setAdminCookie() {
  (await cookies()).set(COOKIE, token()!, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearAdminCookie() {
  (await cookies()).delete(COOKIE);
}

/** Use at the top of every admin API route. Returns a 401 response when not signed in. */
export async function requireAdmin(): Promise<NextResponse | null> {
  if (await isAdmin()) return null;
  return NextResponse.json({ error: "Not signed in" }, { status: 401 });
}
