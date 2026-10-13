"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: c % 100 ? 2 : 0 });

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  return res?.ok ? { ok: true as const, data } : { ok: false as const, error: (data?.error as string) ?? "Couldn’t reach the server. Try again." };
}

/** Change max price / quantity, withdraw, or rejoin, while the GroupBuy is open. */
export function CommitEditor({ token, options, maxCents, qty, maxPerBuyer, unit, withdrawn }: {
  token: string; options: number[]; maxCents: number; qty: number; maxPerBuyer: number; unit: string; withdrawn: boolean;
}) {
  const router = useRouter();
  const [m, setM] = useState(maxCents);
  const [q, setQ] = useState(qty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = m !== maxCents || q !== qty || withdrawn;

  async function save() {
    setBusy(true); setMsg(null);
    const r = await call("PATCH", `/api/commit/${token}`, { max_cents: m, qty: q });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: withdrawn ? "You’re back in." : "Saved." });
    router.refresh();
  }
  async function withdraw() {
    if (!confirm("Withdraw from this GroupBuy? You can rejoin until it closes.")) return;
    setBusy(true);
    const r = await call("DELETE", `/api/commit/${token}`);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    router.refresh();
  }

  return (
    <div className="panel stack" style={{ gap: 16 }}>
      <h3>{withdrawn ? "Rejoin" : "Change your commitment"}</h3>
      <fieldset>
        <legend>I’ll buy at:</legend>
        <div className="choices" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
          {options.map((o) => (
            <label key={o} className="choice">
              <input type="radio" name="max" checked={m === o} onChange={() => setM(o)} /> {usd(o)} or less
            </label>
          ))}
        </div>
      </fieldset>
      {maxPerBuyer > 1 && (
        <div className="row">
          <label>How many {unit}s?</label>
          <div className="stepper">
            <button type="button" onClick={() => setQ(Math.max(1, q - 1))} aria-label="Fewer">−</button>
            <span>{q}</span>
            <button type="button" onClick={() => setQ(Math.min(maxPerBuyer, q + 1))} aria-label="More">+</button>
          </div>
        </div>
      )}
      {msg && <div className={`alert ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
      <div className="row">
        <button className="btn accent" disabled={busy || !dirty} onClick={save}>{withdrawn ? "Rejoin" : "Save changes"}</button>
        {!withdrawn && <button className="btn ghost" disabled={busy} onClick={withdraw}>Withdraw</button>}
      </div>
    </div>
  );
}

export function PayButton({ token, label }: { token: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {err && <div className="alert error">{err}</div>}
      <button className="btn accent block" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await call("POST", `/api/commit/${token}/pay`);
        if (r.ok && r.data?.url) { window.location.href = r.data.url; return; }
        setBusy(false); setErr(r.ok ? "Couldn’t start payment." : r.error);
      }}>{busy ? "Opening secure checkout…" : label}</button>
    </div>
  );
}

/** While Stripe is still confirming a payment, re-check every few seconds. */
export function RefreshWhilePending({ seconds = 4, maxTries = 15 }: { seconds?: number; maxTries?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => { if (++n > maxTries) clearInterval(t); else router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds, maxTries]);
  return null;
}

/** Opens Stripe's secure form to add or replace the saved card. */
export function CardButton({ token, label, primary = false }: { token: string; label: string; primary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="stack" style={{ gap: 8 }}>
      <button className={`btn ${primary ? "accent" : "ghost sm"}`} disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await call("POST", `/api/commit/${token}/card`);
        if (r.ok && r.data?.url) { window.location.href = r.data.url; return; }
        setBusy(false); setErr(r.ok ? "Couldn’t open the card form." : r.error);
      }}>{busy ? "Opening…" : label}</button>
      {err && <span className="small" style={{ color: "var(--bad)" }}>{err}</span>}
    </span>
  );
}
