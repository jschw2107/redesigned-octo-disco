import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { all } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError, email as validEmail, str } from "@/lib/validate";
import { emailEnabled, pickupReminderEmail, sendEmail } from "@/lib/email";
import { orderEmailData, siteUrl } from "@/lib/fulfill";

export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const base = await siteUrl(req);

  if (b.action === "test") {
    const to = validEmail(b.to);
    const ok = await sendEmail({ to, subject: "GroupBuy test email", html: "<p>Email is working. 🎉</p>", text: "Email is working." });
    if (!ok) throw new InputError("Sending failed. Check RESEND_API_KEY and EMAIL_FROM (the sending domain must be verified in Resend).");
    return NextResponse.json({ ok: true, sent: 1, live: emailEnabled() });
  }

  if (b.action === "pickup_reminder") {
    const cycle = Number(b.cycle);
    const note = str(b.note, "Message", { required: false, max: 2000 });
    const ids = await all<{ id: string }>("SELECT id FROM orders WHERE cycle_id=? AND status='placed'", [cycle]);
    let sent = 0;
    for (const { id } of ids) {
      const d = await orderEmailData(id, base);
      if (d && (await sendEmail(pickupReminderEmail({ ...d, note })))) sent++;
    }
    return NextResponse.json({ ok: true, sent, total: ids.length, live: emailEnabled() });
  }
  throw new InputError("Unknown action");
});
