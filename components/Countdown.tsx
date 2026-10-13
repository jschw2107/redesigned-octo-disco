"use client";

import { useEffect, useState } from "react";

export function Countdown({ to, short = false }: { to: string; short?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (now == null) return null;
  const ms = Math.max(0, Date.parse(to) - now);
  if (ms === 0) return <>closed</>;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const txt = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return <>{short ? txt : `${txt} left`}</>;
}
