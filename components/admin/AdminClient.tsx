"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addDaysInTz, localInputToIso } from "@/lib/tz";

/* ---------- helpers ---------- */

async function api(method: string, path: string, body?: unknown): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { window.location.reload(); return { ok: false, error: "Signed out" }; }
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Request failed (${res.status})` };
  } catch {
    return { ok: false, error: "Couldn’t reach the server" };
  }
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function run(method: string, path: string, body?: unknown) {
    setBusy(true); setError(null); setSaved(false);
    const r = await api(method, path, body);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Error"); return false; }
    setSaved(true); setTimeout(() => setSaved(false), 1800);
    router.refresh();
    return true;
  }
  return { busy, error, saved, run, setError };
}

const dollars = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));

const fmt = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));

/* ---------- auth ---------- */

export function AdminLogin({ configured }: { configured: boolean }) {
  const [pw, setPw] = useState("");
  const { busy, error, run } = useAction();
  return (
    <main className="container section" style={{ maxWidth: 440 }}>
      <form className="panel stack" style={{ gap: 16 }} onSubmit={async (e) => { e.preventDefault(); if (await run("POST", "/api/admin/login", { password: pw })) window.location.reload(); }}>
        <h2 style={{ fontSize: "1.8rem" }}>GroupBuy admin</h2>
        {!configured && <div className="alert warn">Set the <code>ADMIN_PASSWORD</code> environment variable, then restart the app.</div>}
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        {error && <div className="alert error">{error}</div>}
        <button className="btn accent" disabled={busy || !configured}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}

export function LogoutButton() {
  return (
    <button className="btn sm ghost" style={{ color: "#fff", boxShadow: "inset 0 0 0 1.5px #4a4458" }}
      onClick={async () => { await api("POST", "/api/admin/logout"); window.location.href = "/admin"; }}>
      Sign out
    </button>
  );
}

/* ---------- schedule ---------- */

const PRESETS = [
  [7, "Every week"],
  [14, "Every 2 weeks"],
  [28, "Every 4 weeks"],
] as const;

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export function ScheduleForm({ settings, cycleId, closesAt, closesLocal }: {
  settings: { cycle_days: number; pickup_offset_hours: number; timezone: string; ordering_paused: boolean };
  cycleId: number; closesAt: string; closesLocal: string;
}) {
  const [days, setDays] = useState(settings.cycle_days);
  const [custom, setCustom] = useState(!PRESETS.some(([d]) => d === settings.cycle_days));
  const [close, setClose] = useState(closesLocal);
  const [pickup, setPickup] = useState(settings.pickup_offset_hours);
  const [tz, setTz] = useState(settings.timezone);
  const [paused, setPaused] = useState(settings.ordering_paused);
  const { busy, error, saved, run, setError } = useAction();
  const closeNow = useAction();

  const preview = useMemo(() => {
    const first = localInputToIso(close, tz);
    if (!first || !days || days < 1) return [];
    const out = [first];
    for (let i = 0; i < 3; i++) out.push(addDaysInTz(out[out.length - 1], days, tz));
    return out;
  }, [close, days, tz]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const iso = localInputToIso(close, tz);
    if (!iso) return setError("Pick a valid close date and time");
    const ok = await run("PATCH", "/api/admin/settings", { cycle_days: days, pickup_offset_hours: pickup, timezone: tz, ordering_paused: paused });
    if (ok && iso !== closesAt) await run("PATCH", "/api/admin/cycle", { closes_at: iso });
  }

  return (
    <>
      <div className="admin-h"><h2>Order schedule</h2></div>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 720 }}>
        Each round, students add items until the order window closes. At close, that round’s orders are locked and become your purchase list,
        and the next round opens automatically on the schedule below.
      </p>
      <form className="panel stack" style={{ gap: 22, maxWidth: 820 }} onSubmit={save}>
        <fieldset>
          <legend>How often the order closes and is placed</legend>
          <div className="choices">
            {PRESETS.map(([d, label]) => (
              <label key={d} className="choice">
                <input type="radio" name="freq" checked={!custom && days === d} onChange={() => { setCustom(false); setDays(d); }} />
                {label}
              </label>
            ))}
            <label className="choice">
              <input type="radio" name="freq" checked={custom} onChange={() => setCustom(true)} />
              Custom
            </label>
          </div>
          {custom && (
            <div className="row" style={{ marginTop: 12 }}>
              <span>Every</span>
              <input className="input sm" type="number" min={1} max={365} style={{ width: 90 }} value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
              <span>days</span>
            </div>
          )}
        </fieldset>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="close">This round (#{cycleId}) closes</label>
            <input id="close" className="input" type="datetime-local" required value={close} onChange={(e) => setClose(e.target.value)} />
            <span className="small muted">Later rounds keep this same day and time.</span>
          </div>
          <div className="field">
            <label htmlFor="pickup">Pickup opens (hours after close)</label>
            <input id="pickup" className="input" type="number" min={0} max={1440} value={pickup} onChange={(e) => setPickup(Math.max(0, Number(e.target.value) || 0))} />
            <span className="small muted">{pickup >= 24 ? `${Math.floor(pickup / 24)}d ${pickup % 24}h` : `${pickup}h`} after the order is placed</span>
          </div>
          <div className="field">
            <label htmlFor="tz">Time zone</label>
            <select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>
              {[...new Set([tz, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
            </select>
          </div>
        </div>

        <label className="choice" style={{ maxWidth: 520 }}>
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          <span>Pause ordering <span className="muted small">(students can still join the waitlist)</span></span>
        </label>

        {preview.length > 0 && (
          <div className="alert info small">
            <strong>Upcoming closes:</strong> {preview.map((p) => fmt(p, tz)).join("  →  ")}
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        <div className="row">
          <button className="btn accent" disabled={busy}>{busy ? "Saving…" : "Save schedule"}</button>
          {saved && <span className="badge good">Saved</span>}
        </div>
      </form>

      <div className="panel stack" style={{ maxWidth: 820, marginTop: 20 }}>
        <h3>Close this round now</h3>
        <p className="muted small">Locks round #{cycleId} immediately (for example, if you hit your group size early). The next round opens now and closes {days} day{days === 1 ? "" : "s"} from now.</p>
        {closeNow.error && <div className="alert error">{closeNow.error}</div>}
        <div><button className="btn danger" disabled={closeNow.busy} onClick={() => {
          if (confirm(`Close round #${cycleId} now? Students won’t be able to add to it anymore.`)) closeNow.run("POST", "/api/admin/cycle", { action: "close_now" });
        }}>{closeNow.busy ? "Closing…" : "Close round now"}</button></div>
      </div>
    </>
  );
}

