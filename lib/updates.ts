import { all, run } from "./db";
import { code, getCampaign } from "./campaigns";
import { orderUpdateEmail, sendEmail } from "./email";

/** Who an update goes to. */
export const AUDIENCES = {
  everyone: { label: "Everyone in this GroupBuy (incl. extras buyers)", statuses: ["active", "pending_card", "pending", "won", "paid"], extras: true },
  committed: { label: "Committed buyers (deal not locked yet)", statuses: ["active", "pending_card", "pending"], extras: false },
  winners: { label: "Deal winners (paid or awaiting payment)", statuses: ["won", "paid"], extras: false },
  paid: { label: "Paid buyers only", statuses: ["paid"], extras: false },
  unpaid: { label: "Winners who haven’t paid yet", statuses: ["won"], extras: false },
  not_matched: { label: "People whose price was too low", statuses: ["not_matched"], extras: false },
  extras: { label: "Extras buyers", statuses: [] as string[], extras: true },
} as const;
export type Audience = keyof typeof AUDIENCES;

/** Does an update addressed to `audience` apply to a buyer with this commitment status? */
export function updateApplies(audience: string, status: string) {
  const a = AUDIENCES[audience as Audience];
  return !!a && (a.statuses as readonly string[]).includes(status);
}

type Recipient = { email: string; name: string; url: string };

export async function recipients(campaignId: number, audience: Audience, base: string): Promise<Recipient[]> {
  const a = AUDIENCES[audience];
  const out: Recipient[] = [];
  if (a.statuses.length) {
    const ms = await all<{ email: string; name: string; token: string }>(
      `SELECT email, name, token FROM commitments WHERE campaign_id=? AND status IN (${a.statuses.map(() => "?").join(",")})`,
      [campaignId, ...a.statuses]);
    out.push(...ms.map((m) => ({ email: m.email, name: m.name, url: `${base}/c/${m.token}` })));
  }
  if (a.extras) {
    const xs = await all<{ email: string; name: string; code: string }>(
      "SELECT email, name, code FROM extra_orders WHERE campaign_id=? AND status IN ('paid','reserved')", [campaignId]);
    out.push(...xs.map((x) => ({ email: x.email, name: x.name, url: `${base}/x/${x.code}` })));
  }
  return out;
}

export async function audienceCounts(campaignId: number) {
  const out: Record<string, number> = {};
  for (const k of Object.keys(AUDIENCES) as Audience[]) out[k] = (await recipients(campaignId, k, "")).length;
  return out;
}

/** Emails an update to the chosen audience and saves it so buyers also see it on their order page. */
export async function sendUpdate(campaignId: number, audience: Audience, subject: string, body: string, base: string) {
  const camp = await getCampaign({ id: campaignId });
  if (!camp) throw new Error("GroupBuy not found");
  const list = await recipients(campaignId, audience, base);
  let sent = 0;
  for (const r of list) {
    if (await sendEmail(orderUpdateEmail({ email: r.email, name: r.name, code: code(camp.number), title: camp.title, subject, body, url: r.url }))) sent++;
  }
  await run("INSERT INTO updates (campaign_id, created_at, audience, subject, body, sent) VALUES (?,?,?,?,?,?)",
    [campaignId, new Date().toISOString(), audience, subject, body, sent]);
  return { sent, total: list.length };
}
