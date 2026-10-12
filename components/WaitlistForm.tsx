"use client";

import { useEffect, useState } from "react";
import { useCart } from "./CartProvider";
import { LocationPicker, emptyLocation, locationComplete, type Uni } from "./LocationPicker";

export function WaitlistForm({ universities }: { universities: Uni[] }) {
  const { campus } = useCart();
  const [email, setEmail] = useState("");
  const [loc, setLoc] = useState(() => emptyLocation(universities, campus));
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; msg?: string }>({ status: "idle" });
  // The saved campus loads after first render; pre-select it if the student hasn't chosen yet.
  useEffect(() => {
    if (campus && universities.some((u) => u.id === campus)) setLoc((l) => (l.university_id === "" ? { ...l, university_id: campus } : l));
  }, [campus, universities]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!locationComplete(loc)) return setState({ status: "error", msg: "Choose your university and where you live." });
    setState({ status: "busy" });
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, ...loc }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) return setState({ status: "error", msg: data?.error ?? "Couldn’t reach the server. Try again." });
    setState({ status: "done" });
  }

  if (state.status === "done") {
    return (
      <div className="panel">
        <h3>You’re on the list 🎉</h3>
        <p className="muted" style={{ marginTop: 8 }}>We’ll email {email} about launch and your campus’s first drop.</p>
      </div>
    );
  }

  return (
    <form className="panel stack" style={{ gap: 18 }} onSubmit={submit}>
      <div className="field">
        <label htmlFor="wl-email">Email address</label>
        <input id="wl-email" className="input" type="email" required autoComplete="email" placeholder="you@school.edu"
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <LocationPicker universities={universities} value={loc} onChange={setLoc} allowOther compact />
      {state.status === "error" && <div className="alert error" role="alert">{state.msg}</div>}
      <button className="btn accent" disabled={state.status === "busy"}>
        {state.status === "busy" ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}
