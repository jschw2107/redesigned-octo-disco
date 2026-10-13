import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { handle, body } from "@/lib/http";
import { InputError, str } from "@/lib/validate";
import { AUDIENCES, sendUpdate, type Audience } from "@/lib/updates";
import { emailEnabled } from "@/lib/email";
import { siteUrl } from "@/lib/fulfill";

/** Email an order update to a GroupBuy's buyers. */
export const POST = handle(async (req: Request) => {
  const denied = await requireAdmin(); if (denied) return denied;
  const b = await body(req);
  const audience = String(b.audience) as Audience;
  if (!(audience in AUDIENCES)) throw new InputError("Choose who to send it to");
  const subject = str(b.subject, "Subject", { max: 120 });
  const text = str(b.body, "Message", { max: 4000 });
  const r = await sendUpdate(Number(b.campaign_id), audience, subject, text, await siteUrl(req));
  return NextResponse.json({ ok: true, ...r, live: emailEnabled() });
});
