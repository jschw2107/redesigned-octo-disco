import { NextResponse } from "next/server";
import { databaseIsTemporary, one } from "@/lib/db";
import { emailEnabled } from "@/lib/email";

export const dynamic = "force-dynamic";

/** Public status check: shows which services are configured, never the keys themselves. */
export async function GET() {
  let database: "connected" | "temporary" | "error" = databaseIsTemporary() ? "temporary" : "connected";
  try { await one("SELECT 1 AS ok"); } catch { database = "error"; }
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return NextResponse.json({
    database,
    payments: key ? (key.startsWith("sk_live") ? "live" : key.startsWith("sk_test") || key.startsWith("rk_test") ? "test" : "unrecognized key") : "off",
    stripe_webhook_secret: process.env.STRIPE_WEBHOOK_SECRET ? (process.env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_") ? "set" : "set, but doesn't start with whsec_") : "missing",
    email: emailEnabled() ? "on" : "off",
    email_from: process.env.EMAIL_FROM ? "set" : "not set",
    site_url: process.env.SITE_URL || "not set",
    version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
  });
}
