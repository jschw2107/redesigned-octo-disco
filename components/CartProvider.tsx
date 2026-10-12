"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type CartLine = { product_id: number; name: string; price_cents: number; image_url: string; qty: number };

type Cart = {
  lines: CartLine[];
  count: number;
  total: number;
  ready: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  add: (l: Omit<CartLine, "qty">, qty?: number) => void;
  setQty: (id: number, qty: number) => void;
  clear: () => void;
  /** The campus a visitor picked, used to show group progress for their school. */
  campus: number | null;
  setCampus: (id: number | null) => void;
};

const Ctx = createContext<Cart | null>(null);
const KEY = "groupbuy.cart.v1";
const CAMPUS_KEY = "groupbuy.campus.v1";

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [campus, setCampusState] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setLines(load<CartLine[]>(KEY, []).filter((l) => l && l.qty > 0));
    setCampusState(load<number | null>(CAMPUS_KEY, null));
    setReady(true);
  }, []);
  useEffect(() => { if (ready) save(KEY, lines); }, [lines, ready]);

  const add = useCallback((l: Omit<CartLine, "qty">, qty = 1) => {
    setLines((prev) => {
      const ex = prev.find((p) => p.product_id === l.product_id);
      if (ex) return prev.map((p) => (p.product_id === l.product_id ? { ...p, ...l, qty: Math.min(20, p.qty + qty) } : p));
      return [...prev, { ...l, qty }];
    });
  }, []);
  const setQty = useCallback((id: number, qty: number) => {
    setLines((prev) => (qty <= 0 ? prev.filter((p) => p.product_id !== id) : prev.map((p) => (p.product_id === id ? { ...p, qty: Math.min(20, qty) } : p))));
  }, []);
  const clear = useCallback(() => setLines([]), []);
  const setCampus = useCallback((id: number | null) => { setCampusState(id); save(CAMPUS_KEY, id); }, []);

  const value = useMemo<Cart>(() => ({
    lines, ready, open, setOpen, add, setQty, clear, campus, setCampus,
    count: lines.reduce((s, l) => s + l.qty, 0),
    total: lines.reduce((s, l) => s + l.qty * l.price_cents, 0),
  }), [lines, ready, open, add, setQty, clear, campus, setCampus]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}

export const money = (c: number | null | undefined) => (c == null ? "TBD" : `$${(c / 100).toFixed(2)}`);
