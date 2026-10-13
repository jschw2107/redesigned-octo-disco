import { NextResponse } from "next/server";
import { run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError, email, str } from "@/lib/validate";
import { sendEmail } from "@/lib/email";

/** A student proposes a GroupBuy ("Who wants AirPods under $100?"). Reviewed by an admin before it's public. */
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const title = str(b.title, "What do you want to buy", { max: 120 });
  const details = str(b.details, "Details", { required: false, max: 600 });
  const name = str(b.name, "Name", { max: 100 });
  const mail = email(b.email);
  let target: number | null = null;
  if (b.target !== undefined && b.target !== "" && b.target !== null) {
    const n = Math.round(Number(String(b.target).replace(/[$,\s]/g, "")) * 100);
    if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) throw new InputError("Target price should be a number like 99");
    target = n;
  }
  await run("INSERT INTO requests (created_at, title, details, target_cents, name, email) VALUES (?,?,?,?,?,?)",
    [new Date().toISOString(), title, details, target, name, mail]);
  if (process.env.ADMIN_EMAIL) {
    await sendEmail({ to: process.env.ADMIN_EMAIL, subject: `New GroupBuy request: ${title}`,
      html: `<p>${name} (${mail}) requested: <strong>${title}</strong>${target ? ` under $${(target / 100).toFixed(0)}` : ""}</p><p>${details}</p>`,
      text: `${name} (${mail}) requested: ${title}${target ? ` under $${(target / 100).toFixed(0)}` : ""}\n${details}` });
  }
  return NextResponse.json({ ok: true });
});
