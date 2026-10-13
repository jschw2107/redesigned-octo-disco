"use client";

import { useState } from "react";

export function ShareBox({ url, title, nextTierText }: { url: string; title: string; nextTierText: string }) {
  const [copied, setCopied] = useState(false);
  const text = `I joined a GroupBuy for ${title}. ${nextTierText} Join here:`;
  async function share() {
    try {
      if (navigator.share) { await navigator.share({ title: `GroupBuy: ${title}`, text, url }); return; }
    } catch { return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }
  return (
    <div className="share-box">
      <div style={{ fontWeight: 650 }}>📣 {nextTierText}</div>
      <p className="small muted">More buyers means more bargaining power, and a better price for everyone. Share your link:</p>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input className="input sm" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Your share link" />
        <button type="button" className="btn sm" onClick={share}>{copied ? "Copied!" : "Share"}</button>
      </div>
      <div className="row small" style={{ gap: 14 }}>
        <a href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <a href={`sms:?&body=${encodeURIComponent(`${text} ${url}`)}`}>Text</a>
        <a href={`mailto:?subject=${encodeURIComponent(`GroupBuy: ${title}`)}&body=${encodeURIComponent(`${text} ${url}`)}`}>Email</a>
      </div>
    </div>
  );
}
