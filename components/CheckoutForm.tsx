"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { money, useCart } from "./CartProvider";
import { LocationPicker, emptyLocation, locationComplete, type Uni } from "./LocationPicker";

export function CheckoutForm({ universities, paused, online, cancelled }: { universities: Uni[]; paused: boolean; online: boolean; cancelled: boolean }) {
  const { lines, total, setQty, clear, ready, campus } = useCart();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loc, setLoc] = useState(() => emptyLocation(universities, null));
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  useEffect(() => {
    if (campus && universities.some((u) => u.id === campus)) setLoc((l) => (l.university_id === "" ? { ...l, university_id: campus } : l));
  }, [campus, universities]);

  if (!ready) return null;
  if (lines.length === 0) {
    return (
      <div className="empty">
        <h3>Your cart is empty</h3>
        <p className="muted" style={{ marginTop: 8 }}>Pick a few essentials first.</p>
        <Link className="btn" href="/#deals" style={{ marginTop: 18 }}>Browse the essentials</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!locationComplete(loc)) return setState({ busy: false, error: "Choose your university and residence hall (or off-campus apartment)." });
    setState({ busy: true });
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, phone, ...loc, items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })) }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok || !data?.id) return setState({ busy: false, error: data?.error ?? "Couldn’t reach the server. Try again." });
    if (data.url) {
      // Online payment: hand off to Stripe. The cart is kept until payment succeeds.
      window.location.href = data.url;
      return;
    }
    clear();
    router.push(`/order/${data.id}`);
  }

  return (
    <form className="split" onSubmit={submit}>
      <div className="stack" style={{ gap: 20 }}>
        <div className="panel stack" style={{ gap: 16 }}>
          <h3>Your details</h3>
          <div className="field">
            <label htmlFor="c-name">Full name</label>
            <input id="c-name" className="input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="choices" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <div className="field">
              <label htmlFor="c-email">Email</label>
              <input id="c-email" className="input" type="email" required autoComplete="email" placeholder="you@school.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-phone">Phone <span className="muted">(optional)</span></label>
              <input id="c-phone" className="input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="panel">
          <h3 style={{ marginBottom: 16 }}>Your campus</h3>
          {universities.length === 0 ? (
            <div className="alert warn">No universities are set up yet. Check back soon.</div>
          ) : (
            <LocationPicker universities={universities} value={loc} onChange={setLoc} />
          )}
        </div>
      </div>

      <aside className="panel stack" style={{ position: "sticky", top: 88 }}>
        <h3>Order summary</h3>
        <div>
          {lines.map((l) => (
            <div className="line" key={l.product_id}>
              {l.image_url ? <img src={l.image_url} alt="" /> : <div className="thumb" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{l.name}</div>
                <div className="row small muted" style={{ gap: 8 }}>
                  <div className="stepper" style={{ transform: "scale(.85)", transformOrigin: "left" }}>
                    <button type="button" onClick={() => setQty(l.product_id, l.qty - 1)} aria-label={`Remove one ${l.name}`}>−</button>
                    <span>{l.qty}</span>
                    <button type="button" onClick={() => setQty(l.product_id, l.qty + 1)} aria-label={`Add one ${l.name}`}>+</button>
                  </div>
                </div>
              </div>
              <strong>{money(l.price_cents * l.qty)}</strong>
            </div>
          ))}
        </div>
        <div className="row" style={{ fontSize: "1.1rem" }}><strong>Total</strong><div className="spacer" /><strong>{money(total)}</strong></div>
        {online ? (
          <div className="alert info small">You’ll pay securely by card on the next step (Stripe). Apple Pay and Google Pay work too where available.</div>
        ) : (
          <div className="alert info small">No payment now. You pay at pickup when your campus’s order arrives.</div>
        )}
        {cancelled && !state.error && <div className="alert warn small">Payment was cancelled and your card wasn’t charged. Your cart is still here.</div>}
        {paused && <div className="alert warn">Ordering is paused right now.</div>}
        {state.error && <div className="alert error" role="alert">{state.error}</div>}
        <button className="btn accent block" disabled={state.busy || paused || universities.length === 0}>
          {state.busy ? (online ? "Starting payment…" : "Placing order…") : online ? `Pay ${money(total)}` : "Place order"}
        </button>
      </aside>
    </form>
  );
}
