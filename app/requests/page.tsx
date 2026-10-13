import Link from "next/link";
import { Footer, Header } from "@/components/Header";
import { RequestForm, VoteButton } from "@/components/Requests";
import { all } from "@/lib/db";
import { campaignPath, code, usd } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request a GroupBuy" };

export default async function RequestsPage() {
  const reqs = await all<{ id: number; title: string; details: string; target_cents: number | null; status: string; votes: number; number: number | null }>(
    `SELECT r.*, (SELECT COUNT(*) FROM request_votes v WHERE v.request_id=r.id) + 1 AS votes,
            (SELECT number FROM campaigns c WHERE c.id=r.campaign_id AND c.status!='draft') AS number
     FROM requests r WHERE r.status IN ('approved','converted') ORDER BY votes DESC, r.created_at DESC LIMIT 100`);
  return (
    <>
      <Header />
      <main className="container section" style={{ paddingTop: 40 }}>
        <div className="eyebrow">Student-led GroupBuys</div>
        <h2>What should the group buy next?</h2>
        <p className="lead">Propose anything: electronics, furniture, flights, gym memberships, phone plans. When enough students say they’re in, we turn it into a live GroupBuy and take the demand to sellers.</p>
        <div className="split" style={{ marginTop: 32 }}>
          <div className="stack" style={{ gap: 12 }}>
            {reqs.length === 0 ? (
              <div className="empty"><h3>No requests yet</h3><p className="muted" style={{ marginTop: 6 }}>Be the first: what would you buy if 500 students bought it together?</p></div>
            ) : reqs.map((r) => (
              <div key={r.id} className="panel" style={{ padding: 18 }}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>Who wants {r.title}{r.target_cents ? ` under ${usd(r.target_cents)}` : ""}?</h3>
                    {r.details && <p className="small muted" style={{ marginTop: 4 }}>{r.details}</p>}
                  </div>
                  {r.number
                    ? <Link className="btn sm accent" href={campaignPath(r.number)}>Live: GroupBuy #{code(r.number)} →</Link>
                    : <VoteButton id={r.id} votes={r.votes} />}
                </div>
              </div>
            ))}
          </div>
          <aside className="stack" style={{ position: "sticky", top: 88 }}>
            <h3>Start a GroupBuy</h3>
            <RequestForm />
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
