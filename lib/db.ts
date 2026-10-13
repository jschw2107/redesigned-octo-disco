import { createClient, type Client, type InStatement, type Row } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { localInputToIso } from "./tz";

// Local dev: a SQLite file in ./data. Production: set DATABASE_URL (+ DATABASE_AUTH_TOKEN) to a Turso/libSQL database.
// Accepts our own names or the ones Turso's Vercel integration sets automatically.
const dbUrl = () => process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || process.env.DATABASE_TURSO_DATABASE_URL;

function makeClient(): Client {
  const url = dbUrl();
  if (url) return createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_TURSO_AUTH_TOKEN });
  // On Vercel the project folder is read-only, so without DATABASE_URL fall back to /tmp.
  // That keeps the site working, but data there is temporary: connect Turso for real use.
  const dir = process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return createClient({ url: `file:${path.join(dir, "groupbuy.db")}` });
}

const g = globalThis as unknown as { __gbClient?: Client; __gbReady?: Promise<void> };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS universities (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pickup_location TEXT NOT NULL DEFAULT '',
     active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS halls (
     id INTEGER PRIMARY KEY AUTOINCREMENT, university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
     name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS products (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
     tag TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', price_cents INTEGER, retail_cents INTEGER,
     min_group INTEGER NOT NULL DEFAULT 10, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS cycles (
     id INTEGER PRIMARY KEY AUTOINCREMENT, closes_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
     closed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS orders (
     id TEXT PRIMARY KEY, created_at TEXT NOT NULL, cycle_id INTEGER NOT NULL REFERENCES cycles(id),
     name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
     university_id INTEGER NOT NULL, university_name TEXT NOT NULL,
     hall_id INTEGER, hall_name TEXT NOT NULL, off_campus INTEGER NOT NULL DEFAULT 0, apartment TEXT NOT NULL DEFAULT '',
     total_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'placed', notes TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS order_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
     product_id INTEGER NOT NULL, product_name TEXT NOT NULL, unit_cents INTEGER NOT NULL, qty INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS waitlist (
     id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, email TEXT NOT NULL,
     university_id INTEGER, university_name TEXT NOT NULL, hall_name TEXT NOT NULL DEFAULT '',
     off_campus INTEGER NOT NULL DEFAULT 0, UNIQUE(email, university_name))`,
  `CREATE TABLE IF NOT EXISTS store_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
     image_url TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0,
     active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS reservations (
     id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, store_item_id INTEGER NOT NULL,
     item_name TEXT NOT NULL, unit_cents INTEGER NOT NULL, qty INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
     university_name TEXT NOT NULL, hall_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'reserved')`,
  `CREATE INDEX IF NOT EXISTS idx_orders_cycle ON orders(cycle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id)`,
  // ---- Reverse marketplace: campaigns ("GroupBuys"), commitments, student requests ----
  `CREATE TABLE IF NOT EXISTS campaigns (
     id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER NOT NULL UNIQUE, title TEXT NOT NULL,
     summary TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
     emoji TEXT NOT NULL DEFAULT '🛍️', image_url TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT 'item',
     normal_cents INTEGER NOT NULL, target_cents INTEGER NOT NULL,
     price_options TEXT NOT NULL DEFAULT '[]', tiers TEXT NOT NULL DEFAULT '[]',
     goal INTEGER NOT NULL DEFAULT 100, max_per_buyer INTEGER NOT NULL DEFAULT 1, fee_cents INTEGER NOT NULL DEFAULT 0,
     deadline TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
     final_cents INTEGER, pay_by TEXT, deal_note TEXT NOT NULL DEFAULT '', request_id INTEGER, live_notified INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS commitments (
     id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
     university_id INTEGER, university_name TEXT NOT NULL DEFAULT '', hall_name TEXT NOT NULL DEFAULT '', apartment TEXT NOT NULL DEFAULT '',
     max_cents INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active',
     ref TEXT, confirmed_at TEXT, amount_cents INTEGER, paid_at TEXT, stripe_session_id TEXT, payment_intent TEXT,
     refunded_cents INTEGER NOT NULL DEFAULT 0, UNIQUE(campaign_id, email))`,
  `CREATE INDEX IF NOT EXISTS idx_commit_campaign ON commitments(campaign_id, status)`,
  `CREATE TABLE IF NOT EXISTS requests (
     id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
     target_cents INTEGER, name TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', campaign_id INTEGER)`,
  `CREATE TABLE IF NOT EXISTS images (
     id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER, mime TEXT NOT NULL, data BLOB NOT NULL,
     bytes INTEGER NOT NULL, width INTEGER, height INTEGER, created_at TEXT NOT NULL)`,
  // Extra units bought to meet a seller's minimum order, sold individually after the deal.
  `CREATE TABLE IF NOT EXISTS extra_orders (
     id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
     university_name TEXT NOT NULL DEFAULT '', hall_name TEXT NOT NULL DEFAULT '', room TEXT NOT NULL DEFAULT '', apartment TEXT NOT NULL DEFAULT '',
     qty INTEGER NOT NULL, unit_cents INTEGER NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending_payment',
     stripe_session_id TEXT, payment_intent TEXT, paid_at TEXT, refunded_cents INTEGER NOT NULL DEFAULT 0)`,
  // Order-update messages the admin sends to a GroupBuy's buyers (also shown on their order pages)
  `CREATE TABLE IF NOT EXISTS updates (
     id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, created_at TEXT NOT NULL,
     audience TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS request_votes (
     id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
     email TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(request_id, email))`,
];

const IMG = (id: string) => `https://framerusercontent.com/images/${id}.jpg`;
const SEED_PRODUCTS: Array<[string, string, string, string, number | null, number | null]> = [
  ["Protein bars", "Assorted bars / flavors and pack size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("PafIEVyNvXkr7taBZgPK3jMr8M"), 800, null],
  ["Paper towels", "Rolls / pack size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("eeJBw6qIZa1C3rJ1AqXcYoBrjI"), null, null],
  ["Energy drinks", "Canned energy drinks / pack size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("9AkBPINpskuj6aHkEwffObgijYk"), null, null],
  ["Wipes", "Pre-moistened wipes / pack size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("DmZKKjbPUqmDofUfMl8f9T2wA"), null, null],
  ["Coffee pods", "Coffee pods / brewer compatibility at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("0PlWQjRJJZ4rjYcgDz5UaKEGQYI"), null, null],
  ["Mouthwash", "One bottle / flavor and size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", "", null, null],
  ["Floss", "Dental floss / length at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("P9SDKQmfrAP0fBx7unxApGm6k4w"), null, null],
  ["Tissues", "Facial tissues / box size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("6LKQTvAHbXeeFLv5Uvuq5onbq7k"), null, null],
  ["Soap", "Bar soap / pack size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("YJEtQOsPVjkYdp47nulYmPyreDI"), null, null],
  ["Shampoo", "One bottle / size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("b0VNYIlXcaXVHNTHhNBTznkq3w"), null, null],
  ["Conditioner", "One bottle / size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("jxBeJbAb1exW5FlCGADLWDEumZw"), null, null],
  ["Case of water", "Bottled drinking water / case size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("OvbmWSyJwbiw8311K26N3igFw"), null, null],
  ["Toothpaste", "One tube / size at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("JN2cxt5X9hICPTiGsPj8lnUQY"), null, null],
  ["Men’s deodorant", "One deodorant / scents at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("XQeU5d9iQ30BwaXl3cSQCxv3ec"), null, null],
  ["Women’s deodorant", "One deodorant / scents at launch", "WHOLESALE BUYING · STUDENT SAVINGS", IMG("Ocg63FAoh69JqzSwb3EF7vgM"), null, null],
  ["Health-Nut snack bundle", "12 portions / nuts, trail mix & granola bars", "SMART SNACKS · SHARED SAVINGS", IMG("BNt4wS06sb90WbZuF4OgjrrGY2Q"), null, null],
  ["Fun snack bundle", "12 portions / popcorn, chips & sweet treats", "STUDY-BREAK FAVORITES · SHARED SAVINGS", IMG("ttIBbh5sOKuH4NSuLs1V1hT4zS0"), null, null],
  ["Sparkling water", "12 cans / your share of the bulk buy", "SAMPLE DEAL", IMG("9AkBPINpskuj6aHkEwffObgijYk"), 600, 900],
  ["Laundry detergent", "One bottle / 32 loads", "SAMPLE DEAL", IMG("OFRcqIe7p48b9quzHWCnKLx8"), 750, 1000],
  ["Study-break snacks", "Assorted snacks / 12 portions", "SAMPLE DEAL", IMG("0wpGaQTMjsvgxniQuzYJA231JnQ"), 800, 1200],
];

// Columns added after the first version. Applied on startup; safe to run repeatedly.
const COLUMNS: Array<[string, string]> = [
  ["orders", "payment_method TEXT NOT NULL DEFAULT 'pickup'"],
  ["orders", "stripe_session_id TEXT"],
  ["orders", "payment_intent TEXT"],
  ["orders", "paid_at TEXT"],
  ["orders", "refunded_cents INTEGER NOT NULL DEFAULT 0"],
  ["reservations", "code TEXT"],
  ["reservations", "payment_method TEXT NOT NULL DEFAULT 'pickup'"],
  ["reservations", "stripe_session_id TEXT"],
  ["reservations", "payment_intent TEXT"],
  ["reservations", "paid_at TEXT"],
  ["reservations", "refunded_cents INTEGER NOT NULL DEFAULT 0"],
  // Saved card for automatic charging when a deal is locked
  ["commitments", "stripe_customer_id TEXT"],
  ["commitments", "payment_method_id TEXT"],
  ["commitments", "card_label TEXT"],
  ["commitments", "setup_session_id TEXT"],
  ["commitments", "charge_error TEXT"],
  // Room number for delivery/pickup sorting
  ["commitments", "room TEXT NOT NULL DEFAULT ''"],
  // Seller minimum orders: units bought, extras left for individual sale and their price
  ["campaigns", "bought_units INTEGER"],
  ["campaigns", "extra_units INTEGER NOT NULL DEFAULT 0"],
  ["campaigns", "extra_cents INTEGER"],
  // GroupBuy's savings-share fee: rate agreed at join time (basis points) and the amount charged at deal time
  ["commitments", "fee_bps INTEGER"],
  ["commitments", "fee_amount_cents INTEGER"],
];

export const UNIVERSITY = "Yeshiva University";
export const HALLS = ["Rubin Hall", "Muss Hall", "Morgenstern Hall"];
export const PICKUP = "Wilf Campus (exact spot emailed before each pickup)";

async function migrate(c: Client) {
  for (const [table, col] of COLUMNS) {
    const name = col.split(" ")[0];
    const info = await c.execute(`PRAGMA table_info(${table})`);
    if (!info.rows.some((r) => r[1] === name)) await c.execute(`ALTER TABLE ${table} ADD COLUMN ${col}`);
  }
  await c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_res_code ON reservations(code)");
  await c.execute("CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(stripe_session_id)");

  // One-time: replace the placeholder "Example University" with Yeshiva University (if it has no orders).
  const done = await c.execute("SELECT 1 FROM settings WHERE key='migrated_yu'");
  if (done.rows.length) return;
  const ex = await c.execute("SELECT id FROM universities WHERE name='Example University'");
  if (ex.rows.length) {
    const id = ex.rows[0][0] as number;
    const used = await c.execute({ sql: "SELECT 1 FROM orders WHERE university_id=? LIMIT 1", args: [id] });
    if (!used.rows.length) {
      await c.batch([
        { sql: "DELETE FROM halls WHERE university_id=?", args: [id] },
        { sql: "UPDATE universities SET name=?, pickup_location=? WHERE id=?", args: [UNIVERSITY, PICKUP, id] },
        ...HALLS.map((h, i) => ({ sql: "INSERT INTO halls (university_id, name, sort) VALUES (?,?,?)", args: [id, h, i] })),
      ], "write");
    }
  }
  await c.execute("INSERT OR REPLACE INTO settings VALUES ('migrated_yu', '1')");
}

// Illustrative launch campaigns. Prices are targets to test demand, not negotiated deals; edit them in Admin → GroupBuys.
type Seed = { title: string; summary: string; description: string; category: string; emoji: string; unit: string;
  normal: number; target: number; options: number[]; tiers: [number, number][]; goal: number; max: number; days: number };
const SEED_CAMPAIGNS: Seed[] = [
  { title: "Celsius energy drinks", summary: "24-can case, assorted flavors", category: "Food & drink", emoji: "⚡", unit: "case",
    description: "A case of 24 Celsius cans delivered to campus. Flavors confirmed with the supplier once the deal is set.",
    normal: 5000, target: 3900, options: [3900, 3700, 3500, 3300], tiers: [[150, 3700], [250, 3500]], goal: 100, max: 4, days: 5 },
  { title: "AirPods Pro", summary: "Latest model, sealed, US warranty", category: "Electronics", emoji: "🎧", unit: "pair",
    description: "New, sealed AirPods Pro from an authorized seller, with full US warranty.",
    normal: 24900, target: 19900, options: [19900, 18900, 17900, 16900], tiers: [[150, 18900], [300, 17900]], goal: 100, max: 1, days: 10 },
  { title: "Dorm mini fridge", summary: "3.1 cu ft with freezer compartment", category: "Dorm", emoji: "🧊", unit: "fridge",
    description: "A compact 3.1 cu ft fridge sized for dorm rooms, delivered to your residence hall.",
    normal: 18000, target: 13500, options: [13500, 12900, 11900], tiers: [[75, 12900], [120, 11900]], goal: 50, max: 1, days: 10 },
  { title: "Laundry detergent", summary: "Large bottle, about 100 loads", category: "Household", emoji: "🧺", unit: "bottle",
    description: "A big bottle of name-brand laundry detergent, enough for a semester.",
    normal: 2200, target: 1700, options: [1700, 1600, 1500], tiers: [[100, 1600], [200, 1500]], goal: 50, max: 3, days: 5 },
  { title: "Pesach flights: New York ⇄ Tel Aviv", summary: "Round trip around Pesach break", category: "Travel", emoji: "✈️", unit: "ticket",
    description: "Interest check: if enough students want to fly around the same dates, we take the group to airlines and travel agencies and ask them to compete.",
    normal: 110000, target: 89900, options: [89900, 84900, 79900], tiers: [[200, 84900], [400, 79900]], goal: 100, max: 1, days: 21 },
];

async function seedCampaigns(c: Client) {
  const done = await c.execute("SELECT 1 FROM settings WHERE key='seeded_campaigns'");
  if (done.rows.length) return;
  const now = Date.now();
  await c.batch([
    ...SEED_CAMPAIGNS.map((s, i) => ({
      sql: `INSERT OR IGNORE INTO campaigns (number, title, summary, description, category, emoji, unit, normal_cents, target_cents,
              price_options, tiers, goal, max_per_buyer, deadline, status, created_at, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [i + 1, s.title, s.summary, s.description, s.category, s.emoji, s.unit, s.normal, s.target, JSON.stringify(s.options),
        JSON.stringify(s.tiers.map(([units, cents]) => ({ units, cents }))), s.goal, s.max,
        new Date(now + s.days * 86400000).toISOString(), "live", new Date(now).toISOString(), i],
    })),
    { sql: "INSERT OR REPLACE INTO settings VALUES ('seeded_campaigns', '1')", args: [] },
  ], "write");
}

async function init(c: Client) {
  await c.execute("PRAGMA foreign_keys = ON");
  await c.batch(SCHEMA, "write");
  await migrate(c);
  await seedCampaigns(c);
  const seeded = await c.execute("SELECT value FROM settings WHERE key='seeded'");
  if (seeded.rows.length) return;

  // First close: the coming Sunday at 8:00 PM New York time.
  const now = new Date();
  const sun = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (7 - now.getUTCDay())));
  const close = new Date(localInputToIso(sun.toISOString().slice(0, 10) + "T20:00", "America/New_York")!);
  const stmts: InStatement[] = [
    { sql: "INSERT OR REPLACE INTO settings VALUES ('cycle_days', ?)", args: ["7"] },
    { sql: "INSERT OR REPLACE INTO settings VALUES ('pickup_offset_hours', ?)", args: ["72"] },
    { sql: "INSERT OR REPLACE INTO settings VALUES ('timezone', ?)", args: ["America/New_York"] },
    { sql: "INSERT OR REPLACE INTO settings VALUES ('ordering_paused', ?)", args: ["0"] },
    { sql: "INSERT INTO cycles (closes_at, status) VALUES (?, 'open')", args: [close.toISOString()] },
    { sql: "INSERT INTO universities (name, pickup_location, sort) VALUES (?, ?, 0)", args: [UNIVERSITY, PICKUP] },
    ...HALLS.map((h, i) => ({
      sql: "INSERT INTO halls (university_id, name, sort) VALUES ((SELECT id FROM universities WHERE name=?), ?, ?)",
      args: [UNIVERSITY, h, i],
    })),
    ...SEED_PRODUCTS.map((p, i) => ({
      sql: "INSERT INTO products (name, description, tag, image_url, price_cents, retail_cents, min_group, sort) VALUES (?,?,?,?,?,?,?,?)",
      args: [p[0], p[1], p[2], p[3], p[4], p[5], 10, i],
    })),
    { sql: "INSERT OR REPLACE INTO settings VALUES ('seeded', '1')", args: [] },
    { sql: "INSERT OR REPLACE INTO settings VALUES ('migrated_yu', '1')", args: [] },
  ];
  await c.batch(stmts, "write");
}

/** True when running on a host where the database file is temporary (Vercel without DATABASE_URL). */
export function databaseIsTemporary() {
  return !!process.env.VERCEL && !dbUrl();
}

export async function db(): Promise<Client> {
  if (!g.__gbClient) g.__gbClient = makeClient();
  if (!g.__gbReady) g.__gbReady = init(g.__gbClient).catch((e) => { g.__gbReady = undefined; throw e; });
  await g.__gbReady;
  return g.__gbClient;
}

export async function all<T = Record<string, unknown>>(sql: string, args: (string | number | null)[] = []): Promise<T[]> {
  const r = await (await db()).execute({ sql, args });
  return r.rows.map((row: Row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])) as T);
}
export async function one<T = Record<string, unknown>>(sql: string, args: (string | number | null)[] = []): Promise<T | null> {
  return (await all<T>(sql, args))[0] ?? null;
}
export async function run(sql: string, args: (string | number | null)[] = []) {
  return (await db()).execute({ sql, args });
}
