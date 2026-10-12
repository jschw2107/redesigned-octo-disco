"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { money, useCart } from "./CartProvider";

export function Logo() {
  return (
    <Link href="/" className="logo">
      <span className="logo-mark" aria-hidden>G</span>GroupBuy
    </Link>
  );
}

export function Header({ showNav = true }: { showNav?: boolean }) {
  const { count, setOpen, ready } = useCart();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <>
      <header className={`header ${scrolled ? "scrolled" : ""}`}>
        <div className="container header-inner">
          <Logo />
          {showNav && (
            <nav className="nav" aria-label="Main">
              <a href="/#deals">The essentials</a>
              <a href="/#individual-store">Individual store</a>
              <a href="/#how-it-works">How it works</a>
              <a href="/#waitlist">Join the waitlist</a>
            </nav>
          )}
          <div className="spacer" />
          <button className="btn sm cart-btn" onClick={() => setOpen(true)} aria-label={`Open cart, ${count} items`}>
            Cart {ready && count > 0 && <span className="cart-count">{count}</span>}
          </button>
        </div>
      </header>
      <CartDrawer />
    </>
  );
}

function CartDrawer() {
  const { open, setOpen, lines, setQty, total } = useCart();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, setOpen]);
  if (!open) return null;

  return (
    <>
      <div className="overlay" onClick={() => setOpen(false)} />
      <aside className="drawer" role="dialog" aria-label="Your cart">
        <div className="drawer-head">
          <h3>Your group order</h3>
          <div className="spacer" />
          <button className="x" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="drawer-body">
          {lines.length === 0 ? (
            <div className="empty" style={{ marginTop: 12 }}>
              <p><strong>Your cart is empty.</strong></p>
              <p className="muted small" style={{ marginTop: 6 }}>Add essentials and they’ll join your campus’s next bulk buy.</p>
            </div>
          ) : (
            lines.map((l) => (
              <div className="line" key={l.product_id}>
                {l.image_url ? <img src={l.image_url} alt="" /> : <div className="thumb" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{l.name}</div>
                  <div className="muted small">{money(l.price_cents)} each</div>
                </div>
                <div className="stepper">
                  <button onClick={() => setQty(l.product_id, l.qty - 1)} aria-label={`Remove one ${l.name}`}>−</button>
                  <span>{l.qty}</span>
                  <button onClick={() => setQty(l.product_id, l.qty + 1)} aria-label={`Add one ${l.name}`}>+</button>
                </div>
              </div>
            ))
          )}
        </div>
        {lines.length > 0 && (
          <div className="drawer-foot">
            <div className="row"><strong>Total</strong><div className="spacer" /><strong>{money(total)}</strong></div>

            <Link href="/checkout" className="btn accent block" onClick={() => setOpen(false)}>Checkout</Link>
          </div>
        )}
      </aside>
    </>
  );
}
