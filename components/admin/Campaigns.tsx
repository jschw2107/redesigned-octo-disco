"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, useAction } from "./AdminClient";
import { isoToLocalInput, localInputToIso } from "@/lib/tz";

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: c % 100 ? 2 : 0 });
const dollars = (c: number | null | undefined) => (c == null ? "" : String(c % 100 ? (c / 100).toFixed(2) : c / 100));

export type CampaignRow = {
  id: number; number: number; title: string; summary: string; description: string; category: string; emoji: string; image_url: string;
  unit: string; normal_cents: number; target_cents: number; price_options: string; tiers: string; goal: number; max_per_buyer: number;
  fee_cents: number; deadline: string; status: string; final_cents: number | null; deal_note: string; sort: number;
};

/* ---------- create ---------- */
export function NewCampaignButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn sm accent" disabled={busy} onClick={async () => {
      setBusy(true);
      const r = await api("POST", "/api/admin/campaigns", {});
      setBusy(false);
      if (r.ok) router.push(`/admin?tab=groupbuys&id=${r.data?.id}`);
      else alert(r.error);
    }}>+ New GroupBuy</button>
  );
}

/* ---------- edit ---------- */
export function CampaignEditor({ c, tz }: { c: CampaignRow; tz: string }) {
  const opts = (() => { try { return (JSON.parse(c.price_options) as number[]).map((x) => dollars(x)).join(", "); } catch { return ""; } })();
  const tiers = (() => { try { return (JSON.parse(c.tiers) as { units: number; cents: number }[]).map((t) => `${t.units} = ${dollars(t.cents)}`).join("\n"); } catch { return ""; } })();
  const init = {
    title: c.title, summary: c.summary, description: c.description, category: c.category, emoji: c.emoji, image_url: c.image_url, unit: c.unit,
    normal: dollars(c.normal_cents), target: dollars(c.target_cents), options: opts, tiers, goal: String(c.goal), max_per_buyer: String(c.max_per_buyer),
    deadline: isoToLocalInput(c.deadline, tz), sort: String(c.sort),
  };
  const [f, setF] = useState(init);
  const { busy, error, saved, run } = useAction();
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const locked = c.status === "deal" || c.status === "closed";

  return (
    <form className="panel stack" style={{ gap: 16 }} onSubmit={(e) => {
      e.preventDefault();
      run("PATCH", "/api/admin/campaigns", { id: c.id, ...f, deadline: localInputToIso(f.deadline, tz) });
    }}>
      <div className="row"><h3>Details</h3>{locked && <span className="badge warn">Deal locked: editing prices won’t change it</span>}</div>
      <div className="form-grid">
        <div className="field" style={{ gridColumn: "span 2" }}><label>Title</label><input className="input" value={f.title} onChange={set("title")} /></div>
        <div className="field"><label>Emoji</label><input className="input" value={f.emoji} onChange={set("emoji")} maxLength={8} /></div>
        <div className="field"><label>Category</label><input className="input" value={f.category} onChange={set("category")} placeholder="Electronics" /></div>
        <div className="field" style={{ gridColumn: "span 2" }}><label>One-line summary</label><input className="input" value={f.summary} onChange={set("summary")} /></div>
        <div className="field" style={{ gridColumn: "span 2" }}><label>Image URL <span className="muted">(optional, replaces emoji)</span></label><input className="input" value={f.image_url} onChange={set("image_url")} /></div>
      </div>
      <div className="field"><label>Description</label><textarea rows={3} value={f.description} onChange={set("description")} /></div>

      <h3>Pricing & goal</h3>
      <div className="form-grid">
        <div className="field"><label>Normal price ($)</label><input className="input" inputMode="decimal" value={f.normal} onChange={set("normal")} /></div>
        <div className="field"><label>Starting target ($)</label><input className="input" inputMode="decimal" value={f.target} onChange={set("target")} /></div>
        <div className="field"><label>Buyers (units) needed for target</label><input className="input" type="number" min={1} value={f.goal} onChange={set("goal")} /></div>
        <div className="field"><label>Unit name</label><input className="input" value={f.unit} onChange={set("unit")} placeholder="case, pair, ticket" /></div>
        <div className="field"><label>Max units per buyer</label><input className="input" type="number" min={1} value={f.max_per_buyer} onChange={set("max_per_buyer")} /></div>
      </div>
      <div className="form-grid">
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>“I’ll buy at” price options ($, comma-separated)</label>
          <input className="input" value={f.options} onChange={set("options")} placeholder="199, 189, 179, 169" />
          <span className="small muted">Students pick one as their maximum. The starting target is always included.</span>
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>Indicative tiers (one per line: buyers = target $)</label>
          <textarea rows={3} value={f.tiers} onChange={set("tiers")} placeholder={"150 = 189\n300 = 179"} />
          <span className="small muted">Shown as 🔒 goals (“75 buyers → $185”). Not promises.</span>
        </div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Joining closes ({tz.replace("_", " ")})</label><input className="input" type="datetime-local" value={f.deadline} onChange={set("deadline")} /></div>
        <div className="field"><label>Sort order</label><input className="input" type="number" min={0} value={f.sort} onChange={set("sort")} /></div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="row"><button className="btn accent" disabled={!dirty || busy}>{busy ? "Saving…" : "Save"}</button>{saved && <span className="badge good">Saved</span>}</div>
    </form>
  );
}

