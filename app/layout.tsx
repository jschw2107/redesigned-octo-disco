import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GroupBuy: students set the price, sellers compete",
  description:
    "Join a GroupBuy at the price you'd pay. We bring verified student demand to sellers, they compete for the order, and everyone pays the same final price.",
  // Google Search Console ownership check: paste the code from Search Console into the GOOGLE_SITE_VERIFICATION
  // environment variable in Vercel, then redeploy.
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION.trim() } } : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Inter:wght@400..700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
