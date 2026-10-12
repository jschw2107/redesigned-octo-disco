import Stripe from "stripe";

let client: Stripe | null | undefined;

/** Online payments are on when STRIPE_SECRET_KEY is set. Without it, orders are "pay at pickup". */
export function paymentsEnabled() {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function stripe(): Stripe | null {
  if (client !== undefined) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return (client = null);
  // STRIPE_API_BASE is only for local testing against a mock server.
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  client = new Stripe(key, base ? { host: base.hostname, port: base.port, protocol: base.protocol.replace(":", "") as "http" | "https" } : {});
  return client;
}

/** Checkout sessions must stay open at least 30 minutes; we use 31 to leave a margin. */
export const sessionExpiry = () => Math.floor(Date.now() / 1000) + 31 * 60;
