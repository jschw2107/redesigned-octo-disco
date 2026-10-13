import { all, one } from "./db";

/**
 * GroupBuy as a reverse marketplace.
 *
 * - A campaign ("GroupBuy #001") has a normal price, a starting target, a set of price levels students can
 *   commit at ("I'll buy at $199 or less", "$189 or less", …) and indicative tiers ("150 buyers → $189").
 * - Each commitment records the buyer's MAXIMUM price. It decides whether they are in the deal, never what they pay.
 * - When a supplier offers a price, everyone whose maximum is at or above it gets the deal at that one clearing price.
 */

export type Tier = { units: number; cents: number };
export type Campaign = {
  id: number; number: number; title: string; summary: string; description: string; category: string; emoji: string;
  image_url: string; unit: string; normal_cents: number; target_cents: number; price_options: string; tiers: string;
  goal: number; max_per_buyer: number; fee_cents: number; deadline: string; status: string; final_cents: number | null;
  pay_by: string | null; deal_note: string; request_id: number | null; live_notified: number; created_at: string; sort: number;
};
export type CampaignWithStats = Campaign & { units: number; buyers: number; demand_cents: number };

/** Commitment statuses that count as live demand. */
export const COUNTED = ["active", "won", "paid"];
const COUNTED_SQL = COUNTED.map((s) => `'${s}'`).join(",");

/** draft (hidden) · live (taking commitments) · negotiating (closed to new joins) · deal (price secured) · closed · cancelled */
export const CAMPAIGN_STATUSES = ["draft", "live", "negotiating", "deal", "closed", "cancelled"];
export const PUBLIC_STATUSES = ["live", "negotiating", "deal", "closed"];

export const code = (n: number) => String(n).padStart(3, "0");
export const campaignPath = (n: number) => `/g/${code(n)}`;

export function parseOptions(c: Pick<Campaign, "price_options" | "target_cents">): number[] {
  let arr: number[] = [];
  try { arr = JSON.parse(c.price_options); } catch {}
  arr = arr.filter((n) => Number.isInteger(n) && n > 0);
  if (!arr.includes(c.target_cents)) arr.push(c.target_cents);
  return [...new Set(arr)].sort((a, b) => b - a);
}

export function parseTiers(c: Pick<Campaign, "tiers">): Tier[] {
  let arr: Tier[] = [];
  try { arr = JSON.parse(c.tiers); } catch {}
  return arr.filter((t) => t && t.units > 0 && t.cents > 0).sort((a, b) => a.units - b.units);
}

export function isOpen(c: Campaign, now = Date.now()) {
  return c.status === "live" && Date.parse(c.deadline) > now;
}

/** Current indicative target given how many units are committed, plus the next tier to unlock. */
export function ladder(c: CampaignWithStats) {
  const tiers = parseTiers(c);
  let current = c.target_cents;
  for (const t of tiers) if (c.units >= t.units && t.cents < current) current = t.cents;
  const goalReached = c.units >= c.goal;
  const next = !goalReached ? { units: c.goal, cents: c.target_cents } : tiers.find((t) => t.units > c.units) ?? null;
  const toNext = next ? Math.max(0, next.units - c.units) : 0;
  const progress = next ? Math.min(1, c.units / next.units) : 1;
  return { tiers, current, next, toNext, goalReached, progress };
}

export function publicState(c: Campaign, now = Date.now()) {
  if (c.status === "deal") return { key: "deal", label: "Deal secured" };
  if (c.status === "closed") return { key: "closed", label: "Closed" };
  if (c.status === "cancelled") return { key: "closed", label: "Cancelled" };
  if (c.status === "negotiating" || (c.status === "live" && Date.parse(c.deadline) <= now)) return { key: "negotiating", label: "Negotiating with sellers" };
  if (c.status === "draft") return { key: "draft", label: "Draft" };
  return { key: "open", label: "Open" };
}

const STATS = `COALESCE((SELECT SUM(qty) FROM commitments m WHERE m.campaign_id=c.id AND m.status IN (${COUNTED_SQL})),0) AS units,
  COALESCE((SELECT COUNT(*) FROM commitments m WHERE m.campaign_id=c.id AND m.status IN (${COUNTED_SQL})),0) AS buyers,
  COALESCE((SELECT SUM(qty*max_cents) FROM commitments m WHERE m.campaign_id=c.id AND m.status IN (${COUNTED_SQL})),0) AS demand_cents`;