/* ---------- status ---------- */
export function StatusControl({ id, status, isDeal }: { id: number; status: string; isDeal: boolean }) {
  const { busy, error, run } = useAction();
  const opts = isDeal ? ["deal", "closed", "cancelled"] : ["draft", "live", "negotiating", "closed", "cancelled"];
  const labels: Record<string, string> = { draft: "Draft (hidden)", live: "Live: taking commitments", negotiating: "Negotiating: joining closed", deal: "Deal locked", closed: "Closed", cancelled: "Cancelled" };
  return (
    <div className="row">
      <select className="sm" style={{ width: "auto" }} value={status} disabled={busy} onChange={(e) => {
        if (e.target.value === "deal") return;
        if (e.target.value === "cancelled" && !confirm("Cancel this GroupBuy? Every order in it is cancelled, paid ones are refunded in full, and everyone gets an email. It will be hidden from students.")) return;
        run("PATCH", "/api/admin/campaigns", { id, status: e.target.value });
      }}>
        {opts.map((o) => <option key={o} value={o} disabled={o === "deal"}>{labels[o]}</option>)}
      </select>
      {error && <span className="small" style={{ color: "var(--bad)" }}>{error}</span>}
    </div>
  );
}

export function DeleteCampaign({ id }: { id: number }) {
  const router = useRouter();
  return <button className="btn sm danger" onClick={async () => {
    if (!confirm("Delete this GroupBuy?")) return;
    const r = await api("DELETE", "/api/admin/campaigns", { id });
    if (r.ok) router.push("/admin?tab=groupbuys"); else alert(r.error);
  }}>Delete</button>;
}

