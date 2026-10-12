import { Header, Logo } from "@/components/Header";
import { ProductGrid } from "@/components/ProductGrid";
import { StoreSection } from "@/components/StoreSection";
import { WaitlistForm } from "@/components/WaitlistForm";
import { Countdown } from "@/components/Countdown";
import { paymentsEnabled } from "@/lib/stripe";
import { sweepStaleCheckouts } from "@/lib/fulfill";
import { currentCycle, fmtDate, getProducts, getSettings, getStoreItems, getUniversities, groupProgress, pickupTime } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ reservation_cancelled?: string }> }) {
  const sp = await searchParams;
  await sweepStaleCheckouts().catch((e) => console.error("[sweep]", e));
  const [settings, cycle] = await Promise.all([getSettings(), currentCycle()]);
  const [products, universities, storeItems, progress] = await Promise.all([
    getProducts(), getUniversities(), getStoreItems(), groupProgress(cycle.id),
  ]);
  const unis = universities.map((u) => ({ id: u.id, name: u.name, pickup_location: u.pickup_location, halls: u.halls.map((h) => ({ id: h.id, name: h.name })) }));
  const tz = settings.timezone;
  // Copy adapts to the campus list: with one school (Yeshiva University today) the page speaks to it directly.
  const campusName = unis.length === 1 ? unis[0].name : "your campus";
  const hallNames = unis.length === 1 ? unis[0].halls.map((h) => h.name) : [];
  const hallsLine = hallNames.length > 1 ? `${hallNames.slice(0, -1).join(", ")} and ${hallNames[hallNames.length - 1]}` : "your dorm";

  return (
    <>
      <Header />
      <main>
        <section className="hero">
          <div className="container">
            <div className="cycle-pill">
              <span className={`cycle-dot ${settings.ordering_paused ? "paused" : ""}`} />
              {settings.ordering_paused ? (
                <span>Ordering is paused. Join the waitlist for the next drop.</span>
              ) : (
                <span>
                  This round closes <strong>{fmtDate(cycle.closes_at, tz)}</strong> · <Countdown to={cycle.closes_at} />
                </span>
              )}
            </div>
            <div className="eyebrow">Now launching at {campusName} · Small budget. Big buying power.</div>
            <h1>Your dorm. Your essentials. <span className="accent-word">Less money.</span></h1>
            <p className="lead">Wholesale buying power. College-sized budgets. Buy with your neighbors in {hallsLine}, save on everyday essentials, and pick up just what you need on campus.</p>
            <div className="hero-actions">
              <a className="btn accent" href="#deals">Explore the essentials</a>
              <a className="btn ghost" href="#how-it-works">How it works</a>
            </div>
          </div>
        </section>

        <section className="container">
          <div className="power">
            <div>
              <div className="eyebrow">The power of the group</div>
              <h2>30 students. One bulk buy.</h2>
              <p style={{ marginTop: 16, fontSize: "1.1rem" }}>Same drinks. Same dorm. Wholesale buying power for everyone.</p>
              <p className="power-foot">Buy wholesale. Save together. One pickup.</p>
            </div>
            <div className="dots" aria-hidden>{Array.from({ length: 30 }, (_, i) => <span key={i} />)}</div>
          </div>
        </section>

        <section className="section" id="deals">
          <div className="container">
            <div className="eyebrow">The dorm restock, reimagined</div>
            <h2>Everyday essentials. Not everyday prices.</h2>
            <p className="lead">
              Orders from your campus combine into one wholesale purchase each round.{" "}
              {!settings.ordering_paused && <>This round’s order is placed <strong>{fmtDate(cycle.closes_at, tz)}</strong>, with pickup from <strong>{fmtDate(pickupTime(cycle, settings), tz)}</strong>.</>}
            </p>
            <ProductGrid products={products} progress={progress} universities={unis} paused={settings.ordering_paused} />
          </div>
        </section>

        <section className="section" id="individual-store" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="eyebrow">Just need one?</div>
            <h2>Small quantities. Same campus convenience.</h2>
            <p className="lead" style={{ marginBottom: 32 }}>
              When a wholesale purchase has more units than students ordered, the extras go on this shelf. Reserve just what you need at a price slightly above the wholesale unit cost.
            </p>
            {sp.reservation_cancelled === "1" && (
              <div className="alert warn" style={{ marginBottom: 18 }}>Payment was cancelled and your card wasn’t charged. The item is back on the shelf.</div>
            )}
            <StoreSection items={storeItems} universities={unis} online={paymentsEnabled()} />
          </div>
        </section>

        <section className="section" id="how-it-works" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="eyebrow">How it works</div>
            <h2>More neighbors. More buying power.</h2>
            <div className="steps">
              <div className="step"><div className="step-num">01</div><h3>Pick your essentials</h3><p>Tell us what you need. Your detergent, drinks, snacks, and toiletries join the same order as your neighbors’ essentials.</p></div>
              <div className="step"><div className="step-num">02</div><h3>Buy wholesale together</h3><p>Your campus’s orders combine into one wholesale purchase. Buying together means lower prices, without buying or storing a warehouse-sized stash.</p></div>
              <div className="step"><div className="step-num">03</div><h3>Grab it on campus</h3><p>One convenient pickup point. We share the time and place before each drop, so you can get stocked and get back to your day.</p></div>
            </div>
          </div>
        </section>

        <section className="container" id="waitlist">
          <div className="waitlist">
            <div className="eyebrow">Join the waitlist</div>
            <h2>Bring the bulk-buy club to {unis.length === 1 ? unis[0].name : "your dorm"}.</h2>
            <p className="lead">Join the waitlist for launch updates and the first campus drops. No payment now. Just better buying, together.</p>
            <WaitlistForm universities={unis} />
          </div>
        </section>
      </main>
      <footer className="footer">
        <div className="container row">
          <Logo />
          <div className="spacer" />
          <span>Built for your budget. Better with your neighbors.</span>
        </div>
      </footer>
    </>
  );
}
