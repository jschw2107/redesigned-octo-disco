import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { email, location, str } from "@/lib/validate";
import { code, campaignPath, getCampaign, getFeeBps } from "@/lib/campaigns";
import { checkDomain, newToken, openCampaign, validChoice } from "@/lib/commit";
import { commitConfirmEmail, commitJoinedEmail, emailEnabled, sendEmail } from "@/lib/email";
import { fmtDate, getSettings } from "@/lib/data";
import { getCommitment, siteUrl, type Commitment } from "@/lib/fulfill";
import { paymentsEnabled } from "@/lib/stripe";
import { startCardSetup } from "@/lib/cards";

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
  // With payments on, joining saves a card (charged automatically only if a deal lands at or below the max).
  // A saved card proves the buyer is real, so the separate email confirmation is only used when payments are off.
  const cards = paymentsEnabled();
  const verify = !cards && emailEnabled();
  const now = new Date().toISOString();
  const base = await siteUrl(req);
  const feeBps = await getFeeBps(); // the rate this buyer agrees to; later changes never apply to them
  const tz = (await getSettings()).timezone;

  const existing = await one<Commitment>("SELECT * FROM commitments WHERE campaign_id=? AND email=?", [camp.id, mail]);
  if (existing && ["won", "paid", "not_matched", "cancelled"].includes(existing.status)) {
    return NextResponse.json({ error: "You've already taken part in this GroupBuy." }, { status: 409 });
  }

  // Someone typing an email that is already in: with email on, we never let them change another person's spot;
  // we email the owner their private link instead.
  if (existing && (verify || cards) && existing.status === "active") {
    await sendEmail(commitJoinedEmail({
      email: mail, name: existing.name, code: code(camp.number), title: camp.title, unit: camp.unit, qty: existing.qty,
      maxCents: existing.max_cents, targetCents: camp.target_cents, normalCents: camp.normal_cents, deadline: fmtDate(camp.deadline, tz),
      manageUrl: `${base}/c/${existing.token}`, shareUrl: `${base}${campaignPath(camp.number)}?ref=${existing.token}`, updated: false,
    }));
    return NextResponse.json({ status: "already", message: emailEnabled()
      ? "You're already in. We emailed you a link to view or change your commitment."
      : "You're already in this GroupBuy. Use the link from when you joined to view or change it." });
  }

  const status = cards ? "pending_card" : verify ? "pending" : "active";
  let token: string;
  if (existing) {
    token = existing.token;
    await run(
      `UPDATE commitments SET name=?, university_id=?, university_name=?, hall_name=?, apartment=?, room=?, max_cents=?, qty=?,
         status=?, updated_at=?, payment_method_id=NULL, card_label=NULL, fee_bps=? WHERE id=?`,
      [name, loc.uni.id, loc.uni.name, loc.hallName, loc.apartment, loc.room, max, qty, status, now, feeBps, existing.id]);
  } else {
    token = newToken();
    await run(
      `INSERT INTO commitments (token, campaign_id, created_at, updated_at, name, email, university_id, university_name, hall_name,
         apartment, room, max_cents, qty, status, ref, confirmed_at, fee_bps) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [token, camp.id, now, now, name, mail, loc.uni.id, loc.uni.name, loc.hallName, loc.apartment, loc.room, max, qty, status,
        ref && ref !== token ? ref : null, verify ? null : now, feeBps]);
  }

  if (cards) {
    const m = (await getCommitment(token))!;
    const url = await startCardSetup(m, camp, base);
    return NextResponse.json({ status: "pending_card", url });
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
