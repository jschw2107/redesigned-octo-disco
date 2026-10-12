import { all, one, run, db } from "./db";
import { addDaysInTz } from "./tz";

export type Settings = { cycle_days: number; pickup_offset_hours: number; timezone: string; ordering_paused: boolean };
export type University = { id: number; name: string; pickup_location: string; active: number; sort: number };
export type Hall = { id: number; university_id: number; name: string; sort: number };
export type UniversityWithHalls = University & { halls: Hall[] };
export type Product = {
  id: number; name: string; description: string; tag: string; image_url: string;
  price_cents: number | null; retail_cents: number | null; min_group: number; active: number; sort: number;
};
export type Cycle = { id: number; closes_at: string; status: string; closed_at: string | null };
export type StoreItem = { id: number; name: string; description: string; image_url: string; price_cents: number; stock: number; active: number };

export const OFF_CAMPUS_LABEL = "Off-campus apartment";

export async function getSettings(): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    cycle_days: Number(m.cycle_days ?? 7),
    pickup_offset_hours: Number(m.pickup_offset_hours ?? 72),
    timezone: m.timezone ?? "America/New_York",
    ordering_paused: m.ordering_paused === "1",
  };
}

export async function setSetting(key: keyof Settings, value: string) {
  await run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
}

/**
 * Returns the open ordering cycle. If its close time has passed, it is marked closed
 * (its orders are now "placed" with the supplier) and the next cycle opens automatically,
 * `cycle_days` after the previous close.
 */
export async function currentCycle(): Promise<Cycle> {
  const c = await db();
  const s = await getSettings();
  const now = Date.now();
  let open = await one<Cycle>("SELECT * FROM cycles WHERE status='open' ORDER BY id DESC LIMIT 1");
  if (!open) {
    const closes = addDaysInTz(new Date(now).toISOString(), s.cycle_days, s.timezone);
    await run("INSERT INTO cycles (closes_at) VALUES (?)", [closes]);
    return (await one<Cycle>("SELECT * FROM cycles WHERE status='open' ORDER BY id DESC LIMIT 1"))!;
  }
  if (Date.parse(open.closes_at) > now) return open;

  // Roll forward: close the expired cycle and open the next one on schedule.
  let next = open.closes_at;
  while (Date.parse(next) <= now) next = addDaysInTz(next, Math.max(1, s.cycle_days), s.timezone);
  const tx = await c.transaction("write");
  try {
    const upd = await tx.execute({
      sql: "UPDATE cycles SET status='closed', closed_at=? WHERE id=? AND status='open'",
      args: [open.closes_at, open.id],
    });
    if (upd.rowsAffected === 1) {
      await tx.execute({ sql: "INSERT INTO cycles (closes_at) VALUES (?)", args: [next] });
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  open = await one<Cycle>("SELECT * FROM cycles WHERE status='open' ORDER BY id DESC LIMIT 1");
  return open!;
}

export function pickupTime(cycle: Cycle, s: Settings) {
  return new Date(Date.parse(cycle.closes_at) + s.pickup_offset_hours * 3600000).toISOString();
}

export async function getUniversities(activeOnly = true): Promise<UniversityWithHalls[]> {
  const unis = await all<University>(
    `SELECT * FROM universities ${activeOnly ? "WHERE active=1" : ""} ORDER BY sort, name`
  );
  const halls = await all<Hall>("SELECT * FROM halls ORDER BY sort, name");
  return unis.map((u) => ({ ...u, halls: halls.filter((h) => h.university_id === u.id) }));
}

export async function getProducts(activeOnly = true): Promise<Product[]> {
  return all<Product>(`SELECT * FROM products ${activeOnly ? "WHERE active=1" : ""} ORDER BY sort, id`);
}

export async function getStoreItems(activeOnly = true): Promise<StoreItem[]> {
  return all<StoreItem>(`SELECT * FROM store_items ${activeOnly ? "WHERE active=1 AND stock>0" : ""} ORDER BY name`);
}

/** Students joined per product, per university, in a cycle. */
export async function groupProgress(cycleId: number) {
  return all<{ product_id: number; university_id: number; students: number; units: number }>(
    `SELECT oi.product_id, o.university_id, COUNT(DISTINCT lower(o.email)) AS students, SUM(oi.qty) AS units
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.cycle_id = ? AND o.status IN ('placed','picked_up')
     GROUP BY oi.product_id, o.university_id`,
    [cycleId]
  );
}

export function fmtMoney(cents: number | null | undefined) {
  if (cents == null) return "TBD";
  return `$${(cents / 100).toFixed(2)}`;
}

export function fmtDate(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(iso));
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
