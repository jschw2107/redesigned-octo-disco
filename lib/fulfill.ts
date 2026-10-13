import { headers } from "next/headers";
import { all, db, one, run } from "./db";
import { fmtDate, getSettings } from "./data";
import { campaignPath, clearing, code, getCampaign, getFeeBps, type Campaign } from "./campaigns";
import {
  campaignLiveEmail, commitCancelledEmail, commitPaidEmail, dealChargedEmail, dealMissedEmail, dealWonEmail, sendEmail,
} from "./email";
import { chargeSavedCard } from "./cards";
import { DEFAULT_MARKUP_BPS, cancelExtraOrder, extraPrice } from "./extras";
import { feePerUnit, pct } from "./consent";
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
  university_id: number | null; university_name: string; hall_name: string; apartment: string; room: string; max_cents: number; qty: number;
  status: string; ref: string | null; confirmed_at: string | null; amount_cents: number | null; paid_at: string | null;
  stripe_session_id: string | null; payment_intent: string | null; refunded_cents: number;
  stripe_customer_id: string | null; payment_method_id: string | null; card_label: string | null; setup_session_id: string | null; charge_error: string | null;
  fee_bps: number | null; fee_amount_cents: number | null;
};

export const getCommitment = (token: string) => one<Commitment>("SELECT * FROM commitments WHERE token=?", [token]);

/**
 * Lock in a supplier's price. Everyone whose maximum is at or above it (earliest first, up to an optional unit cap)
 * is "won" and pays this one price; everyone else is "not_matched" and is never charged.
 */
export async function lockDeal(opts: {
  campaignId: number; priceCents: number; unitCap?: number | null; payBy: string; note: string; base: string;
  /** The seller's minimum order. If it's more than the winners bought, GroupBuy buys the rest and sells them as extras. */
  minOrder?: number | null; markupBps?: number;
}) {
  const camp = await getCampaign({ id: opts.campaignId });
  if (!camp) throw new Error("Campaign not found");
  const res = await clearing(camp.id, opts.priceCents, opts.unitCap);
  const now = new Date().toISOString();
  // Seller minimum: buy at least that many; anything beyond the winners' units goes on sale as extras.
  const bought = Math.max(res.units, opts.minOrder ?? 0);
  const extraUnits = bought - res.units;
  const extraUnit = extraPrice(opts.priceCents, camp.normal_cents, await getFeeBps(), opts.markupBps ?? DEFAULT_MARKUP_BPS);
  const c = await db();
  // Each winner pays the clearing price plus GroupBuy's share of their savings, at the rate they agreed to when joining.
  const winners = res.eligible.length
    ? await all<{ id: number; qty: number; fee_bps: number | null }>(`SELECT id, qty, fee_bps FROM commitments WHERE id IN (${res.eligible.map(() => "?").join(",")})`, res.eligible)
    : [];
  await c.batch([
    ...winners.map((w) => {
      const fee = feePerUnit(opts.priceCents, camp.normal_cents, w.fee_bps ?? 0);
      return {
        sql: "UPDATE commitments SET status='won', amount_cents=?, fee_amount_cents=?, updated_at=? WHERE id=? AND status='active'",
        args: [w.qty * (opts.priceCents + fee), w.qty * fee, now, w.id],
      };
    }),
    ...res.left.map((id) => ({ sql: "UPDATE commitments SET status='not_matched', updated_at=? WHERE id=? AND status='active'", args: [now, id] })),
    {
      sql: "UPDATE campaigns SET status='deal', final_cents=?, pay_by=?, deal_note=?, bought_units=?, extra_units=?, extra_cents=? WHERE id=?",
      args: [opts.priceCents, opts.payBy, opts.note, bought, extraUnits, extraUnits > 0 ? extraUnit : null, camp.id],
    },
  ], "write");

  const tz = (await getSettings()).timezone;
  const online = paymentsEnabled();
  const won = await all<Commitment>("SELECT * FROM commitments WHERE campaign_id=? AND status='won'", [camp.id]);
  const missed = await all<Commitment>("SELECT * FROM commitments WHERE campaign_id=? AND status='not_matched'", [camp.id]);
  let charged = 0, failed = 0;
  for (const m of won) {
    const unitFee = feePerUnit(opts.priceCents, camp.normal_cents, m.fee_bps ?? 0);
    const amount = m.amount_cents ?? m.qty * (opts.priceCents + unitFee);
    let chargeError: string | undefined;
    // Saved card: charge automatically, as the buyer authorized when joining.
    if (online && m.payment_method_id) {
      const r = await chargeSavedCard(m, camp, amount);
      if (r.ok) {
        await run("UPDATE commitments SET payment_intent=?, charge_error=NULL WHERE id=?", [r.paymentIntent, m.id]);
        if (!r.processing) await markCommitPaid(m.token, r.paymentIntent, opts.base, { auto: true });
        charged++;
        continue;
      }
      chargeError = r.error;
      failed++;
      await run("UPDATE commitments SET charge_error=? WHERE id=?", [r.error, m.id]);
    }
    // No saved card, or the charge failed: email a payment link instead.
    await sendEmail(dealWonEmail({
      email: m.email, name: m.name, code: code(camp.number), title: camp.title, unit: camp.unit, qty: m.qty,
      finalCents: opts.priceCents, feeCents: unitFee, feePct: pct(m.fee_bps ?? 0), amountCents: amount,
      normalCents: camp.normal_cents, payBy: fmtDate(opts.payBy, tz), note: opts.note, payUrl: `${opts.base}/c/${m.token}`, online, chargeError,
    }));
  }
  for (const m of missed) {
    await sendEmail(dealMissedEmail({
      email: m.email, name: m.name, code: code(camp.number), title: camp.title, finalCents: opts.priceCents, maxCents: m.max_cents, url: opts.base,
    }));
  }
  return { ...res, won: won.length, missed: missed.length, charged, failed, bought, extraUnits, extraUnit };
}