/* ---------- deal ---------- */
export function DealPanel({ id, normalCents, unit, curve, tz }: {
  id: number; normalCents: number; unit: string; curve: { price: number; buyers: number; units: number; value: number }[]; tz: string;
}) {
  const [price, setPrice] = useState(curve.length ? dollars(curve[0].price) : "");
  const [cap, setCap] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [markup, setMarkup] = useState("10");
  const [payBy, setPayBy] = useState(() => isoToLocalInput(new Date(Date.now() + 3 * 86400000).toISOString(), tz));
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ buyers: number; units: number; value: number; left: number; savings: number; fees: number; charged: number;
    bought: number; extraUnits: number; extraUnit: number; sellerCost: number; extrasValue: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const { busy, error, run, setError } = useAction();

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!price) return setPreview(null);
      const q = `id=${id}&price=${encodeURIComponent(price)}&cap=${encodeURIComponent(cap)}&min=${encodeURIComponent(minOrder)}&markup=${encodeURIComponent(markup)}`;
      const r = await api("GET", `/api/admin/campaigns/deal?${q}`);
      setPreview(r.ok ? (r.data as never) : null);
    }, 250);
    return () => clearTimeout(t);
  }, [price, cap, minOrder, markup, id]);

  return (
    <div className="panel stack" style={{ gap: 14 }}>
      <h3>Lock in a seller’s price</h3>
      <p className="small muted">Enter the price a seller agreed to. Everyone whose maximum is at or above it gets the deal at that one price (earliest first if you cap units), and <strong>their saved cards are charged automatically</strong>. Anyone whose card fails gets a payment link. Everyone else is told they weren’t charged.</p>
      <div className="form-grid">
        <div className="field"><label>Seller’s price per {unit} ($)</label><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div className="field"><label>Max units the seller can supply <span className="muted">(optional)</span></label><input className="input" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} /></div>
        <div className="field"><label>Seller’s minimum order <span className="muted">(units, optional)</span></label><input className="input" type="number" min={1} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="e.g. 120" /></div>
        <div className="field"><label>Markup on extra units (%)</label><input className="input" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} /></div>
        <div className="field"><label>Payment-link deadline <span className="muted">(only if a card fails)</span></label><input className="input" type="datetime-local" value={payBy} onChange={(e) => setPayBy(e.target.value)} /></div>
      </div>
      <div className="field"><label>Message to buyers <span className="muted">(pickup/delivery details, shown in emails and to extras buyers)</span></label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pickup Thursday 7–9 PM in the Rubin Hall lobby." /></div>
      {preview && (
        <div className="alert info">
          At {usd(Math.round(Number(price) * 100))}: <strong>{preview.buyers}</strong> buyers · <strong>{preview.units}</strong> {unit}s ·
          {" "}<strong>{usd(preview.value)}</strong> to the seller + <strong>{usd(preview.fees)}</strong> GroupBuy fees = <strong>{usd(preview.charged)}</strong> charged.
          {" "}Students save {usd(preview.savings - preview.fees)} net vs normal ({usd(normalCents)}). {preview.left > 0 && `${preview.left} won’t be included.`}
        </div>
      )}
      {preview && preview.extraUnits > 0 && (
        <div className="alert warn">
          The seller requires <strong>{preview.bought}</strong> {unit}s but the group is buying <strong>{preview.units}</strong>. You’ll buy
          {" "}<strong>{preview.extraUnits} extra</strong> ({usd(preview.extraUnits * Math.round(Number(price) * 100))} at the seller’s price) and they’ll go on sale on the site at
          {" "}<strong>{usd(preview.extraUnit)}</strong> each (the group’s all-in price + {markup || 0}% markup), up to {usd(preview.extrasValue)} if they all sell.
          {" "}Total owed to the seller: <strong>{usd(preview.sellerCost)}</strong>.
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      {result && <div className="alert ok">{result}</div>}
      <div><button className="btn accent" disabled={busy || !preview || preview.buyers === 0} onClick={async () => {
        setError(null);
        const iso = localInputToIso(payBy, tz);
        const extra = preview && preview.extraUnits > 0 ? `\n\nYou're also buying ${preview.extraUnits} extra ${unit}s, which go on sale at ${usd(preview.extraUnit)} each.` : "";
        if (!confirm(`Lock in ${usd(Math.round(Number(price) * 100))} and CHARGE ${preview?.buyers} buyers' saved cards (${usd(preview?.charged ?? 0)} total, incl. ${usd(preview?.fees ?? 0)} GroupBuy fees)?${extra}\n\nThis can't be undone.`)) return;
        const r = await api("POST", "/api/admin/campaigns/deal", { id, price, cap, pay_by: iso, note, min: minOrder, markup });
        if (!r.ok) return setError(r.error ?? "Failed");
        setResult(`Done: charged ${r.data?.charged ?? 0} cards automatically${r.data?.failed ? `, ${r.data.failed} failed (sent a payment link)` : ""}; ${(Number(r.data?.won ?? 0) - Number(r.data?.charged ?? 0) - Number(r.data?.failed ?? 0)) || 0} without a card were emailed a payment link; ${r.data?.missed ?? 0} above the price were told they weren’t charged.`);
        await run("PATCH", "/api/admin/campaigns", { id, deal_note: note }); // refreshes the page
      }}>Lock in deal & email buyers</button></div>
    </div>
  );
}

/* ---------- row actions ---------- */
export function CancelCommitment({ id, paid, restock = false }: { id: number; paid: boolean; restock?: boolean }) {
  const { busy, error, run } = useAction();
  const extra = restock ? " Their units go back on the In stock page." : "";
  return (
    <>
      <button className="btn sm ghost" disabled={busy} onClick={() => {
        if (confirm((paid ? "Cancel this order, refund the card in full, and email the buyer?" : "Cancel this buyer’s order? They’ll get an email letting them know.") + extra)) run("PATCH", "/api/admin/commitments", { id, action: "cancel" });
      }}>{paid ? "Cancel + refund" : "Cancel"}</button>
      {error && <div className="small" style={{ color: "var(--bad)" }}>{error}</div>}
    </>
  );
}

