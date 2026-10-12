"use client";

import { useState } from "react";
import { money, useCart } from "./CartProvider";
import { LocationPicker, emptyLocation, locationComplete, type Uni } from "./LocationPicker";

type Item = { id: number; name: string; description: string; image_url: string; price_cents: number; stock: number };

export function StoreSection({ items, universities, online }: { items: Item[]; universities: Uni[]; online: boolean }) {
  const [active, setActive] = useState<Item | null>(null);

  if (!items.length) {
    return (
      <div className="empty">
        <h3>The shelf is waiting for its first restock.</h3>
        <p className="muted" style={{ marginTop: 8 }}>No individual items are in stock yet. Join the campus waitlist to hear when extras become available.</p>
        <a className="btn ghost" href="#waitlist" style={{ marginTop: 18 }}>Join the waitlist</a>
      </div>
    );
  }

  return (
    <>
      <div className="grid">
        {items.map((it) => (
          <article className="card" key={it.id}>
            <div className="card-img">
              {it.image_url ? <img src={it.image_url} alt={it.name} loading="lazy" /> : <span className="ph">{it.name[0]}</span>}
            </div>
            <div className="card-body">
              <h3>{it.name}</h3>
              {it.description && <p className="small muted">{it.description}</p>}
              <div className="price"><strong>{money(it.price_cents)}</strong></div>
              <div className="card-foot">
                <span className={`badge ${it.stock <= 3 ? "warn" : "good"}`} style={{ alignSelf: "flex-start" }}>
                  {it.stock <= 3 ? `Only ${it.stock} left` : `${it.stock} in stock`}
                </span>
                <button className="btn block" onClick={() => setActive(it)}>Reserve for pickup</button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {active && <ReserveDialog item={active} universities={universities} online={online} onClose={() => setActive(null)} />}
    </>
  );
}

function ReserveDialog({ item, universities, online, onClose }: { item: Item; universities: Uni[]; online: boolean; onClose: () => void }) {
  const { campus } = useCart();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [qty, setQty] = useState(1);
  const [loc, setLoc] = useState(() => emptyLocation(universities, campus));
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; msg?: string }>({ status: "idle" });
  const max = Math.min(10, item.stock);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!locationComplete(loc)) return setState({ status: "error", msg: "Choose your university and where you live." });
    setState({ status: "busy" });
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ store_item_id: item.id, qty, name, email, ...loc }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) return setState({ status: "error", msg: data?.error ?? "Couldn’t reach the server. Try again." });
    if (data?.url) { window.location.href = data.url; return; }
    setState({ status: "done" });
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div role="dialog" aria-label={`Reserve ${item.name}`} className="panel"
        style={{ position: "fixed", zIndex: 51, left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "min(560px, calc(100% - 32px))", maxHeight: "calc(100vh - 40px)", overflowY: "auto" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <h3>Reserve {item.name}</h3>
          <div className="spacer" />
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {state.status === "done" ? (
          <div className="stack">
            <div className="alert ok">Reserved! {qty} × {item.name} is set aside for you. Pay {money(item.price_cents * qty)} at pickup. We emailed you the details.</div>
            <button className="btn" onClick={() => window.location.reload()}>Done</button>
          </div>
        ) : (
          <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
            <div className="choices" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="field">
                <label htmlFor="r-name">Name</label>
                <input id="r-name" className="input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="r-email">Email</label>
                <input id="r-email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="row">
              <label>Quantity</label>
              <div className="stepper">
                <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Fewer">−</button>
                <span>{qty}</span>
                <button type="button" onClick={() => setQty(Math.min(max, qty + 1))} aria-label="More">+</button>
              </div>
              <div className="spacer" />
              <strong>{money(item.price_cents * qty)}</strong>
            </div>
            <LocationPicker universities={universities} value={loc} onChange={setLoc} compact />
            {state.status === "error" && <div className="alert error" role="alert">{state.msg}</div>}
            <button className="btn accent" disabled={state.status === "busy"}>{state.status === "busy" ? "Reserving…" : online ? `Reserve and pay ${money(item.price_cents * qty)}` : "Reserve — pay at pickup"}</button>
          </form>
        )}
      </div>
    </>
  );
}
