"use client";

import { useState } from "react";
import { LocationPicker, emptyLocation, locationComplete, type Uni } from "./LocationPicker";

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: c % 100 ? 2 : 0 });

/** "Buy now" for leftover units from a seller's minimum order. */
export function BuyExtras({ campaign, unit, priceCents, left, groupPriceCents, universities, online, stockOnly = false }: {
  campaign: number; unit: string; priceCents: number; left: number; groupPriceCents?: number; universities: Uni[]; online: boolean; stockOnly?: boolean;
}) {
  const max = Math.min(10, left);
  const [qty, setQty] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loc, setLoc] = useState(() => emptyLocation(universities, null));
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: string }>({ busy: false });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!locationComplete(loc)) return setState({ busy: false, error: "Choose your university and where you live." });
    setState({ busy: true });
    const res = await fetch("/api/extras/buy", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaign, qty, name, email, ...loc }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) return setState({ busy: false, error: data?.error ?? "Couldn’t reach the server. Try again." });
    if (data.url) { window.location.href = data.url; return; }
    window.location.href = `/x/${data.code}`;
  }

  return (
    <form id="buy-now" className="panel stack" style={{ gap: 16, scrollMarginTop: 88 }} onSubmit={submit}>
      <div className="row">
        <h3>Buy now: {usd(priceCents)} each</h3>
        <div className="spacer" />
        <span className={`badge ${left <= 5 ? "warn" : "good"}`}>{left} left</span>
      </div>
      <p className="small muted">
        {stockOnly
          ? <>In stock and ready for pickup. No waiting, no group needed: buy directly while they last.</>
          : <>The seller required a bigger order than the group needed, so we have a few extra {unit}s. No waiting, no group needed: buy them directly.
            {groupPriceCents ? <>{" "}(Group members paid {usd(groupPriceCents)}.)</> : null}</>}
      </p>
      <div className="row">
        <label>How many?</label>
        <div className="stepper">
          <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Fewer">−</button>
          <span>{qty}</span>
          <button type="button" onClick={() => setQty(Math.min(max, qty + 1))} aria-label="More">+</button>
        </div>
        <div className="spacer" />
        <strong>{usd(priceCents * qty)}</strong>
      </div>
      <div className="choices" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="field"><label htmlFor="x-name">Name</label><input id="x-name" className="input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="x-email">Email</label><input id="x-email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      </div>
      <LocationPicker universities={universities} value={loc} onChange={setLoc} compact />
      {state.error && <div className="alert error" role="alert">{state.error}</div>}
      <button className="btn accent" disabled={state.busy}>
        {state.busy ? "Opening secure checkout…" : online ? `Buy ${qty} for ${usd(priceCents * qty)}` : `Reserve ${qty}: pay at pickup`}
      </button>
    </form>
  );
}
