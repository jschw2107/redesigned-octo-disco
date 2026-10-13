import { NextResponse } from "next/server";
import { run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { getCampaign, isOpen } from "@/lib/campaigns";
import { validChoice } from "@/lib/commit";
import { getCommitment } from "@/lib/fulfill";
import { paymentsEnabled } from "@/lib/stripe";

async function load(token: string) {
  const m = await getCommitment(token);
  if (!m) throw new InputError("Commitment not found");
  const camp = (await getCampaign({ id: m.campaign_id }))!;
  if (!isOpen(camp) || !["active", "pending", "withdrawn", "pending_card"].includes(m.status)) {
    throw new InputError("This commitment can't be changed anymore: the GroupBuy has closed.");
  }
  return { m, camp };
}

/** Change your maximum price or quantity (or rejoin after withdrawing) while the GroupBuy is open. */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const { m, camp } = await load(token);
  const b = await body(req);
  const { max, qty } = validChoice(camp, b.max_cents ?? m.max_cents, b.qty ?? m.qty);
  // The private link proves the email. With payments on, a commitment only counts once a card is saved.
  const needsCard = paymentsEnabled() && !m.payment_method_id;
  const status = m.status === "withdrawn" || m.status === "pending" ? (needsCard ? "pending_card" : "active") : m.status;
  await run("UPDATE commitments SET max_cents=?, qty=?, status=?, confirmed_at=COALESCE(confirmed_at, ?), updated_at=? WHERE id=?",
    [max, qty, status, new Date().toISOString(), new Date().toISOString(), m.id]);
  return NextResponse.json({ ok: true });
});

/** Withdraw while the GroupBuy is open. */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const { m } = await load(token);
  await run("UPDATE commitments SET status='withdrawn', updated_at=? WHERE id=?", [new Date().toISOString(), m.id]);
  return NextResponse.json({ ok: true });
});
