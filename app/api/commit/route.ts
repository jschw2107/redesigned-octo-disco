import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { email, location, str } from "@/lib/validate";
import { code, campaignPath, getCampaign } from "@/lib/campaigns";
import { checkDomain, newToken, openCampaign, validChoice } from "@/lib/commit";
import { commitConfirmEmail, commitJoinedEmail, emailEnabled, sendEmail } from "@/lib/email";
import { fmtDate, getSettings } from "@/lib/data";
import { siteUrl, type Commitment } from "@/lib/fulfill";

/** Join a GroupBuy at a maximum price. Nothing is charged. */
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const camp = await openCampaign(b.campaign);
  const { max, qty } = validChoice(camp, b.max_cents, b.qty);
  const name = str(b.name, "Name", { max: 100 });
  const mail = email(b.email);
  await checkDomain(mail);
  const loc = await location(b);
  const ref = typeof b.ref === "string" ? b.ref.slice(0, 40) : null;
  const verify = emailEnabled();
  const now = new Date().toISOString();
  const base = await siteUrl(req);
  const tz = (await getSettings()).timezone;

  const existing = await one<Commitment>("SELECT * FROM commitments WHERE campaign_id=? AND email=?", [camp.id, mail]);
  if (existing && ["won", "paid", "not_matched", "cancelled"].includes(existing.status)) {
    return NextResponse.json({ error: "You've already taken part in this GroupBuy." }, { status: 409 });
  }

  // Someone typing an email that is already in: with email on, we never let them change another person's spot;
  // we email the owner their private link instead.
  if (existing && verify && existing.status === "active") {
    await sendEmail(commitJoinedEmail({
      email: mail, name: existing.name, code: code(camp.number), title: camp.title, unit: camp.unit, qty: existing.qty,
      maxCents: existing.max_cents, targetCents: camp.target_cents, normalCents: camp.normal_cents, deadline: fmtDate(camp.deadline, tz),
      manageUrl: `${base}/c/${existing.token}`, shareUrl: `${base}${campaignPath(camp.number)}?ref=${existing.token}`, updated: false,
    }));
    return NextResponse.json({ status: "already", message: "You're already in. We emailed you a link to view or change your commitment." });
  }

  const status = verify ? "pending" : "active";
  let token: string;
  if (existing) {
    token = existing.token;
    await run(
      `UPDATE commitments SET name=?, university_id=?, university_name=?, hall_name=?, apartment=?, max_cents=?, qty=?,
         status=?, updated_at=? WHERE id=?`,
      [name, loc.uni.id, loc.uni.name, loc.hallName, loc.apartment, max, qty, status, now, existing.id]);
  } else {
    token = newToken();
    await run(
      `INSERT INTO commitments (token, campaign_id, created_at, updated_at, name, email, university_id, university_name, hall_name,
         apartment, max_cents, qty, status, ref, confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [token, camp.id, now, now, name, mail, loc.uni.id, loc.uni.name, loc.hallName, loc.apartment, max, qty, status,
        ref && ref !== token ? ref : null, verify ? null : now]);
  }

  const info = {
    email: mail, name, code: code(camp.number), title: camp.title, unit: camp.unit, qty, maxCents: max,
    targetCents: camp.target_cents, normalCents: camp.normal_cents, deadline: fmtDate(camp.deadline, tz),
    manageUrl: `${base}/c/${token}`, shareUrl: `${base}${campaignPath(camp.number)}?ref=${token}`,
  };
  if (verify) await sendEmail(commitConfirmEmail({ ...info, confirmUrl: `${base}/c/${token}?confirm=1` }));
  else await sendEmail(commitJoinedEmail({ ...info, updated: !!existing }));

  const fresh = await getCampaign({ id: camp.id });
  return NextResponse.json({
    status, token: verify ? null : token, // with email on, the private link only goes to the inbox
    shareUrl: `${base}${campaignPath(camp.number)}${verify ? "" : `?ref=${token}`}`,
    units: fresh?.units ?? 0, buyers: fresh?.buyers ?? 0,
  });
});