export function RequestActions({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <div className="row" style={{ gap: 6 }}>
      {status !== "approved" && status !== "converted" && <button className="btn sm" disabled={busy} onClick={() => run("PATCH", "/api/admin/requests", { id, action: "approve" })}>Approve</button>}
      {status === "approved" && <button className="btn sm ghost" disabled={busy} onClick={() => run("PATCH", "/api/admin/requests", { id, action: "pending" })}>Unpublish</button>}
      {status !== "converted" && <button className="btn sm accent" disabled={busy} onClick={async () => {
        const r = await api("PATCH", "/api/admin/requests", { id, action: "convert" });
        if (r.ok) router.push(`/admin?tab=groupbuys&id=${r.data?.campaign_id}`); else alert(r.error);
      }}>Turn into GroupBuy</button>}
      {status !== "rejected" && status !== "converted" && <button className="btn sm ghost" disabled={busy} onClick={() => run("PATCH", "/api/admin/requests", { id, action: "reject" })}>Reject</button>}
      {error && <span className="small" style={{ color: "var(--bad)" }}>{error}</span>}
    </div>
  );
}

export function AnnounceButton({ id, count }: { id: number; count: number }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="row" style={{ gap: 8 }}>
      <button className="btn sm ghost" disabled={busy || count === 0} onClick={async () => {
        if (!confirm(`Email ${count} people on the alerts list about this GroupBuy?`)) return;
        setBusy(true);
        const r = await api("POST", "/api/admin/email", { action: "announce", campaign_id: id });
        setBusy(false);
        setMsg(r.ok ? `Sent ${r.data?.sent}/${r.data?.total}${r.data?.live ? "" : " (email off: logged only)"}` : r.error ?? "Failed");
      }}>📣 Email alerts list ({count})</button>
      {msg && <span className="small muted">{msg}</span>}
    </span>
  );
}

export function CopyText({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button className="btn sm ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch {} }}>{ok ? "Copied" : "Copy"}</button>;
}

export function SettingsForm({ domains, feePct }: { domains: string; feePct: string }) {
  const [d, setD] = useState(domains);
  const [fee, setFee] = useState(feePct);
  const { busy, error, saved, run } = useAction();
  return (
    <form className="panel stack" style={{ gap: 12, maxWidth: 720 }} onSubmit={(e) => { e.preventDefault(); run("PATCH", "/api/admin/settings", { email_domains: d, fee_pct: fee }); }}>
      <h3>GroupBuy fee</h3>
      <div className="field">
        <label>Share of each buyer’s savings GroupBuy keeps (%)</label>
        <input className="input" inputMode="decimal" style={{ maxWidth: 140 }} value={fee} onChange={(e) => setFee(e.target.value)} />
        <span className="small muted">Savings = normal price − deal price. Charged with each order. Changes apply to new commitments only: everyone keeps the rate they agreed to when joining.</span>
      </div>
      <h3>Who can join</h3>
      <div className="field">
        <label>Only allow these email domains <span className="muted">(comma-separated; empty = anyone)</span></label>
        <input className="input" value={d} onChange={(e) => setD(e.target.value)} placeholder="mail.yu.edu, yu.edu" />
        <span className="small muted">Requiring school emails makes your demand numbers “verified students”, which is more convincing to sellers.</span>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="row"><button className="btn accent" disabled={busy || (d === domains && fee === feePct)}>Save</button>{saved && <span className="badge good">Saved</span>}</div>
    </form>
  );
}

/* ---------- product picture ---------- */

/** Shrinks a photo in the browser (max 1200px, JPEG) so uploads are small and pages stay fast. */
async function resize(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  if (file.type === "image/gif") {
    // Keep animated GIFs as-is.
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
    return { dataUrl, width: 0, height: 0 };
  }
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); // transparent PNGs get a white background
  ctx.drawImage(bmp, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.86), width: w, height: h };
}

