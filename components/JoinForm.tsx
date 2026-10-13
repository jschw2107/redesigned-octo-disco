"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocationPicker, emptyLocation, locationComplete, type Uni } from "./LocationPicker";
import { ShareBox } from "./ShareBox";
import { chargeConsent, feePerUnit, pct } from "@/lib/consent";

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: c % 100 ? 2 : 0 });

type Props = {
  campaign: number; title: string; unit: string; options: number[]; maxPerBuyer: number; feeBps: number;
  normalCents: number; universities: Uni[]; domains: string[]; nextTierText: string; cards: boolean;
};

export function JoinForm(p: Props) {
  const router = useRouter();
  const [maxCents, setMax] = useState(p.options[0]);
  const [qty, setQty] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loc, setLoc] = useState(() => emptyLocation(p.universities, null));
  const [ref, setRef] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [done, setDone] = useState<null | { status: string; shareUrl: string; token: string | null; message?: string }>(null);

  useEffect(() => {
    try { setRef(new URLSearchParams(window.location.search).get("ref")); } catch {}
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!locationComplete(loc)) return setState({ busy: false, error: "Choose your university and where you live." });
    setState({ busy: true });
    const res = await fetch("/api/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaign: p.campaign, max_cents: maxCents, qty, name, email, ref, ...loc }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) return setState({ busy: false, error: data?.error ?? "Couldn’t reach the server. Try again." });
    if (data?.status === "pending_card" && data.url) { window.location.href = data.url; return; } // save card with Stripe
    setDone(data);
    setState({ busy: false });
    router.refresh(); // update the live counts on the page
  }

  if (done) {
    return (
      <div className="panel stack" style={{ gap: 16 }}>
        {done.status === "pending" && (
          <>
            <h3>Check your inbox to confirm 📬</h3>
            <p className="muted">We sent a confirmation link to <strong>{email}</strong>. You’re counted once you click it, which is how sellers know our buyers are real.</p>
          </>
        )}
        {done.status === "active" && (
          <>
            <h3>You’re in 🎉</h3>
            <p className="muted">
              You’ll buy {qty} {p.unit}{qty > 1 ? "s" : ""} if we secure a price of <strong>{usd(maxCents)} or less</strong>, and you’ll pay the deal price, not your maximum. Nothing is charged now.
              {done.token && <> <a href={`/c/${done.token}`}>View or change your commitment</a>.</>}
            </p>
          </>
        )}
        {done.status === "already" && (<><h3>You’re already in</h3><p className="muted">{done.message}</p></>)}
        <ShareBox url={done.shareUrl} title={p.title} nextTierText={p.nextTierText} />
      </div>
    );
  }

  return (
    <form className="panel stack" style={{ gap: 18 }} onSubmit={submit}>
      <fieldset>
        <legend>I’ll buy at:</legend>
        <div className="choices" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
          {p.options.map((o, i) => (
            <label key={o} className="choice">
              <input type="radio" name="max" checked={maxCents === o} onChange={() => setMax(o)} />
              <span>{usd(o)} or less{i === 0 && <span className="muted small" style={{ display: "block", fontWeight: 400 }}>current target</span>}</span>
            </label>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Your price decides <strong>whether</strong> you’re in, not what you pay. If sellers go lower, everyone in the group pays that lower price.
        </p>
        {p.feeBps > 0 && (() => {
          const fee = feePerUnit(maxCents, p.normalCents, p.feeBps);
          const save = Math.max(0, p.normalCents - maxCents);
          return (
            <div className="fee-box small">
              <div className="row" style={{ gap: 6 }}><span>Deal at {usd(maxCents)}</span><div className="spacer" /><span>{usd(maxCents)}</span></div>
              <div className="row" style={{ gap: 6 }}><span className="muted">GroupBuy fee: {pct(p.feeBps)} of the {usd(save)} you save</span><div className="spacer" /><span className="muted">+{usd(fee)}</span></div>
              <div className="row" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 6 }}><strong>Most you’d pay{qty > 1 ? ` (×${qty})` : ""}</strong><div className="spacer" /><strong>{usd((maxCents + fee) * qty)}</strong></div>
              <div className="muted" style={{ marginTop: 4 }}>You keep {pct(10000 - p.feeBps)} of the savings: {usd((save - fee) * qty)} vs the {usd(p.normalCents)} normal price. A lower deal means you pay less.</div>
            </div>
          );
        })()}
      </fieldset>

      {p.maxPerBuyer > 1 && (
        <div className="row">
          <label>How many {p.unit}s?</label>
          <div className="stepper">
            <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Fewer">−</button>
            <span>{qty}</span>
            <button type="button" onClick={() => setQty(Math.min(p.maxPerBuyer, qty + 1))} aria-label="More">+</button>
          </div>
          <span className="small muted">max {p.maxPerBuyer}</span>
        </div>
      )}

      <div className="choices" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div className="field">
          <label htmlFor="j-name">Name</label>
          <input id="j-name" className="input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="j-email">{p.domains.length ? "School email" : "Email"}</label>
          <input id="j-email" className="input" type="email" required autoComplete="email"
            placeholder={p.domains.length ? `you@${p.domains[0]}` : "you@mail.yu.edu"} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <LocationPicker universities={p.universities} value={loc} onChange={setLoc} compact />

      {p.cards ? (
        <>
          <div className="alert info small">
            <strong>Nothing is charged now.</strong> Next you’ll save a card securely with Stripe. If GroupBuy secures a price of {usd(maxCents)} or less,
            your card is charged automatically at the group’s final price, even if that’s well below your maximum. If not, you’re never charged.
          </div>
          <label className="choice" style={{ alignItems: "flex-start", fontWeight: 400, fontSize: "0.88rem", lineHeight: 1.45 }}>
            <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 2 }} />
            <span>{chargeConsent({ title: p.title, unit: p.unit, normal_cents: p.normalCents }, maxCents, qty, p.feeBps)}</span>
          </label>
        </>
      ) : (
        <div className="alert info small">
          <strong>Nothing is charged now.</strong> By joining you agree to buy {qty > 1 ? `${qty} ${p.unit}s` : `this ${p.unit}`} if GroupBuy secures a price of {usd(maxCents)} or less{p.feeBps ? ` (plus GroupBuy’s ${pct(p.feeBps)} share of your savings)` : ""}. You’ll pay the group’s final price, never your maximum. We’ll email you a payment link if that happens. You can change or withdraw until joining closes.
        </div>
      )}
      {state.error && <div className="alert error" role="alert">{state.error}</div>}
      <button className="btn accent" disabled={state.busy}>{state.busy ? (p.cards ? "Opening secure card form…" : "Joining…") : p.cards ? `Join at ${usd(maxCents)} or less: save card` : `Join at ${usd(maxCents)} or less`}</button>
    </form>
  );
}
