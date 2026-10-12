import { Header } from "@/components/Header";
import { CheckoutForm } from "@/components/CheckoutForm";
import { currentCycle, fmtDate, getSettings, getUniversities, pickupTime } from "@/lib/data";
import { paymentsEnabled } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout — GroupBuy" };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const { cancelled } = await searchParams;
  const [settings, cycle, universities] = await Promise.all([getSettings(), currentCycle(), getUniversities()]);
  const unis = universities.map((u) => ({ id: u.id, name: u.name, pickup_location: u.pickup_location, halls: u.halls.map((h) => ({ id: h.id, name: h.name })) }));
  return (
    <>
      <Header showNav={false} />
      <main className="container section" style={{ paddingTop: 40 }}>
        <div className="eyebrow">Checkout</div>
        <h2>Join this round’s bulk buy</h2>
        <p className="lead" style={{ marginBottom: 32 }}>
          Orders close <strong>{fmtDate(cycle.closes_at, settings.timezone)}</strong>. Pickup starts{" "}
          <strong>{fmtDate(pickupTime(cycle, settings), settings.timezone)}</strong>.
        </p>
        <CheckoutForm universities={unis} paused={settings.ordering_paused} online={paymentsEnabled()} cancelled={cancelled === "1"} />
      </main>
    </>
  );
}
