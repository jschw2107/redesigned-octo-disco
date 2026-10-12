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

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

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
    subject: "You're on the GroupBuy waitlist",
    html: layout("You're on the list 🎉",
      p(`Thanks for joining the GroupBuy waitlist for <strong>${esc(w.university)}</strong>. We'll email you about launch and the first campus drop.`) +
      p("Want in sooner? Tell your neighbors. The more students join, the better the deals."),
      { href: w.url, label: "See the essentials" }),
    text: `Thanks for joining the GroupBuy waitlist for ${w.university}. We'll email you about launch and the first campus drop.\n${w.url}`,
  };
}
