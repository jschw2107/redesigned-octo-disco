"use client";

import { money, useCart } from "./CartProvider";
import type { Uni } from "./LocationPicker";

type P = {
  id: number; name: string; description: string; tag: string; image_url: string;
  price_cents: number | null; retail_cents: number | null; min_group: number;
};
type Progress = { product_id: number; university_id: number; students: number };

export function ProductGrid({ products, progress, universities, paused }: {
  products: P[]; progress: Progress[]; universities: Uni[]; paused: boolean;
}) {
  const { add, lines, setQty, setOpen, campus, setCampus } = useCart();
  const selected = universities.find((u) => u.id === campus) ?? (universities.length === 1 ? universities[0] : undefined);

  return (
    <>
      {universities.length === 1 && (
        <div className="toolbar">
          <span className="badge">{universities[0].name}</span>
          <span className="small muted">Each deal unlocks when enough students join this round. Progress updates as orders come in.</span>
        </div>
      )}
      {universities.length > 1 && (
        <div className="toolbar">
          <label htmlFor="campus" style={{ fontWeight: 600 }}>Your campus</label>
          <select id="campus" className="sm" style={{ width: "auto", minWidth: 220 }} value={selected?.id ?? ""}
            onChange={(e) => setCampus(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Choose to see group progress…</option>
            {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <span className="small muted">Each deal unlocks when enough students at your school join this round.</span>
        </div>
      )}

      <div className="grid">
        {products.map((p) => {
          const inCart = lines.find((l) => l.product_id === p.id);
          const joined = selected ? progress.find((x) => x.product_id === p.id && x.university_id === selected.id)?.students ?? 0 : null;
          const pct = joined == null ? 0 : Math.min(100, Math.round((joined / Math.max(1, p.min_group)) * 100));
          const unlocked = joined != null && joined >= p.min_group;
          const save = p.price_cents != null && p.retail_cents ? Math.round((1 - p.price_cents / p.retail_cents) * 100) : null;
          const orderable = p.price_cents != null && !paused;

          return (
            <article className="card" key={p.id}>
              <div className="card-img">
                {p.image_url ? <img src={p.image_url} alt={p.name} loading="lazy" /> : <span className="ph">{p.name[0]}</span>}
              </div>
              <div className="card-body">
                <div className="tag">{save && save > 0 ? `Save ${save}% · ${p.tag || "Group deal"}` : p.tag}</div>
                <h3>{p.name}</h3>
                <p className="small muted">{p.description}</p>
                <div className="price">
                  {p.price_cents != null ? <strong>{money(p.price_cents)}</strong> : <strong>TBD</strong>}
                  {p.retail_cents != null && <s>{money(p.retail_cents)} retail</s>}
                  {p.price_cents == null && <span className="small muted">Pricing at launch</span>}
                </div>
                <div className="card-foot">
                  {p.price_cents != null && joined != null && (
                    <div className="stack" style={{ gap: 6 }}>
                      <div className="row small" style={{ gap: 6 }}>
                        {unlocked ? <span className="badge good">Deal unlocked</span> : <span>{joined} of {p.min_group} students joined</span>}
                      </div>
                      <div className={`progress ${unlocked ? "done" : ""}`}><span style={{ width: `${pct}%` }} /></div>
                    </div>
                  )}
                  {!orderable ? (
                    <a className="btn ghost block" href="#waitlist">Get notified at launch</a>
                  ) : inCart ? (
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div className="stepper">
                        <button onClick={() => setQty(p.id, inCart.qty - 1)} aria-label={`Remove one ${p.name}`}>−</button>
                        <span>{inCart.qty}</span>
                        <button onClick={() => setQty(p.id, inCart.qty + 1)} aria-label={`Add one ${p.name}`}>+</button>
                      </div>
                      <button className="linkbtn small" onClick={() => setOpen(true)}>View cart</button>
                    </div>
                  ) : (
                    <button className="btn block" onClick={() => add({ product_id: p.id, name: p.name, price_cents: p.price_cents!, image_url: p.image_url })}>
                      Add to group order
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
