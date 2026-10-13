"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function Logo() {
  return (
    <Link href="/" className="logo">
      <img src="/icon.svg" alt="" width={26} height={26} style={{ borderRadius: 8 }} />
      GroupBuy
    </Link>
  );
}

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={`header ${scrolled ? "scrolled" : ""}`}>
      <div className="container header-inner">
        <Logo />
        <nav className="nav" aria-label="Main">
          <Link href="/#groupbuys">Live GroupBuys</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/requests">Request a GroupBuy</Link>
        </nav>
        <div className="spacer" />
        <Link className="btn sm" href="/#groupbuys">Join a GroupBuy</Link>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container row">
        <Logo />
        <div className="spacer" />
        <span>Students set the price. Sellers compete. Everyone pays the same.</span>
      </div>
    </footer>
  );
}
