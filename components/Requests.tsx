"use client";

import { useState } from "react";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  return res?.ok ? { ok: true as const, data } : { ok: false as const, error: (data?.error as string) ?? "Couldn’t reach the server. Try again." };
}

export function RequestForm() {
  const [f, setF] = useState({ title: "", target: "", details: "", name: "", email: "" });
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: boolean }>({ busy: false });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (state.done) {
    return <div className="panel"><h3>Thanks! We’ll review it 🙌</h3><p className="muted" style={{ marginTop: 8 }}>If it’s a fit, it goes up for others to back, and we’ll email you when it becomes a live GroupBuy.</p></div>;
  }
  return (
    <form className="panel stack" style={{ gap: 14 }} onSubmit={async (e) => {
      e.preventDefault(); setState({ busy: true });
      const r = await post("/api/requests", f);
      setState(r.ok ? { busy: false, done: true } : { busy: false, error: r.error });
    }}>
      <div className="field">
        <label htmlFor="r-title">Who wants…</label>
        <input id="r-title" className="input" required maxLength={120} placeholder="AirPods, a 65-inch TV, gym membership, flights home…" value={f.title} onChange={set("title")} />
      </div>
      <div className="field">
        <label htmlFor="r-target">…if we can get it below <span className="muted">(optional, $)</span></label>
        <input id="r-target" className="input" inputMode="decimal" placeholder="100" value={f.target} onChange={set("target")} />
      </div>
      <div className="field">
        <label htmlFor="r-details">Details <span className="muted">(model, size, dates…)</span></label>
        <textarea id="r-details" rows={3} maxLength={600} value={f.details} onChange={set("details")} />
      </div>
      <div className="choices" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="field"><label htmlFor="r-name">Your name</label><input id="r-name" className="input" required value={f.name} onChange={set("name")} /></div>
        <div className="field"><label htmlFor="r-email">Email</label><input id="r-email" className="input" type="email" required value={f.email} onChange={set("email")} /></div>
      </div>
      {state.error && <div className="alert error">{state.error}</div>}
      <button className="btn accent" disabled={state.busy}>{state.busy ? "Sending…" : "Propose this GroupBuy"}</button>
    </form>
  );
}

export function VoteButton({ id, votes }: { id: number; votes: number }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [n, setN] = useState(votes);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (done) return <span className="badge good">✓ You’re in · {n} interested</span>;
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>👋 I’d join · {n}</button>;
  return (
    <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      const r = await post("/api/requests/vote", { request_id: id, email });
      if (r.ok) { setN(r.data.votes ?? n + 1); setDone(true); } else setErr(r.error);
    }}>
      <input className="input sm" type="email" required placeholder="your email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn sm accent">Count me in</button>
      {err && <span className="small" style={{ color: "var(--bad)" }}>{err}</span>}
    </form>
  );
}
