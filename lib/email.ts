// Email via Resend (https://resend.com). Without RESEND_API_KEY, emails are printed to the server log instead,
// so the site works locally with no setup. Sending never throws: a failed email must not break a checkout.

const BRAND = "#6c47ff";

export function emailEnabled() {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(msg: { to: string | string[]; subject: string; html: string; text: string }) {
  const to = Array.isArray(msg.to) ? msg.to : [msg.to];
  const from = process.env.EMAIL_FROM || "GroupBuy <onboarding@resend.dev>";
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email:dev] to=${to.join(",")} subject="${msg.subject}"\n${msg.text}\n`);
    return true;
  }
  try {
    const res = await fetch(`${process.env.RESEND_API_URL || "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from, to, subject: msg.subject, html: msg.html, text: msg.text,
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend error ${res.status}: ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] send failed", e);
    return false;
  }
}

/* ---------- templates ---------- */

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

function layout(title: string, body: string, cta?: { href: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#faf8f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16131f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e7e2ec;border-radius:16px">
<tr><td style="padding:24px 28px 0"><span style="display:inline-block;background:${BRAND};color:#fff;border-radius:7px;width:24px;height:24px;text-align:center;line-height:24px;font-weight:800;font-size:13px">G</span>
<strong style="font-size:18px;vertical-align:middle;margin-left:6px">GroupBuy</strong></td></tr>
<tr><td style="padding:20px 28px 28px">
<h1 style="font-size:22px;line-height:1.25;margin:0 0 14px">${esc(title)}</h1>
${body}
${cta ? `<p style="margin:24px 0 0"><a href="${esc(cta.href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">${esc(cta.label)}</a></p>` : ""}
</td></tr></table>
<p style="color:#6b6578;font-size:12px;margin:16px 0 0">Built for your budget. Better with your neighbors.</p>
</td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px;color:#3a3546">${html}</p>`;

function itemsTable(items: { name: string; qty: number; unit_cents: number }[], total: number, totalLabel: string) {
  const rows = items
    .map((i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(i.qty)} × ${esc(i.name)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #eee">${money(i.qty * i.unit_cents)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;margin:8px 0 16px">${rows}
<tr><td style="padding:10px 0"><strong>${esc(totalLabel)}</strong></td><td align="right" style="padding:10px 0"><strong>${money(total)}</strong></td></tr></table>`;
}

function details(rows: [string, string][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;background:#f6f3fb;border-radius:12px;margin:4px 0 8px">${rows
    .map(([k, v]) => `<tr><td style="padding:8px 14px;color:#6b6578;width:40%">${esc(k)}</td><td style="padding:8px 14px"><strong>${esc(v)}</strong></td></tr>`)
    .join("")}</table>`;
}

const textItems = (items: { name: string; qty: number; unit_cents: number }[]) => items.map((i) => `  ${i.qty} × ${i.name}  ${money(i.qty * i.unit_cents)}`).join("\n");

export type OrderEmailData = {
  id: string; name: string; email: string; university: string; residence: string; total_cents: number; paid: boolean;
  items: { name: string; qty: number; unit_cents: number }[];
  closes: string; pickup: string; pickupLocation: string; url: string;
};

export function orderConfirmationEmail(o: OrderEmailData) {
  const first = o.name.split(" ")[0];
  const totalLabel = o.paid ? "Paid" : "Due at pickup";
  return {
    to: o.email,
    subject: `You're in! GroupBuy order ${o.id}`,
    html: layout(`You're in, ${first}!`,
      p(`Your essentials joined ${esc(o.university)}'s bulk buy. Here's your receipt. Bring your order number to pickup.`) +
      itemsTable(o.items, o.total_cents, totalLabel) +
      details([["Order", o.id], ["Order placed with supplier", o.closes], ["Pickup starts", o.pickup], ["Pickup point", o.pickupLocation], ["Residence", o.residence]]),
      { href: o.url, label: "View your order" }),
    text: `You're in, ${first}!\n\nOrder ${o.id}\n${textItems(o.items)}\n  ${totalLabel}: ${money(o.total_cents)}\n\nOrder placed with supplier: ${o.closes}\nPickup starts: ${o.pickup}\nPickup point: ${o.pickupLocation}\nResidence: ${o.residence}\n\n${o.url}`,
  };
}

export function adminNewOrderEmail(o: OrderEmailData, to: string) {
  return {
    to,
    subject: `New order ${o.id}: ${money(o.total_cents)} from ${o.residence}`,
    html: layout(`New order: ${money(o.total_cents)}`, p(`${esc(o.name)} (${esc(o.email)}) · ${esc(o.university)} · ${esc(o.residence)}`) + itemsTable(o.items, o.total_cents, o.paid ? "Paid online" : "Due at pickup")),
    text: `New order ${o.id}\n${o.name} <${o.email}> · ${o.university} · ${o.residence}\n${textItems(o.items)}\nTotal: ${money(o.total_cents)} (${o.paid ? "paid online" : "due at pickup"})`,
  };
}

export function orderCancelledEmail(o: { id: string; name: string; email: string; refunded_cents: number; kind?: "order" | "reservation" }) {
  const kind = o.kind ?? "order";
  const refund = o.refunded_cents > 0 ? `We've refunded ${money(o.refunded_cents)} to your card. It usually shows up within 5–10 business days.` : "";
  return {
    to: o.email,
    subject: `GroupBuy ${kind} ${o.id} was cancelled`,
    html: layout(`Your ${kind} was cancelled`, p(`Hi ${esc(o.name.split(" ")[0])}, ${kind} <strong>${esc(o.id)}</strong> has been cancelled. ${esc(refund)}`) + p("Questions? Just reply to this email.")),
    text: `Hi ${o.name.split(" ")[0]}, ${kind} ${o.id} has been cancelled. ${refund}\nQuestions? Just reply to this email.`,
  };
}

export function pickupReminderEmail(o: { id: string; name: string; email: string; items: { name: string; qty: number; unit_cents: number }[]; total_cents: number; paid: boolean; pickup: string; pickupLocation: string; url: string; note: string }) {
  return {
    to: o.email,
    subject: `Pickup details for GroupBuy order ${o.id}`,
    html: layout("Your order is almost here",
      p(`Hi ${esc(o.name.split(" ")[0])}, here are the pickup details for your order.`) +
      (o.note ? p(esc(o.note).replace(/\n/g, "<br>")) : "") +
      details([["Pickup starts", o.pickup], ["Pickup point", o.pickupLocation], ["Order", o.id]]) +
      itemsTable(o.items, o.total_cents, o.paid ? "Paid" : "Due at pickup"),
      { href: o.url, label: "View your order" }),
    text: `Hi ${o.name.split(" ")[0]}, here are the pickup details for order ${o.id}.\n${o.note ? o.note + "\n" : ""}\nPickup starts: ${o.pickup}\nPickup point: ${o.pickupLocation}\n\n${textItems(o.items)}\n${o.paid ? "Paid" : "Due at pickup"}: ${money(o.total_cents)}\n\n${o.url}`,
  };
}

export function reservationEmail(r: { code: string; name: string; email: string; item: string; qty: number; unit_cents: number; paid: boolean; pickupLocation: string; url: string }) {
  const total = r.qty * r.unit_cents;
  return {
    to: r.email,
    subject: `Reserved: ${r.qty} × ${r.item} (${r.code})`,
    html: layout("It's set aside for you",
      p(`Hi ${esc(r.name.split(" ")[0])}, we're holding your item at the pickup point.`) +
      itemsTable([{ name: r.item, qty: r.qty, unit_cents: r.unit_cents }], total, r.paid ? "Paid" : "Due at pickup") +
      details([["Reservation", r.code], ["Pickup point", r.pickupLocation]]),
      { href: r.url, label: "View reservation" }),
    text: `Hi ${r.name.split(" ")[0]}, we're holding ${r.qty} × ${r.item} for you (${r.code}).\n${r.paid ? "Paid" : "Due at pickup"}: ${money(total)}\nPickup point: ${r.pickupLocation}\n${r.url}`,
  };
}

export function waitlistEmail(w: { email: string; university: string; url: string }) {
  return {
    to: w.email,
    subject: "You're on the GroupBuy alerts list",
    html: layout("You're on the list 🎉",
      p(`You're on the GroupBuy alerts list for <strong>${esc(w.university)}</strong>. We'll email you whenever a new GroupBuy opens.`) +
      p("The more students join each GroupBuy, the better the deal we can get."),
      { href: w.url, label: "See live GroupBuys" }),
    text: `You're on the GroupBuy alerts list for ${w.university}. We'll email you whenever a new GroupBuy opens.\n${w.url}`,
  };
}

/* ---------- reverse-marketplace (GroupBuy campaign) emails ---------- */

type CommitInfo = {
  email: string; name: string; code: string; title: string; unit: string; qty: number; maxCents: number;
  targetCents: number; normalCents: number; deadline: string; manageUrl: string; shareUrl: string;
};
const unitText = (qty: number, unit: string) => `${qty} ${qty === 1 ? unit : unit.endsWith("s") ? unit : unit + "s"}`;
const PROMISE = "Your maximum price only decides whether you're in the deal. Everyone in the group pays the same final price, and you're never charged more than your maximum.";

export function commitConfirmEmail(c: CommitInfo & { confirmUrl: string }) {
  return {
    to: c.email,
    subject: `Confirm your spot in GroupBuy #${c.code}: ${c.title}`,
    html: layout(`Confirm your spot, ${c.name.split(" ")[0]}`,
      p(`One click and you're counted in <strong>GroupBuy #${esc(c.code)}: ${esc(c.title)}</strong>. Confirming verifies you're a real buyer, which is what gets sellers to compete.`) +
      details([["You'll buy", unitText(c.qty, c.unit)], ["If the price is", `${money(c.maxCents)} or less`], ["Normal price", money(c.normalCents)], ["Joining closes", c.deadline]]) +
      p(esc(PROMISE)),
      { href: c.confirmUrl, label: "Confirm my spot" }),
    text: `Confirm your spot in GroupBuy #${c.code}: ${c.title}\n${c.confirmUrl}\n\nYou'll buy ${unitText(c.qty, c.unit)} if the price is ${money(c.maxCents)} or less. Joining closes ${c.deadline}.\n${PROMISE}`,
  };
}

export function commitJoinedEmail(c: CommitInfo & { updated: boolean; card?: string | null }) {
  return {
    to: c.email,
    subject: `${c.updated ? "Updated" : "You're in"}: GroupBuy #${c.code} ${c.title}`,
    html: layout(c.updated ? "Your commitment was updated" : "You're in the group",
      p(`You're counted in <strong>GroupBuy #${esc(c.code)}: ${esc(c.title)}</strong>. Nothing is charged now${c.card ? `. If a deal lands at or below your maximum, we'll charge ${esc(c.card)} automatically, once, at the group's final price` : ""}.`) +
      details([["You'll buy", unitText(c.qty, c.unit)], ["If the price is", `${money(c.maxCents)} or less`], ["Joining closes", c.deadline]]) +
      p(esc(PROMISE)) +
      p(`Want a lower price? Share your link. More buyers unlock better deals: <a href="${esc(c.shareUrl)}">${esc(c.shareUrl)}</a>`),
      { href: c.manageUrl, label: "View or change my commitment" }),
    text: `You're in GroupBuy #${c.code}: ${c.title}. You'll buy ${unitText(c.qty, c.unit)} if the price is ${money(c.maxCents)} or less. Nothing is charged now.\n${PROMISE}\nShare: ${c.shareUrl}\nManage: ${c.manageUrl}`,
  };
}

export function dealWonEmail(d: { email: string; name: string; code: string; title: string; unit: string; qty: number; finalCents: number;
  feeCents: number; amountCents: number; normalCents: number; payBy: string; note: string; payUrl: string; online: boolean; chargeError?: string }) {
  const saved = (d.normalCents - d.finalCents) * d.qty;
  return {
    to: d.email,
    subject: `Deal secured: ${d.title} at ${money(d.finalCents)} (GroupBuy #${d.code})`,
    html: layout(`We got the deal: ${money(d.finalCents)}`,
      p(`Hi ${esc(d.name.split(" ")[0])}, sellers competed and GroupBuy #${esc(d.code)} landed at <strong>${money(d.finalCents)}</strong> per ${esc(d.unit)}, at or below your maximum. Everyone in the group pays this same price.`) +
      (d.chargeError ? p(`<strong>We couldn't charge your saved card</strong> (${esc(d.chargeError)}). Please pay with the button below to keep your spot.`) : "") +
      details([
        ["Your order", unitText(d.qty, d.unit)], ["Price", `${money(d.finalCents)} each`],
        ...(d.feeCents ? [["GroupBuy fee", `${money(d.feeCents)} each`] as [string, string]] : []),
        ["Total", money(d.amountCents)], ["You save vs normal price", money(Math.max(0, saved))],
        [d.online ? "Pay by" : "Next step", d.online ? d.payBy : "We'll email payment & pickup details"],
      ]) +
      (d.note ? p(esc(d.note).replace(/\n/g, "<br>")) : ""),
      { href: d.payUrl, label: d.online ? `Pay ${money(d.amountCents)}` : "View my deal" }),
    text: `Deal secured: GroupBuy #${d.code} ${d.title} at ${money(d.finalCents)} each.\nYour total: ${money(d.amountCents)} for ${unitText(d.qty, d.unit)}.\n${d.online ? `Pay by ${d.payBy}: ${d.payUrl}` : `Details: ${d.payUrl}`}\n${d.note}`,
  };
}

export function dealMissedEmail(d: { email: string; name: string; code: string; title: string; finalCents: number; maxCents: number; url: string }) {
  return {
    to: d.email,
    subject: `GroupBuy #${d.code} closed above your price: you're not charged`,
    html: layout("This one landed above your price",
      p(`Hi ${esc(d.name.split(" ")[0])}, GroupBuy #${esc(d.code)}: ${esc(d.title)} closed at ${money(d.finalCents)}, above your maximum of ${money(d.maxCents)}. You're not in this round and you haven't been charged.`) +
      p("We'll let you know when there's another round, or a deal that hits your price."),
      { href: d.url, label: "See open GroupBuys" }),
    text: `GroupBuy #${d.code} ${d.title} closed at ${money(d.finalCents)}, above your max of ${money(d.maxCents)}. You're not charged. ${d.url}`,
  };
}

export function commitPaidEmail(d: { email: string; name: string; code: string; title: string; unit: string; qty: number; amountCents: number; note: string; url: string }) {
  return {
    to: d.email,
    subject: `Payment received: GroupBuy #${d.code} ${d.title}`,
    html: layout("Payment received ✓",
      p(`Thanks ${esc(d.name.split(" ")[0])}, your payment of <strong>${money(d.amountCents)}</strong> for ${esc(unitText(d.qty, d.unit))} of ${esc(d.title)} is confirmed.`) +
      (d.note ? p(esc(d.note).replace(/\n/g, "<br>")) : p("We'll email you pickup or delivery details.")),
      { href: d.url, label: "View my order" }),
    text: `Payment received: ${money(d.amountCents)} for ${unitText(d.qty, d.unit)} of ${d.title} (GroupBuy #${d.code}).\n${d.note}\n${d.url}`,
  };
}

export function commitCancelledEmail(d: { email: string; name: string; code: string; title: string; refundedCents: number }) {
  const refund = d.refundedCents > 0 ? ` We've refunded ${money(d.refundedCents)} to your card; it usually appears within 5–10 business days.` : "";
  return {
    to: d.email,
    subject: `Your GroupBuy #${d.code} order was cancelled`,
    html: layout("Your order was cancelled", p(`Hi ${esc(d.name.split(" ")[0])}, your spot in GroupBuy #${esc(d.code)}: ${esc(d.title)} was cancelled.${esc(refund)}`)),
    text: `Your spot in GroupBuy #${d.code} ${d.title} was cancelled.${refund}`,
  };
}

export function campaignLiveEmail(d: { email: string; code: string; title: string; url: string; requested?: boolean }) {
  const requested = d.requested ?? true;
  return {
    to: d.email,
    subject: `${requested ? "It's live" : "New GroupBuy"}: #${d.code} ${d.title}`,
    html: layout(requested ? "The GroupBuy you asked for is live" : `New GroupBuy: ${d.title}`,
      p(requested
        ? `You said you'd join a GroupBuy for <strong>${esc(d.title)}</strong>. It's now open: join at your price and share it to unlock a better deal.`
        : `GroupBuy #${esc(d.code)}: <strong>${esc(d.title)}</strong> just opened. Join at the price you'd pay. Nothing is charged unless we land a deal at or below it.`),
      { href: d.url, label: "Join the GroupBuy" }),
    text: `GroupBuy #${d.code} ${d.title} is live: ${d.url}`,
  };
}

export function dealChargedEmail(d: { email: string; name: string; code: string; title: string; unit: string; qty: number; finalCents: number;
  feeCents: number; amountCents: number; normalCents: number; card: string; note: string; url: string }) {
  const saved = Math.max(0, (d.normalCents - d.finalCents) * d.qty);
  return {
    to: d.email,
    subject: `Deal secured and paid: ${d.title} at ${money(d.finalCents)} (GroupBuy #${d.code})`,
    html: layout(`You got it for ${money(d.finalCents)} 🎉`,
      p(`Hi ${esc(d.name.split(" ")[0])}, GroupBuy #${esc(d.code)} landed at <strong>${money(d.finalCents)}</strong> per ${esc(d.unit)}, at or below your maximum, so we charged your saved card automatically, as you authorized. Everyone in the group paid this same price.`) +
      details([
        ["Your order", unitText(d.qty, d.unit)], ["Price", `${money(d.finalCents)} each`],
        ...(d.feeCents ? [["GroupBuy fee", `${money(d.feeCents)} each`] as [string, string]] : []),
        ["Charged", `${money(d.amountCents)} to ${d.card}`], ["You saved vs normal price", money(saved)],
      ]) +
      (d.note ? p(esc(d.note).replace(/\n/g, "<br>")) : p("We'll email you pickup or delivery details.")),
      { href: d.url, label: "View my order" }),
    text: `GroupBuy #${d.code} ${d.title} landed at ${money(d.finalCents)}. We charged ${money(d.amountCents)} to ${d.card} for ${unitText(d.qty, d.unit)}.\n${d.note}\n${d.url}`,
  };
}