/** Marks a deal payment as paid. Idempotent: the webhook and the return page can both call it. */
export async function markCommitPaid(token: string, paymentIntent: string | null, base: string, opts: { auto?: boolean } = {}) {
  const now = new Date().toISOString();
  const r = await run(
    "UPDATE commitments SET status='paid', paid_at=?, payment_intent=COALESCE(?, payment_intent), updated_at=? WHERE token=? AND status='won'",
    [now, paymentIntent, now, token]);
  if (r.rowsAffected !== 1) return false;
  const m = (await getCommitment(token))!;
  const camp = (await getCampaign({ id: m.campaign_id }))!;
  const auto = opts.auto || (!!m.payment_method_id && m.stripe_session_id == null);
  if (auto) {
    await sendEmail(dealChargedEmail({
      email: m.email, name: m.name, code: code(camp.number), title: camp.title, unit: camp.unit, qty: m.qty,
      finalCents: camp.final_cents ?? 0, feeCents: feePerUnit(camp.final_cents ?? 0, camp.normal_cents, m.fee_bps ?? 0), feePct: pct(m.fee_bps ?? 0),
      amountCents: m.amount_cents ?? 0, normalCents: camp.normal_cents,
      card: m.card_label ?? "your saved card", note: camp.deal_note, url: `${base}/c/${m.token}`,
    }));
  } else {
    await sendEmail(commitPaidEmail({
      email: m.email, name: m.name, code: code(camp.number), title: camp.title, unit: camp.unit, qty: m.qty,
      amountCents: m.amount_cents ?? 0, note: camp.deal_note, url: `${base}/c/${m.token}`,
    }));
  }
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
/**
 * Admin cancels a buyer's order. Paid orders are refunded in full. The buyer always gets an email
 * (unless they had already withdrawn, weren't matched, or never finished joining).
 */
export async function cancelCommitment(id: number, opts: { reason?: "admin" | "campaign"; base?: string } = {}) {
  const m = await one<Commitment>("SELECT * FROM commitments WHERE id=?", [id]);
  if (!m || m.status === "cancelled") return { refunded: 0 };
  const refunded = m.status === "paid" ? await refund(m.payment_intent, m.refunded_cents, m.amount_cents ?? 0) : 0;
  await run("UPDATE commitments SET status='cancelled', refunded_cents=refunded_cents+?, updated_at=? WHERE id=?", [refunded, new Date().toISOString(), id]);
  const camp = await getCampaign({ id: m.campaign_id });
  if (camp && ["active", "pending_card", "pending", "won", "paid"].includes(m.status)) {
    await sendEmail(commitCancelledEmail({
      email: m.email, name: m.name, code: code(camp.number), title: camp.title, refundedCents: refunded,
      wasCharged: m.status === "paid", reason: opts.reason ?? "admin", url: opts.base,
    }));
  }
  return { refunded };
}

/** Admin cancels a whole GroupBuy: every open order is cancelled (paid ones refunded) and everyone is emailed. */
export async function cancelCampaignOrders(campaignId: number, base: string) {
  const ms = await all<{ id: number }>(
    "SELECT id FROM commitments WHERE campaign_id=? AND status IN ('active','pending_card','pending','won','paid')", [campaignId]);
  let refunded = 0;
  for (const m of ms) refunded += (await cancelCommitment(m.id, { reason: "campaign", base })).refunded;
  const xs = await all<{ id: number }>("SELECT id FROM extra_orders WHERE campaign_id=? AND status IN ('paid','reserved')", [campaignId]);
  for (const x of xs) refunded += (await cancelExtraOrder(x.id)).refunded;
  await run("UPDATE campaigns SET extra_units=0 WHERE id=?", [campaignId]);
  return { cancelled: ms.length + xs.length, refunded };
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
