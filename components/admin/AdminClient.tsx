"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

/* ---------- helpers ---------- */

export async function api(method: string, path: string, body?: unknown): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { window.location.reload(); return { ok: false, error: "Signed out" }; }
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Request failed (${res.status})` };
  } catch {
    return { ok: false, error: "Couldn’t reach the server" };
  }
}

export function useAction() {
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
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <img src="/icon.svg" alt="GroupBuy" width={64} height={64} style={{ borderRadius: 16, margin: "0 auto 14px", boxShadow: "0 6px 20px rgba(108,71,255,.3)" }} />
          <h2 style={{ fontSize: "1.8rem" }}>GroupBuy</h2>
          <p className="muted small" style={{ marginTop: 4 }}>Admin dashboard</p>
        </div>
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

export function DeleteWaitlist({ id }: { id: number }) {
  const { busy, run } = useAction();
  return <button className="btn sm ghost" disabled={busy} onClick={() => confirm("Remove this signup?") && run("DELETE", "/api/admin/waitlist", { id })}>Remove</button>;
}