/* ---------- universities & halls ---------- */

type UniRow = { id: number; name: string; pickup_location: string; active: number; halls: { id: number; name: string }[] };

export function CampusManager({ universities }: { universities: UniRow[] }) {
  const [name, setName] = useState("");
  const [pickup, setPickup] = useState("");
  const [halls, setHalls] = useState("");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addUni(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await api("POST", "/api/admin/universities", { name, pickup_location: pickup, sort: universities.length });
    if (r.ok) {
      const id = r.data?.id as number;
      const list = halls.split(/\n|,/).map((h) => h.trim()).filter(Boolean);
      for (let i = 0; i < list.length; i++) await api("POST", "/api/admin/halls", { university_id: id, name: list[i], sort: i });
      setName(""); setPickup(""); setHalls("");
      router.refresh();
    } else setError(r.error ?? "Error");
    setBusy(false);
  }

  return (
    <>
      <div className="admin-h"><h2>Universities & residence halls</h2></div>
      <p className="muted" style={{ marginBottom: 20 }}>These drive the checkout and waitlist forms. Every university automatically includes an <strong>Off-campus apartment</strong> option.</p>
      {universities.map((u) => <UniCard key={u.id} u={u} />)}
      <form className="panel stack" onSubmit={addUni} style={{ gap: 14 }}>
        <h3>Add a university</h3>
        <div className="form-grid">
          <div className="field"><label htmlFor="nu">Name</label><input id="nu" className="input" required value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="np">Pickup location</label><input id="np" className="input" placeholder="e.g. Student Union lobby" value={pickup} onChange={(e) => setPickup(e.target.value)} /></div>
        </div>
        <div className="field">
          <label htmlFor="nh">Residence halls <span className="muted">(one per line)</span></label>
          <textarea id="nh" rows={4} value={halls} onChange={(e) => setHalls(e.target.value)} placeholder={"North Hall\nSouth Hall"} />
        </div>
        {error && <div className="alert error">{error}</div>}
        <div><button className="btn accent" disabled={busy}>Add university</button></div>
      </form>
    </>
  );
}