export function ImageUploader({ id, imageUrl, emoji }: { id: number; imageUrl: string; emoji: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Choose an image file (JPG, PNG, WebP or GIF).");
    setBusy(true); setErr(null);
    try {
      const { dataUrl, width, height } = await resize(file);
      const r = await api("POST", "/api/admin/images", { campaign_id: id, data_url: dataUrl, width, height });
      if (!r.ok) setErr(r.error ?? "Upload failed");
      else router.refresh();
    } catch {
      setErr("Couldn’t read that image. Try a JPG or PNG.");
    }
    setBusy(false);
  }

  return (
    <div className="panel stack" style={{ gap: 12 }}>
      <h3>Product picture</h3>
      <label
        className={`img-drop ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}
      >
        {imageUrl ? <img src={imageUrl} alt="Product" /> : <span className="img-emoji" aria-hidden>{emoji || "🛍️"}</span>}
        <span className="img-hint">{busy ? "Uploading…" : imageUrl ? "Click or drop a new picture to replace" : "Click or drop a picture here"}</span>
        <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      <p className="small muted">Shown on the GroupBuy card, its page and Stripe’s checkout. Large photos are resized automatically. Without a picture, the emoji is used.</p>
      {err && <div className="alert error">{err}</div>}
      {imageUrl && (
        <div><button className="btn sm ghost" disabled={busy} onClick={async () => {
          if (!confirm("Remove this picture?")) return;
          setBusy(true); const r = await api("DELETE", "/api/admin/images", { campaign_id: id }); setBusy(false);
          if (r.ok) router.refresh(); else setErr(r.error ?? "Failed");
        }}>Remove picture</button></div>
      )}
    </div>
  );
}

/* ---------- order updates ---------- */
export function UpdateComposer({ id, counts, labels }: { id: number; counts: Record<string, number>; labels: Record<string, string> }) {
  const router = useRouter();
  const first = Object.keys(labels).find((k) => counts[k] > 0) ?? "everyone";
  const [audience, setAudience] = useState(first);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const n = counts[audience] ?? 0;
  return (
    <form className="panel stack" style={{ gap: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      if (!confirm(`Email this update to ${n} ${n === 1 ? "person" : "people"}?`)) return;
      setBusy(true); setMsg(null);
      const r = await api("POST", "/api/admin/updates", { campaign_id: id, audience, subject, body });
      setBusy(false);
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? "Failed" });
      setMsg({ ok: true, text: `Sent to ${r.data?.sent} of ${r.data?.total}${r.data?.live ? "" : " (email is off, so it was only logged)"}. It also shows on their order pages.` });
      setSubject(""); setBody(""); router.refresh();
    }}>
      <h3>✉️ Email an order update</h3>
      <div className="field">
        <label>Send to</label>
        <select value={audience} onChange={(e) => setAudience(e.target.value)}>
          {Object.entries(labels).map(([k, label]) => <option key={k} value={k}>{label} ({counts[k] ?? 0})</option>)}
        </select>
      </div>
      <div className="field"><label>Subject</label><input className="input" required maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Pickup moved to Thursday" /></div>
      <div className="field"><label>Message</label><textarea rows={4} required maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your order is in! Pickup is Thursday 7–9 PM in the Rubin Hall lobby. Bring your order email." /></div>
      <p className="small muted">Each person gets a personal email with a link to their order, and the update appears on their order page.</p>
      {msg && <div className={`alert ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
      <div><button className="btn accent" disabled={busy || n === 0}>{busy ? "Sending…" : `Send to ${n}`}</button></div>
    </form>
  );
}

/* ---------- extras management ---------- */
export function ExtrasManager({ id, units, priceCents, bought }: { id: number; units: number; priceCents: number | null; bought: number | null }) {
  const [u, setU] = useState(String(units));
  const [p, setP] = useState(priceCents ? (priceCents % 100 ? (priceCents / 100).toFixed(2) : String(priceCents / 100)) : "");
  const { busy, error, saved, run } = useAction();
  return (
    <div className="panel stack" style={{ gap: 12 }}>
      <div className="row"><h3>📦 Extra stock for sale</h3>{units > 0 && priceCents ? <span className="badge good">On sale</span> : <span className="badge neutral">Not on sale</span>}</div>
      <p className="small muted">{bought ? `You bought ${bought} from the seller. ` : ""}Leftover units are listed on the In stock page automatically, including units from orders you cancel after the deal. Change the count or price here or on the <a href="/admin?tab=stock">In stock tab</a>.</p>
      <div className="form-grid">
        <div className="field"><label>Units left to sell</label><input className="input" type="number" min={0} value={u} onChange={(e) => setU(e.target.value)} /></div>
        <div className="field"><label>Price per unit ($)</label><input className="input" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} /></div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <button className="btn sm accent" disabled={busy} onClick={() => run("PATCH", "/api/admin/extras", { campaign_id: id, units: u, price: p })}>Save</button>
        {units > 0 && <button className="btn sm ghost" disabled={busy} onClick={() => { if (confirm("Stop selling extras? (Sets units left to 0.)")) run("PATCH", "/api/admin/extras", { campaign_id: id, units: 0 }); }}>Stop selling</button>}
        {saved && <span className="badge good">Saved</span>}
      </div>
    </div>
  );
}

