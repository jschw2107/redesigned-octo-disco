import Link from "next/link";
import { Footer, Header } from "@/components/Header";
import { CampaignCard } from "@/components/CampaignCard";
import { listCampaigns } from "@/lib/campaigns";
import { extrasOnSale, sweepExtraHolds } from "@/lib/extras";
import { siteUrl } from "@/lib/fulfill";

export const dynamic = "force-dynamic";
export const metadata = { title: "In stock now", description: "Leftover GroupBuy stock you can buy right now, no waiting for a group." };

export default async function InStockPage() {
  await sweepExtraHolds(await siteUrl()).catch(() => {});
  const items = (await listCampaigns({ publicOnly: true })).filter(extrasOnSale);
  return (
    <>
      <Header />
      <main className="container section" style={{ paddingTop: 40 }}>
        <div className="eyebrow">Buy now</div>
        <h2>In stock now</h2>
        <p className="lead">
          Sometimes a seller requires a bigger order than the group committed to, so we buy the extra units. They’re sold here at close to the
          group price, first come, first served. No waiting for a group.
        </p>
        {items.length === 0 ? (
          <div className="empty" style={{ marginTop: 28 }}>
            <h3>Nothing in stock right now</h3>
            <p className="muted" style={{ marginTop: 6 }}>Extra stock shows up here after a GroupBuy closes. Meanwhile, join a live one at your price.</p>
            <Link className="btn accent" href="/#groupbuys" style={{ marginTop: 16 }}>See live GroupBuys</Link>
          </div>
        ) : (
          <div className="grid gb-grid" style={{ marginTop: 28 }}>{items.map((c) => <CampaignCard key={c.id} c={c} stock />)}</div>
        )}
      </main>
      <Footer />
    </>
  );
}
