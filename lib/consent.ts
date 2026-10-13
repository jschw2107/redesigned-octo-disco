// Shared (client + server): GroupBuy's fee math and the authorization a student gives when saving a card.
//
// Fee model: GroupBuy keeps a share of the savings, i.e. the gap between the normal price and the price the group
// achieved. Example at 20%: normal $249, deal $199 → savings $50 → fee $10 → the student pays $209 and keeps $40 of the savings.
// A better deal means a bigger fee in dollars, but the student's total always goes down (they keep the other 80%).

export const DEFAULT_FEE_BPS = 2000; // 20.00%

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

/** GroupBuy's fee for one unit at a given deal price. */
export function feePerUnit(priceCents: number, normalCents: number, feeBps: number) {
  return Math.round((Math.max(0, normalCents - priceCents) * Math.max(0, feeBps)) / 10000);
}

/** What the student pays per unit: deal price + fee. Always increases with price, so the worst case is at their maximum. */
export function unitTotal(priceCents: number, normalCents: number, feeBps: number) {
  return priceCents + feePerUnit(priceCents, normalCents, feeBps);
}

export function chargeConsent(camp: { title: string; unit: string; normal_cents: number }, maxCents: number, qty: number, feeBps: number) {
  const cap = qty * unitTotal(maxCents, camp.normal_cents, feeBps);
  const fee = feeBps > 0
    ? ` plus GroupBuy's fee of ${pct(feeBps)} of what you save versus the ${money(camp.normal_cents)} normal price`
    : "";
  return `By saving your card, you authorize GroupBuy to charge it once, automatically, if a deal for ${camp.title} is secured at or below ` +
    `${money(maxCents)} per ${camp.unit}. You'll pay the group's final price${fee}, never more than ${money(cap)} in total. ` +
    `You can withdraw any time before joining closes.`;
}
