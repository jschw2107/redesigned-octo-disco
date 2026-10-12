"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCart } from "./CartProvider";

/** Empties the cart once an order is confirmed (the cart is kept if the student backs out of payment). */
export function ClearCart() {
  const { clear, ready } = useCart();
  useEffect(() => { if (ready) clear(); }, [ready, clear]);
  return null;
}

/** While Stripe is still confirming a payment, re-check every few seconds. */
export function RefreshWhilePending({ seconds = 4, maxTries = 15 }: { seconds?: number; maxTries?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => { if (++n > maxTries) clearInterval(t); else router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds, maxTries]);
  return null;
}
