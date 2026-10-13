import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { InputError } from "@/lib/validate";
import { getCampaign, isOpen } from "@/lib/campaigns";
import { getCommitment, siteUrl } from "@/lib/fulfill";
import { startCardSetup } from "@/lib/cards";
import { paymentsEnabled } from "@/lib/stripe";

/** Add or replace the saved card for a commitment (while the GroupBuy is open). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  if (!paymentsEnabled()) throw new InputError("Card payments aren't set up yet.");
  const m = await getCommitment(token);
  if (!m) throw new InputError("Commitment not found");
  const camp = (await getCampaign({ id: m.campaign_id }))!;
  if (!isOpen(camp) || !["active", "pending_card", "withdrawn", "pending"].includes(m.status)) throw new InputError("This GroupBuy has closed.");
  return NextResponse.json({ url: await startCardSetup(m, camp, await siteUrl(req)) });
});