export function CancelExtraOrder({ id, paid }: { id: number; paid: boolean }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <button className="btn sm ghost" disabled={busy} onClick={() => {
        if (confirm(paid ? "Cancel this order, refund the card in full and email the buyer?" : "Cancel this order and email the buyer?")) run("PATCH", "/api/admin/extras", { order_id: id, action: "cancel" });
      }}>{paid ? "Cancel + refund" : "Cancel"}</button>
      {error && <div className="small" style={{ color: "var(--bad)" }}>{error}</div>}
    </>
  );
}

/* ---------- In stock tab ---------- */

/** One editable row on the admin In stock tab: units left and price per unit. */
export function StockRow({ id, units, priceCents, suggestedCents }: { id: number; units: number; priceCents: number | null; suggestedCents: number | null }) {
  const [u, setU] = useState(String(units));
  const [p, setP] = useState(dollars(priceCents ?? suggestedCents));
  const { busy, error, saved, run } = useAction();
  const changed = u !== String(units) || p !== dollars(priceCents ?? suggestedCents);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
        <input className="input" style={{ width: 80 }} type="number" min={0} aria-label="Units left" value={u} onChange={(e) => setU(e.target.value)} />
        <span className="small muted">at $</span>
        <input className="input" style={{ width: 96 }} inputMode="decimal" aria-label="Price per unit" value={p} onChange={(e) => setP(e.target.value)} />
        <button className={`btn sm ${changed ? "accent" : "ghost"}`} disabled={busy} onClick={() => run("PATCH", "/api/admin/extras", { campaign_id: id, units: u, price: p })}>Save</button>
        {units > 0 && (
          <button className="btn sm ghost" disabled={busy} title="Set units to 0"
            onClick={() => { if (confirm("Take this off the In stock page? (Sets units left to 0.)")) run("PATCH", "/api/admin/extras", { campaign_id: id, units: 0 }); }}>Remove</button>
        )}
        {saved && <span className="badge good">Saved</span>}
      </div>
      {error && <div className="small" style={{ color: "var(--bad)" }}>{error}</div>}
    </div>
  );
}

/** Put a product straight on the In stock page, without running a GroupBuy. */
export function NewStockForm() {
  const router = useRouter();
  const [f, setF] = useState({ title: "", emoji: "📦", unit: "item", normal: "", price: "", units: "", summary: "" });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="panel stack" style={{ gap: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      setState({ busy: true });
      const r = await api("POST", "/api/admin/stock", f);
      if (!r.ok) return setState({ busy: false, error: r.error });
      router.push(`/admin?tab=groupbuys&id=${r.data?.id}`);
    }}>
      <h3>+ Add a product to In stock</h3>
      <p className="small muted">For stock you have on hand that didn’t come from a GroupBuy. It goes on sale right away; you can add a photo and description next.</p>
      <div className="form-grid">
        <div className="field" style={{ gridColumn: "1 / -1" }}><label>Product name</label><input className="input" required value={f.title} onChange={set("title")} placeholder="e.g. Dorm mini fridge" /></div>
        <div className="field"><label>Emoji</label><input className="input" value={f.emoji} onChange={set("emoji")} /></div>
        <div className="field"><label>Unit name</label><input className="input" value={f.unit} onChange={set("unit")} placeholder="item, pair, case…" /></div>
        <div className="field"><label>Normal price ($)</label><input className="input" inputMode="decimal" value={f.normal} onChange={set("normal")} placeholder="optional" /></div>
        <div className="field"><label>Sale price ($)</label><input className="input" inputMode="decimal" required value={f.price} onChange={set("price")} /></div>
        <div className="field"><label>Units for sale</label><input className="input" type="number" min={1} required value={f.units} onChange={set("units")} /></div>
        <div className="field"><label>Short description</label><input className="input" value={f.summary} onChange={set("summary")} placeholder="optional" /></div>
      </div>
      {state.error && <div className="alert error">{state.error}</div>}
      <div className="row"><button className="btn accent" disabled={state.busy}>{state.busy ? "Adding…" : "Add to In stock"}</button></div>
    </form>
  );
}