function UniCard({ u }: { u: UniRow }) {
  const [name, setName] = useState(u.name);
  const [pickup, setPickup] = useState(u.pickup_location);
  const [hall, setHall] = useState("");
  const { busy, error, saved, run } = useAction();
  const dirty = name !== u.name || pickup !== u.pickup_location;

  return (
    <div className="panel uni-card stack" style={{ gap: 14, opacity: u.active ? 1 : 0.7 }}>
      <div className="form-grid">
        <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Pickup location</label><input className="input" value={pickup} onChange={(e) => setPickup(e.target.value)} /></div>
      </div>
      <div>
        <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>Residence options</div>
        <div className="chips">
          {u.halls.map((h) => (
            <span className="chip" key={h.id}>{h.name}
              <button aria-label={`Remove ${h.name}`} onClick={() => confirm(`Remove ${h.name}?`) && run("DELETE", "/api/admin/halls", { id: h.id })}>×</button>
            </span>
          ))}
          <span className="chip fixed">Off-campus apartment</span>
        </div>
        <form className="row" style={{ marginTop: 10 }} onSubmit={async (e) => {
          e.preventDefault();
          if (hall.trim() && (await run("POST", "/api/admin/halls", { university_id: u.id, name: hall, sort: u.halls.length }))) setHall("");
        }}>
          <input className="input sm" style={{ maxWidth: 260 }} placeholder="Add a residence hall" value={hall} onChange={(e) => setHall(e.target.value)} />
          <button className="btn sm ghost" disabled={busy || !hall.trim()}>Add hall</button>
        </form>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <button className="btn sm" disabled={!dirty || busy} onClick={() => run("PATCH", "/api/admin/universities", { id: u.id, name, pickup_location: pickup })}>Save</button>
        {saved && <span className="badge good">Saved</span>}
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => run("PATCH", "/api/admin/universities", { id: u.id, active: !u.active })}>
          {u.active ? "Hide from students" : "Show to students"}
        </button>
        <button className="btn sm danger" onClick={() => confirm(`Delete ${u.name} and its halls?`) && run("DELETE", "/api/admin/universities", { id: u.id })}>Delete</button>
      </div>
    </div>
  );
}

/* ---------- products ---------- */

type ProductRow = {
  id: number; name: string; description: string; tag: string; image_url: string; price_cents: number | null;
  retail_cents: number | null; min_group: number; active: number; sort: number;
};

export function ProductManager({ products }: { products: ProductRow[] }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <div className="admin-h">
        <h2>Products</h2>
        <span className="muted small">Leave the price empty to show “TBD” (students can’t order it yet).</span>
        <div className="spacer" />
        <button className="btn sm accent" disabled={busy} onClick={() => run("POST", "/api/admin/products", { name: "New product", min_group: 10, active: 0, sort: products.length })}>
          + Add product
        </button>
      </div>
      {error && <div className="alert error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="stack">{products.map((p) => <ProductEditor key={p.id} p={p} />)}</div>
    </>
  );
}