export async function listCampaigns(opts: { publicOnly?: boolean } = {}) {
  const where = opts.publicOnly ? `WHERE c.status IN (${PUBLIC_STATUSES.map((s) => `'${s}'`).join(",")})` : "";
  return all<CampaignWithStats>(
    `SELECT c.*, ${STATS} FROM campaigns c ${where}
     ORDER BY CASE c.status WHEN 'live' THEN 0 WHEN 'negotiating' THEN 1 WHEN 'deal' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END, c.sort, c.number`);
}

export async function getCampaign(by: { number?: number; id?: number }) {
  if (by.id != null) return one<CampaignWithStats>(`SELECT c.*, ${STATS} FROM campaigns c WHERE c.id=?`, [by.id]);
  return one<CampaignWithStats>(`SELECT c.*, ${STATS} FROM campaigns c WHERE c.number=?`, [by.number ?? -1]);
}

/**
 * Demand curve: for each price level, how many buyers/units would buy at that price
 * (everyone whose maximum is at or above it).
 */
export async function demandCurve(c: Campaign, extraPrices: number[] = []) {
  const rows = await all<{ max_cents: number; qty: number }>(
    `SELECT max_cents, qty FROM commitments WHERE campaign_id=? AND status IN (${COUNTED_SQL})`, [c.id]);
  const levels = [...new Set([...parseOptions(c), ...extraPrices])].sort((a, b) => b - a);
  return levels.map((price) => {
    const inn = rows.filter((r) => r.max_cents >= price);
    const units = inn.reduce((s, r) => s + r.qty, 0);
    return { price, buyers: inn.length, units, value: units * price };
  });
}

/**
 * Who gets the deal at a supplier's price: every active commitment whose max ≥ price, earliest first,
 * optionally capped at the number of units the supplier can provide.
 */
export async function clearing(campaignId: number, priceCents: number, unitCap?: number | null) {
  const rows = await all<{ id: number; qty: number; max_cents: number; created_at: string }>(
    `SELECT id, qty, max_cents, created_at FROM commitments WHERE campaign_id=? AND status='active' ORDER BY created_at, id`, [campaignId]);
  const eligible: number[] = [];
  const left: number[] = [];
  let units = 0;
  for (const r of rows) {
    if (r.max_cents >= priceCents && (!unitCap || units + r.qty <= unitCap)) { eligible.push(r.id); units += r.qty; }
    else left.push(r.id);
  }
  return { eligible, left, units, buyers: eligible.length, value: units * priceCents };
}

/** The headline metric: committed purchasing demand (units × each buyer's max price) and distinct students. */
export async function demand(sinceDays?: number) {
  const since = sinceDays ? new Date(Date.now() - sinceDays * 86400000).toISOString() : "";
  const r = await one<{ dollars: number; students: number; commitments: number; units: number; edu: number }>(
    `SELECT COALESCE(SUM(m.qty*m.max_cents),0) AS dollars, COUNT(DISTINCT lower(m.email)) AS students, COUNT(*) AS commitments,
            COALESCE(SUM(m.qty),0) AS units,
            COUNT(DISTINCT CASE WHEN lower(m.email) LIKE '%.edu' THEN lower(m.email) END) AS edu
     FROM commitments m JOIN campaigns c ON c.id=m.campaign_id
     WHERE m.status IN (${COUNTED_SQL}) AND c.status != 'draft' ${sinceDays ? "AND m.created_at >= ?" : ""}`,
    sinceDays ? [since] : []);
  return r ?? { dollars: 0, students: 0, commitments: 0, units: 0, edu: 0 };
}

export const usd = (cents: number | null | undefined, digits?: number) => {
  if (cents == null) return "";
  const d = digits ?? (cents % 100 === 0 ? 0 : 2);
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
};

export const usdCompact = (cents: number) => {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 10_000) return `$${Math.round(d / 1000)}K`;
  return d.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};

export const plural = (n: number, unit: string) =>
  n === 1 ? unit : /(s|x|z|ch|sh)$/.test(unit) ? `${unit}es` : `${unit}s`;

export async function getSetting(key: string, fallback = "") {
  const r = await one<{ value: string }>("SELECT value FROM settings WHERE key=?", [key]);
  return r?.value ?? fallback;
}

/** Optional restriction, e.g. "mail.yu.edu, yu.edu" so only verified school emails can commit. */
export async function allowedDomains(): Promise<string[]> {
  return (await getSetting("email_domains")).split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}
