import { headers } from "next/headers";
import { all, db, one, run } from "./db";
import { fmtDate, getSettings } from "./data";
import { campaignPath, clearing, code, getCampaign, type Campaign } from "./campaigns";
import {
  campaignLiveEmail, commitCancelledEmail, commitPaidEmail, dealMissedEmail, dealWonEmail, sendEmail,
} from "./email";
import { paymentsEnabled, stripe } from "./stripe";

/** Public base URL for links in emails and Stripe redirects. Set SITE_URL in production. */
export async function siteUrl(req?: Request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (req) return new URL(req.url).origin;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type Commitment = {
  id: number; token: string; campaign_id: number; created_at: string; updated_at: string; name: string; email: string;
  university_id: number | null; university_name: string; hall_name: string; apartment: string; max_cents: number; qty: number;
  status: string; ref: string | null; confirmed_at: string | null; amount_cents: number | null; paid_at: string | null;
  stripe_session_id: string | null; payment_intent: string | null; refunded_cents: number;
};

export const getCommitment = (token: string) => one<Commitment>("SELECT * FROM commitments WHERE token=?", [token]);

/**
 * Lock in a supplier's price. Everyone whose maximum is at or above it (earliest first, up to an optional unit cap)
 * is "won" and pays this one price; everyone else is "not_matched" and is never charged.
 */
export async function lockDeal(opts: { campaignId: number; priceCents: number; unitCap?: number | null; payBy: string; note: string; base: string }) {
  const camp = await getCampaign({ id: opts.campaignId });
  if (!camp) throw new Error("Campaign not found");
  const res = await clearing(camp.id, opts.priceCents, opts.unitCap);
  const now = new Date().toISOString();
  const c = await db();
  await c.batch([
    ...res.eligible.map((id) => ({
      sql: "UPDATE commitments SET status='won', amount_cents=qty*?, updated_at=? WHERE id=? AND status='active'",
      args: [opts.priceCents + camp.fee_cents, now, id],
    })),
    ...res.left.map((id) => ({ sql: "UPDATE commitments SET status='not_matched', updated_at=? WHERE id=? AND status='active'", args: [now, id] })),
    {
      sql: "UPDATE campaigns SET status='deal', final_cents=?, pay_by=?, deal_note=? WHERE id=?",
      args: [opts.priceCents, opts.payBy, opts.note, camp.id],
    },
  ], "write");

  const tz = (await getSettings()).timezone;
  const online = paymentsEnabled();
  const won = await all<Commitment>("SELECT * FROM commitments WHERE campaign_id=? AND status='won'", [camp.id]);
  const missed = await all<Commitment>("SELECT * FROM commitments WHERE campaign_id=? AND status='not_matched'", [camp.id]);
  for (const m of won) {
    await sendEmail(dealWonEmail({
      email: m.email, name: m.name, code: code(camp.number), title: camp.title, unit: camp.unit, qty: m.qty,
      finalCents: opts.priceCents, feeCents: camp.fee_cents, amountCents: m.amount_cents ?? m.qty * (opts.priceCents + camp.fee_cents),
      normalCents: camp.normal_cents, payBy: fmtDate(opts.payBy, tz), note: opts.note, payUrl: `${opts.base}/c/${m.token}`, online,
    }));
  }
  for (const m of missed) {
    await sendEmail(dealMissedEmail({
      email: m.email, name: m.name, code: code(camp.number), title: camp.title, finalCents: opts.priceCents, maxCents: m.max_cents, url: opts.base,
    }));
  }
  return { ...res, won: won.length, missed: missed.length };
}

/** Marks a deal payment as paid. Idempotent: the webhook and the return page can both call it. */
export async function markCommitPaid(token: string, paymentIntent: string | null, base: string) {
  const now = new Date().toISOString();
  const r = await run(
    "UPDATE commitments SET status='paid', paid_at=?, payment_intent=COALESCE(?, payment_intent), updated_at=? WHERE token=? AND status='won'",
    [now, paymentIntent, now, token]);
  if (r.rowsAffected !== 1) return false;
  const m = (await getCommitment(token))!;
  const camp = (await getCampaign({ id: m.campaign_id }))!;
  await sendEmail(commitPaidEmail({
    email: m.email, name: m.name, code: code(camp.number), title: camp.title, unit: camp.unit, qty: m.qty,
    amountCents: m.amount_cents ?? 0, note: camp.deal_note, url: `${base}/c/${m.token}`,
  }));
  if (process.env.ADMIN_EMAIL) {
    const amt = `$${((m.amount_cents ?? 0) / 100).toFixed(2)}`;
    await sendEmail({
      to: process.env.ADMIN_EMAIL, subject: `Paid: GroupBuy #${code(camp.number)} · ${m.name} · ${amt}`,
      html: `<p>${m.name} (${m.email}) paid ${amt} for ${m.qty} × ${camp.title}.</p>`, text: `${m.name} (${m.email}) paid ${amt} for ${m.qty} × ${camp.title}.`,
    });
  }
  return true;
}

/** Full refund of a card payment. Returns cents refunded (0 if nothing to refund). */
async function refund(paymentIntent: string | null, alreadyRefunded: number, amount: number) {
  const s = stripe();
  if (!s || !paymentIntent || alreadyRefunded > 0) return 0;
  const r = await s.refunds.create({ payment_intent: paymentIntent });
  return r.amount ?? amount;
}

/** Admin cancels a buyer's spot. Paid spots are refunded in full and the buyer is emailed. */
export async function cancelCommitment(id: number) {
  const m = await one<Commitment>("SELECT * FROM commitments WHERE id=?", [id]);
  if (!m || m.status === "cancelled") return { refunded: 0 };
  const refunded = m.status === "paid" ? await refund(m.payment_intent, m.refunded_cents, m.amount_cents ?? 0) : 0;
  await run("UPDATE commitments SET status='cancelled', refunded_cents=refunded_cents+?, updated_at=? WHERE id=?", [refunded, new Date().toISOString(), id]);
  const camp = await getCampaign({ id: m.campaign_id });
  if (camp && (m.status === "won" || m.status === "paid")) {
    await sendEmail(commitCancelledEmail({ email: m.email, name: m.name, code: code(camp.number), title: camp.title, refundedCents: refunded }));
  }
  return { refunded };
}

/** When a campaign created from a student request goes live, tell everyone who said they'd join. */
export async function notifyRequestVoters(camp: Campaign, base: string) {
  if (!camp.request_id || camp.live_notified || camp.status !== "live") return 0;
  const voters = await all<{ email: string }>(
    `SELECT email FROM request_votes WHERE request_id=? UNION SELECT email FROM requests WHERE id=?`, [camp.request_id, camp.request_id]);
  for (const v of voters) {
    await sendEmail(campaignLiveEmail({ email: v.email, code: code(camp.number), title: camp.title, url: `${base}${campaignPath(camp.number)}` }));
  }
  await run("UPDATE campaigns SET live_notified=1 WHERE id=?", [camp.id]);
  return voters.length;
}
