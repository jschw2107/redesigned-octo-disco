import crypto from "node:crypto";
import { allowedDomains, getCampaign, isOpen, parseOptions, type CampaignWithStats } from "./campaigns";
import { InputError } from "./validate";

export const newToken = () => crypto.randomBytes(12).toString("base64url");

/** Validates the price level and quantity a buyer picked for a campaign. */
export function validChoice(camp: CampaignWithStats, maxRaw: unknown, qtyRaw: unknown) {
  const max = Number(maxRaw);
  if (!parseOptions(camp).includes(max)) throw new InputError("Pick one of the price options");
  const qty = Number(qtyRaw ?? 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > camp.max_per_buyer) throw new InputError(`Quantity must be between 1 and ${camp.max_per_buyer}`);
  return { max, qty };
}

export async function openCampaign(number: unknown) {
  const camp = await getCampaign({ number: Number(number) });
  if (!camp) throw new InputError("GroupBuy not found");
  if (!isOpen(camp)) throw new InputError("This GroupBuy isn't taking new commitments right now.");
  return camp;
}

export async function checkDomain(email: string) {
  const domains = await allowedDomains();
  if (domains.length && !domains.some((d) => email.endsWith("@" + d))) {
    throw new InputError(`Please use your school email (${domains.map((d) => "@" + d).join(" or ")}).`);
  }
}