function ProductEditor({ p }: { p: ProductRow }) {
  const init = { name: p.name, description: p.description, tag: p.tag, image_url: p.image_url, price_cents: dollars(p.price_cents), retail_cents: dollars(p.retail_cents), min_group: String(p.min_group), sort: String(p.sort) };
  const [f, setF] = useState(init);
  const { busy, error, saved, run } = useAction();
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="panel" style={{ padding: 16, opacity: p.active ? 1 : 0.75 }}>
      <div className="row" style={{ alignItems: "flex-start", gap: 16, flexWrap: "nowrap" }}>
        <div style={{ width: 72, height: 72, borderRadius: 12, overflow: "hidden", background: "var(--accent-soft)", flexShrink: 0 }}>
          {f.image_url && <img src={f.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <div className="form-grid" style={{ flex: 1, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          <div className="field"><label className="small">Name</label><input className="input sm" value={f.name} onChange={set("name")} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label className="small">Description</label><input className="input sm" value={f.description} onChange={set("description")} /></div>
          <div className="field"><label className="small">Price ($)</label><input className="input sm" inputMode="decimal" placeholder="TBD" value={f.price_cents} onChange={set("price_cents")} /></div>
          <div className="field"><label className="small">Retail price ($)</label><input className="input sm" inputMode="decimal" placeholder="optional" value={f.retail_cents} onChange={set("retail_cents")} /></div>
          <div className="field"><label className="small">Students to unlock</label><input className="input sm" type="number" min={1} value={f.min_group} onChange={set("min_group")} /></div>
          <div className="field"><label className="small">Label</label><input className="input sm" value={f.tag} onChange={set("tag")} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label className="small">Image URL</label><input className="input sm" value={f.image_url} onChange={set("image_url")} /></div>
          <div className="field"><label className="small">Sort order</label><input className="input sm" type="number" min={0} value={f.sort} onChange={set("sort")} /></div>
        </div>
      </div>
      {error && <div className="alert error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn sm" disabled={!dirty || busy} onClick={() => run("PATCH", "/api/admin/products", { id: p.id, ...f })}>{busy ? "Saving…" : "Save"}</button>
        {saved && <span className="badge good">Saved</span>}
        {!p.active && <span className="badge neutral">Hidden</span>}
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => run("PATCH", "/api/admin/products", { id: p.id, active: !p.active })}>{p.active ? "Hide" : "Show on site"}</button>
        <button className="btn sm danger" onClick={() => confirm(`Delete ${p.name}?`) && run("DELETE", "/api/admin/products", { id: p.id })}>Delete</button>
      </div>
    </div>
  );
}

/* ---------- individual store ---------- */

type StoreRow = { id: number; name: string; description: string; image_url: string; price_cents: number; stock: number; active: number };

export function StoreManager({ items }: { items: StoreRow[] }) {
  const [f, setF] = useState({ name: "", price_cents: "", stock: "1", description: "", image_url: "" });
  const { busy, error, run } = useAction();
  return (
    <>
      <div className="admin-h"><h2>Individual store inventory</h2><span className="muted small">Extras from wholesale buys, sold one at a time.</span></div>
      {items.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead><tr><th>Item</th><th className="num">Price</th><th className="num">Stock</th><th>Visible</th><th /></tr></thead>
            <tbody>{items.map((it) => <StoreRowEditor key={it.id} it={it} />)}</tbody>
          </table>
        </div>
      )}
      <form className="panel stack" style={{ gap: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        if (await run("POST", "/api/admin/store", { ...f, stock: Number(f.stock), active: true })) setF({ name: "", price_cents: "", stock: "1", description: "", image_url: "" });
      }}>
        <h3>Add item to the shelf</h3>
        <div className="form-grid">
          <div className="field"><label>Name</label><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label>Price ($)</label><input className="input" required inputMode="decimal" value={f.price_cents} onChange={(e) => setF({ ...f, price_cents: e.target.value })} /></div>
          <div className="field"><label>Stock</label><input className="input" type="number" min={0} required value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></div>
          <div className="field"><label>Description</label><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="field"><label>Image URL</label><input className="input" value={f.image_url} onChange={(e) => setF({ ...f, image_url: e.target.value })} /></div>
        </div>
        {error && <div className="alert error">{error}</div>}
        <div><button className="btn accent" disabled={busy}>Add item</button></div>
      </form>
    </>
  );
}

function StoreRowEditor({ it }: { it: StoreRow }) {
  const [price, setPrice] = useState(dollars(it.price_cents));
  const [stock, setStock] = useState(String(it.stock));
  const { busy, error, saved, run } = useAction();
  const dirty = price !== dollars(it.price_cents) || stock !== String(it.stock);
  return (
    <tr>
      <td><strong>{it.name}</strong>{it.description && <div className="small muted">{it.description}</div>}{error && <div className="small" style={{ color: "var(--bad)" }}>{error}</div>}</td>
      <td className="num"><input className="input sm" style={{ width: 90, textAlign: "right" }} value={price} onChange={(e) => setPrice(e.target.value)} /></td>
      <td className="num"><input className="input sm" type="number" min={0} style={{ width: 80, textAlign: "right" }} value={stock} onChange={(e) => setStock(e.target.value)} /></td>
      <td><button className="btn sm ghost" onClick={() => run("PATCH", "/api/admin/store", { id: it.id, active: !it.active })}>{it.active ? "Visible" : "Hidden"}</button></td>
      <td className="num" style={{ whiteSpace: "nowrap" }}>
        {saved && <span className="badge good" style={{ marginRight: 8 }}>Saved</span>}
        <button className="btn sm" disabled={!dirty || busy} onClick={() => run("PATCH", "/api/admin/store", { id: it.id, price_cents: price, stock: Number(stock) })}>Save</button>{" "}
        <button className="btn sm danger" onClick={() => confirm(`Delete ${it.name}?`) && run("DELETE", "/api/admin/store", { id: it.id })}>Delete</button>
      </td>
    </tr>
  );
}

/* ---------- small row actions ---------- */

export function OrderStatus({ id, status, paid }: { id: string; status: string; paid: boolean }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <select className="sm" style={{ width: "auto" }} value={status} disabled={busy || status === "cancelled"} onChange={(e) => {
        const v = e.target.value;
        if (v === "cancelled" && !confirm(paid ? `Cancel order ${id} and refund the card in full? The student gets an email.` : `Cancel order ${id}? The student gets an email.`)) return;
        run("PATCH", "/api/admin/orders", { id, status: v });
      }}>
        <option value="placed">Placed</option>
        <option value="picked_up">Picked up</option>
        <option value="cancelled">{paid ? "Cancelled + refunded" : "Cancelled"}</option>
      </select>
      {error && <div className="small" style={{ color: "var(--bad)" }}>{error}</div>}
    </>
  );
}

export function ReservationStatus({ id, status, paid }: { id: number; status: string; paid: boolean }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <select className="sm" style={{ width: "auto" }} value={status} disabled={busy || status === "cancelled"} onChange={(e) => {
        const v = e.target.value;
        if (v === "cancelled" && !confirm(paid ? "Cancel, restock, and refund the card in full?" : "Cancel and put the units back in stock?")) return;
        run("PATCH", "/api/admin/reservations", { id, status: v });
      }}>
        <option value="reserved">Reserved</option>
        <option value="picked_up">Picked up</option>
        <option value="cancelled">{paid ? "Cancelled (restock + refund)" : "Cancelled (restock)"}</option>
      </select>
      {error && <div className="small" style={{ color: "var(--bad)" }}>{error}</div>}
    </>
  );
}

