import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { all } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError, email as validEmail } from "@/lib/validate";
import { campaignLiveEmail, emailEnabled, sendEmail } from "@/lib/email";
import { campaignPath, code, getCampaign } from "@/lib/campaigns";
import { siteUrl } from "@/lib/fulfill";

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

  // Announce a live GroupBuy to everyone on the alerts list.
  if (b.action === "announce") {
    const camp = await getCampaign({ id: Number(b.campaign_id) });
    if (!camp || camp.status !== "live") throw new InputError("Only live GroupBuys can be announced.");
    const list = await all<{ email: string }>("SELECT DISTINCT lower(email) AS email FROM waitlist");
    let sent = 0;
    for (const { email } of list) {
      if (await sendEmail(campaignLiveEmail({ email, code: code(camp.number), title: camp.title, url: `${base}${campaignPath(camp.number)}`, requested: false }))) sent++;
    }
    return NextResponse.json({ ok: true, sent, total: list.length, live: emailEnabled() });
  }
  throw new InputError("Unknown action");
});
