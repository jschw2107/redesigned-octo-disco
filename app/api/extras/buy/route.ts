import { NextResponse } from "next/server";
import { handle, body } from "@/lib/http";
import { InputError, email, location, str } from "@/lib/validate";
import { getCampaign } from "@/lib/campaigns";
import { extrasOnSale, startExtraPurchase } from "@/lib/extras";
import { siteUrl } from "@/lib/fulfill";

/** Buy extra units left over from a seller's minimum order. Stock is held while the buyer pays. */
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const camp = await getCampaign({ number: Number(b.campaign) });
  if (!camp || !extrasOnSale(camp)) throw new InputError("There are no extras for sale on this GroupBuy right now.");
  const qty = Number(b.qty);
  const max = Math.min(10, camp.extra_units);
  if (!Number.isInteger(qty) || qty < 1 || qty > max) throw new InputError(`You can buy between 1 and ${max}.`);
  const name = str(b.name, "Name", { max: 100 });
  const mail = email(b.email);
  const loc = await location(b);
  const r = await startExtraPurchase({
    camp, qty, name, email: mail, university: loc.uni.name, hall: loc.hallName, room: loc.room, apartment: loc.apartment, base: await siteUrl(req),
  });
  if ("error" in r) throw new InputError(r.error!);
  return NextResponse.json({ code: r.code, url: r.url });
});
