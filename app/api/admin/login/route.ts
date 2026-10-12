import { NextResponse } from "next/server";
import { adminConfigured, checkPassword, setAdminCookie } from "@/lib/auth";
import { handle, body } from "@/lib/http";

export const POST = handle(async (req: Request) => {
  if (!adminConfigured()) return NextResponse.json({ error: "Set ADMIN_PASSWORD in your environment first." }, { status: 503 });
  const b = await body(req);
  if (typeof b.password !== "string" || !checkPassword(b.password)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  await setAdminCookie();
  return NextResponse.json({ ok: true });
});
