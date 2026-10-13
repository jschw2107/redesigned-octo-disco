// Shared (client + server): the authorization a student gives when saving a card.
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export function chargeConsent(camp: { title: string; fee_cents: number; unit: string }, maxCents: number, qty: number) {
  const cap = (maxCents + camp.fee_cents) * qty;
  return `By saving your card, you authorize GroupBuy to charge it once, automatically, if a deal for ${camp.title} is secured at or below ` +
    `${money(maxCents)} per ${camp.unit}. You'll pay the group's final price${camp.fee_cents ? ` plus a ${money(camp.fee_cents)} fee` : ""}, ` +
    `never more than ${money(cap)} in total. You can withdraw any time before joining closes.`;
}