/* ---------- payments & email ---------- */

export function IntegrationsPanel({ payments, webhook, email, from, adminEmail }: {
  payments: "live" | "test" | "off"; webhook: boolean; email: boolean; from: string; adminEmail: string;
}) {
  const [to, setTo] = useState(adminEmail);
  const [result, setResult] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  return (
    <>
      <div className="admin-h"><h2>Payments & email</h2></div>
      <div className="kpis">
        <div className="kpi">
          <div className="small muted">Online payments (Stripe)</div>
          <div style={{ marginTop: 8 }}>
            {payments === "off" ? <span className="badge neutral">Off: pay at pickup</span> : payments === "test" ? <span className="badge warn">Test mode</span> : <span className="badge good">Live</span>}
            {payments !== "off" && !webhook && <div className="small" style={{ color: "var(--bad)", marginTop: 6 }}>STRIPE_WEBHOOK_SECRET is missing</div>}
          </div>
        </div>
        <div className="kpi">
          <div className="small muted">Email (Resend)</div>
          <div style={{ marginTop: 8 }}>{email ? <span className="badge good">On</span> : <span className="badge neutral">Off: logged only</span>}</div>
          <div className="small muted" style={{ marginTop: 6, wordBreak: "break-all" }}>From: {from}</div>
        </div>
        <div className="kpi">
          <div className="small muted">New-order alerts</div>
          <div className="small" style={{ marginTop: 8 }}>{adminEmail || <span className="muted">Set ADMIN_EMAIL to get one per order</span>}</div>
        </div>
      </div>
      <form className="row" onSubmit={async (e) => {
        e.preventDefault(); setResult(null);
        if (await run("POST", "/api/admin/email", { action: "test", to })) setResult(email ? `Sent to ${to}` : "Email is off. The message was written to the server log instead.");
      }}>
        <input className="input sm" type="email" required placeholder="you@example.com" style={{ maxWidth: 280 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn sm ghost" disabled={busy}>Send test email</button>
        {result && <span className="small muted">{result}</span>}
        {error && <span className="small" style={{ color: "var(--bad)" }}>{error}</span>}
      </form>
    </>
  );
}

export function PickupReminder({ cycleId, count }: { cycleId: number; count: number }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const { busy, error, setError } = useAction();
  const [sending, setSending] = useState(false);
  if (count === 0) return null;
  return (
    <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
      {!open ? (
        <div className="row">
          <span>Email pickup details to the <strong>{count}</strong> student{count === 1 ? "" : "s"} with orders in this round.</span>
          <div className="spacer" />
          <button className="btn sm" onClick={() => setOpen(true)}>Write pickup email</button>
        </div>
      ) : (
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault();
          if (!confirm(`Send pickup details to ${count} student${count === 1 ? "" : "s"}?`)) return;
          setSending(true); setError(null);
          const r = await api("POST", "/api/admin/email", { action: "pickup_reminder", cycle: cycleId, note });
          setSending(false);
          if (!r.ok) setError(r.error ?? "Failed");
          else setResult(`Sent ${r.data?.sent} of ${r.data?.total}${r.data?.live ? "" : " (email is off, so they went to the server log)"}`);
        }}>
          <label htmlFor="note">Message (optional). Each email also includes the pickup time, place and the student’s items.</label>
          <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Pickup is in the Rubin Hall lobby, 7–10 PM. Bring your order number." />
          {error && <div className="alert error">{error}</div>}
          {result && <div className="alert ok">{result}</div>}
          <div className="row">
            <button className="btn accent sm" disabled={busy || sending}>{sending ? "Sending…" : "Send pickup email"}</button>
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Close</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function DeleteWaitlist({ id }: { id: number }) {
  const { busy, run } = useAction();
  return <button className="btn sm ghost" disabled={busy} onClick={() => confirm("Remove this signup?") && run("DELETE", "/api/admin/waitlist", { id })}>Remove</button>;
}

export function CycleSelect({ value, options }: { value: number; options: { id: number; label: string }[] }) {
  const router = useRouter();
  return (
    <select className="sm" style={{ width: "auto", maxWidth: "100%" }} value={value} onChange={(e) => router.push(`/admin?tab=orders&cycle=${e.target.value}`)}>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}
