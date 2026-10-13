import Link from "next/link";
import { adminConfigured, isAdmin } from "@/lib/auth";
import { all, databaseIsTemporary, one } from "@/lib/db";
import { fmtDate, getSettings, getUniversities } from "@/lib/data";
import {
  campaignPath, code, demand, demandCurve, getCampaign, getFeeBps, getSetting, ladder, listCampaigns, plural, publicState, usd, usdCompact,
} from "@/lib/campaigns";
import { paymentsEnabled } from "@/lib/stripe";
import { emailEnabled } from "@/lib/email";
import { AdminLogin, CampusManager, DeleteWaitlist, IntegrationsPanel, LogoutButton } from "@/components/admin/AdminClient";
import {
  AnnounceButton, CampaignEditor, CancelCommitment, ImageUploader, CopyText, DealPanel, DeleteCampaign, NewCampaignButton, RequestActions,
  SettingsForm, StatusControl,
} from "@/components/admin/Campaigns";
import { Countdown } from "@/components/Countdown";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · GroupBuy", robots: { index: false } };

const TABS = [
  ["overview", "Demand"],
  ["groupbuys", "GroupBuys"],
  ["buyers", "Buyers"],
  ["requests", "Requests"],
  ["alerts", "Alerts list"],
  ["campuses", "Universities & halls"],
  ["settings", "Settings"],
] as const;

const STATUS_BADGE: Record<string, string> = {
  pending: "warn", pending_card: "warn", active: "good", won: "", paid: "good", not_matched: "neutral", withdrawn: "neutral", cancelled: "bad",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Unconfirmed", pending_card: "Needs card", active: "Committed", won: "Won: awaiting payment", paid: "Paid", not_matched: "Above their price", withdrawn: "Withdrew", cancelled: "Cancelled",
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await isAdmin())) return <AdminLogin configured={adminConfigured()} />;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";

  return (
    <div className="admin-shell">
      <div className="admin-top">
        <div className="container header-inner">
          <Link href="/admin" className="logo" style={{ color: "#fff" }}>
            <img src="/icon.svg" alt="" width={30} height={30} style={{ borderRadius: 8 }} />
            GroupBuy
            <span className="badge" style={{ background: "rgba(255,255,255,.14)", color: "#fff", marginLeft: 2 }}>Admin</span>
          </Link>
          <div className="spacer" />
          <Link href="/" className="small" style={{ color: "#c9c4d4" }}>View site ↗</Link>
          <LogoutButton />
        </div>
      </div>
      <nav className="tabs"><div className="container row" style={{ gap: 0, flexWrap: "nowrap" }}>
        {TABS.map(([k, label]) => <Link key={k} href={`/admin?tab=${k}`} className={tab === k ? "on" : ""}>{label}</Link>)}
      </div></nav>
      <main className="container" style={{ paddingBottom: 80 }}>
        {databaseIsTemporary() && (
          <div className="alert error" style={{ marginBottom: 20 }}>
            <strong>Database not connected.</strong> Data is stored temporarily and will be lost when Vercel restarts the app. Connect Turso in Vercel.
          </div>
        )}
        {tab === "overview" && <Overview />}
        {tab === "groupbuys" && (sp.id ? <CampaignDetail id={Number(sp.id)} /> : <CampaignList />)}
        {tab === "buyers" && <Buyers campaignId={sp.campaign ? Number(sp.campaign) : null} />}
        {tab === "requests" && <Requests />}
        {tab === "alerts" && <Alerts />}
        {tab === "campuses" && <CampusManager universities={await getUniversities(false)} />}
        {tab === "settings" && <Settings />}
      </main>
    </div>
  );
}

async function Overview() {
  const [week, total, campaigns, pending, reqs] = await Promise.all([
    demand(7), demand(), listCampaigns(),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM commitments WHERE status IN ('pending','pending_card')"),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE status='pending'"),
  ]);
  const fees = await one<{ earned: number; pending: number; gmv: number }>(
    `SELECT COALESCE(SUM(CASE WHEN status='paid' THEN fee_amount_cents END),0) AS earned,
            COALESCE(SUM(CASE WHEN status='won' THEN fee_amount_cents END),0) AS pending,
            COALESCE(SUM(CASE WHEN status='paid' THEN amount_cents END),0) AS gmv FROM commitments`);
  const pitch = `In seven days, we aggregated ${usd(week.dollars, 0)} of committed purchasing demand from ${week.students} students.`;
  const tz = (await getSettings()).timezone;
  const visible = campaigns.filter((c) => c.status !== "cancelled");
  return (
    <>
      <div className="admin-h"><h2>Aggregated demand</h2></div>
      <div className="metric-hero stack" style={{ gap: 8 }}>
        <div className="small">Your killer metric · last 7 days</div>
        <div className="big">{usd(week.dollars, 0)} committed by {week.students} students</div>
        <div className="row small" style={{ gap: 10 }}>
          <span>“{pitch}”</span><CopyText text={pitch} />
        </div>
      </div>
      <div className="kpis" style={{ marginTop: 16 }}>
        <div className="kpi"><div className="small muted">All-time demand</div><div className="v">{usdCompact(total.dollars)}</div></div>
        <div className="kpi"><div className="small muted">Students</div><div className="v">{total.students}</div><div className="small muted">{total.edu} with .edu email</div></div>
        <div className="kpi"><div className="small muted">Commitments</div><div className="v">{total.commitments}</div><div className="small muted">{total.units} units</div></div>
        <div className="kpi"><div className="small muted">Started, not finished</div><div className="v">{pending?.n ?? 0}</div><div className="small muted">no card / unconfirmed</div></div>
        <div className="kpi"><div className="small muted">GroupBuy fees earned</div><div className="v">{usd(fees?.earned ?? 0, 0)}</div><div className="small muted">{usd(fees?.gmv ?? 0, 0)} collected{fees?.pending ? ` · ${usd(fees.pending, 0)} awaiting payment` : ""}</div></div>
        <div className="kpi"><div className="small muted">Requests to review</div><div className="v">{reqs?.n ?? 0}</div><Link className="small" href="/admin?tab=requests">Review →</Link></div>
      </div>
      <p className="small muted">Demand = units × each buyer’s maximum price, counting confirmed commitments only.</p>

      <div className="admin-h"><h2>By GroupBuy</h2><div className="spacer" /><NewCampaignButton /></div>
      <CampaignTable rows={visible} tz={tz} />
      <IntegrationsPanel
        payments={paymentsEnabled() ? (process.env.STRIPE_SECRET_KEY!.startsWith("sk_live") ? "live" : "test") : "off"}
        webhook={!!process.env.STRIPE_WEBHOOK_SECRET} email={emailEnabled()}
        from={process.env.EMAIL_FROM || "GroupBuy <onboarding@resend.dev>"} adminEmail={process.env.ADMIN_EMAIL || ""}
      />
    </>
  );
}

function CampaignTable({ rows, tz }: { rows: Awaited<ReturnType<typeof listCampaigns>>; tz: string }) {
  if (!rows.length) return <div className="empty"><p className="muted">No GroupBuys yet.</p></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>GroupBuy</th><th>Status</th><th className="num">Committed</th><th className="num">Buyers</th><th className="num">Demand</th><th className="num">Target</th><th>Closes</th></tr></thead>
        <tbody>
          {rows.map((c) => {
            const l = ladder(c);
            return (
              <tr key={c.id}>
                <td>{code(c.number)}</td>
                <td><Link href={`/admin?tab=groupbuys&id=${c.id}`}><strong>{c.emoji} {c.title}</strong></Link></td>
                <td><span className="badge neutral">{publicState(c).label}</span></td>
                <td className="num">{c.units} / {c.goal} {plural(c.goal, c.unit)}</td>
                <td className="num">{c.buyers}</td>
                <td className="num">{usd(c.demand_cents, 0)}</td>
                <td className="num">{usd(c.status === "deal" ? c.final_cents : l.current)}</td>
                <td className="small">{c.status === "live" ? <Countdown to={c.deadline} /> : fmtDate(c.deadline, tz)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function CampaignList() {
  const [rows, tz] = [await listCampaigns(), (await getSettings()).timezone];
  return (
    <>
      <div className="admin-h"><h2>GroupBuys</h2><div className="spacer" /><NewCampaignButton /></div>
      <p className="muted" style={{ marginBottom: 16 }}>New GroupBuys start as drafts. Fill in the details, then set the status to <strong>Live</strong>.</p>
      <CampaignTable rows={rows} tz={tz} />
    </>
  );
}

async function CampaignDetail({ id }: { id: number }) {
  const c = await getCampaign({ id });
  if (!c) return <div className="empty"><p>GroupBuy not found. <Link href="/admin?tab=groupbuys">Back</Link></p></div>;
  const tz = (await getSettings()).timezone;
  const [curve, alerts, stats] = await Promise.all([
    demandCurve(c),
    one<{ n: number }>("SELECT COUNT(DISTINCT lower(email)) AS n FROM waitlist"),
    all<{ status: string; n: number; units: number; amount: number }>(
      "SELECT status, COUNT(*) AS n, COALESCE(SUM(qty),0) AS units, COALESCE(SUM(amount_cents),0) AS amount FROM commitments WHERE campaign_id=? GROUP BY status", [c.id]),
  ]);
  const by = Object.fromEntries(stats.map((s) => [s.status, s]));
  const l = ladder(c);
  return (
    <>
      <div className="admin-h">
        <Link href="/admin?tab=groupbuys" className="small muted">← GroupBuys</Link>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: "1.7rem" }}>{c.emoji} #{code(c.number)} {c.title}</h2>
        <div className="spacer" />
        <StatusControl id={c.id} status={c.status} isDeal={c.status === "deal"} />
        <Link className="btn sm ghost" href={campaignPath(c.number)} target="_blank">View page ↗</Link>
        {c.status === "live" && <AnnounceButton id={c.id} count={alerts?.n ?? 0} />}
        <DeleteCampaign id={c.id} />
      </div>
      <div className="kpis">
        <div className="kpi"><div className="small muted">Committed</div><div className="v">{c.units}</div><div className="small muted">of {c.goal} {plural(c.goal, c.unit)} goal</div></div>
        <div className="kpi"><div className="small muted">Buyers</div><div className="v">{c.buyers}</div><div className="small muted">{(by.pending?.n ?? 0) + (by.pending_card?.n ?? 0)} not finished</div></div>
        <div className="kpi"><div className="small muted">Demand</div><div className="v">{usdCompact(c.demand_cents)}</div></div>
        <div className="kpi"><div className="small muted">{c.status === "deal" ? "Deal price" : "Current target"}</div><div className="v">{usd(c.status === "deal" ? c.final_cents : l.current)}</div><div className="small muted">normal {usd(c.normal_cents)}</div></div>
        {c.status === "deal" && <div className="kpi"><div className="small muted">Paid</div><div className="v">{by.paid?.n ?? 0}/{(by.paid?.n ?? 0) + (by.won?.n ?? 0)}</div><div className="small muted">{usd(by.paid?.amount ?? 0)} collected</div></div>}
      </div>

      <div className="split" style={{ alignItems: "start" }}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="panel stack" style={{ gap: 10 }}>
            <h3>Demand curve: what to show sellers</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>At this price</th><th className="num">Buyers</th><th className="num">Units</th><th className="num">Order value</th></tr></thead>
                <tbody>{curve.map((r) => <tr key={r.price}><td>{usd(r.price)}</td><td className="num">{r.buyers}</td><td className="num">{r.units}</td><td className="num">{usd(r.value, 0)}</td></tr>)}</tbody>
              </table>
            </div>
            {curve.length > 0 && (
              <div className="row small" style={{ gap: 8 }}>
                <span className="muted">Pitch:</span>
                <span>“We can deliver {curve.map((r) => `${r.units} ${plural(r.units, c.unit)} at ${usd(r.price)}`).join(", or ")}. What’s your best offer?”</span>
                <CopyText text={`We can deliver ${curve.map((r) => `${r.units} ${plural(r.units, c.unit)} at ${usd(r.price)}`).join(", or ")}. What's your best offer?`} />
              </div>
            )}
          </div>
          {(c.status === "live" || c.status === "negotiating") && <DealPanel id={c.id} normalCents={c.normal_cents} unit={c.unit} curve={curve} tz={tz} />}
          {c.status === "deal" && (
            <div className="panel stack">
              <h3>Deal locked at {usd(c.final_cents)}</h3>
              <p className="small muted">{by.won?.n ?? 0} awaiting payment · {by.paid?.n ?? 0} paid · {by.not_matched?.n ?? 0} above their price{c.pay_by ? ` · pay by ${fmtDate(c.pay_by, tz)}` : ""}</p>
            </div>
          )}
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <ImageUploader id={c.id} imageUrl={c.image_url} emoji={c.emoji} />
          <CampaignEditor c={c} tz={tz} />
        </div>
      </div>
      <Buyers campaignId={c.id} embedded />
    </>
  );
}

async function Buyers({ campaignId, embedded = false }: { campaignId: number | null; embedded?: boolean }) {
  const tz = (await getSettings()).timezone;
  const rows = await all<{
    id: number; token: string; created_at: string; name: string; email: string; university_name: string; hall_name: string; apartment: string;
    max_cents: number; qty: number; status: string; amount_cents: number | null; refunded_cents: number; number: number; title: string; refs: number;
    card_label: string | null; charge_error: string | null;
  }>(
    `SELECT m.*, c.number, c.title, (SELECT COUNT(*) FROM commitments r WHERE r.ref=m.token AND r.status IN ('active','won','paid')) AS refs
     FROM commitments m JOIN campaigns c ON c.id=m.campaign_id ${campaignId ? "WHERE c.id=?" : ""} ORDER BY m.created_at DESC LIMIT 1000`,
    campaignId ? [campaignId] : []);
  const camps = embedded ? [] : await listCampaigns();
  return (
    <>
      <div className="admin-h">
        <h2>Buyers</h2><span className="badge">{rows.length}</span>
        {!embedded && (
          <div className="row" style={{ gap: 6 }}>
            <Link className={`btn sm ${campaignId ? "ghost" : ""}`} href="/admin?tab=buyers">All</Link>
            {camps.map((c) => <Link key={c.id} className={`btn sm ${campaignId === c.id ? "" : "ghost"}`} href={`/admin?tab=buyers&campaign=${c.id}`}>#{code(c.number)}</Link>)}
          </div>
        )}
        <div className="spacer" />
        <a className="btn ghost sm" href={`/api/admin/commitments${campaignId ? `?campaign=${campaignId}` : ""}`}>Download CSV</a>
      </div>
      {rows.length === 0 ? <div className="empty"><p className="muted">No one has joined yet.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Joined</th>{!campaignId && <th>GroupBuy</th>}<th>Buyer</th><th>Campus</th><th className="num">Qty</th><th className="num">Max price</th><th>Status</th><th className="num">Invited</th><th /></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="small">{fmtDate(m.created_at, tz)}</td>
                  {!campaignId && <td>#{code(m.number)} {m.title}</td>}
                  <td>{m.name}<div className="small muted">{m.email}</div></td>
                  <td>{m.university_name}<div className="small muted">{m.hall_name}{m.apartment ? ` · ${m.apartment}` : ""}</div></td>
                  <td className="num">{m.qty}</td>
                  <td className="num">{usd(m.max_cents)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[m.status] ?? "neutral"}`}>{STATUS_LABEL[m.status] ?? m.status}</span>
                    {m.amount_cents != null && (m.status === "won" || m.status === "paid") && <div className="small muted">{usd(m.amount_cents)}</div>}
                    {m.refunded_cents > 0 && <div className="small muted">Refunded {usd(m.refunded_cents)}</div>}
                    {m.card_label && <div className="small muted">💳 {m.card_label}</div>}
                    {m.charge_error && m.status === "won" && <div className="small" style={{ color: "var(--bad)" }}>Auto-charge failed: {m.charge_error}</div>}
                  </td>
                  <td className="num">{m.refs || ""}</td>
                  <td className="num">{!["cancelled", "not_matched", "withdrawn"].includes(m.status) && <CancelCommitment id={m.id} paid={m.status === "paid"} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>“Invited” = people who joined through this buyer’s share link.</p>
    </>
  );
}

async function Requests() {
  const tz = (await getSettings()).timezone;
  const rows = await all<{ id: number; created_at: string; title: string; details: string; target_cents: number | null; name: string; email: string; status: string; votes: number; campaign_id: number | null }>(
    `SELECT r.*, (SELECT COUNT(*) FROM request_votes v WHERE v.request_id=r.id) + 1 AS votes FROM requests r
     ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, votes DESC, r.created_at DESC`);
  return (
    <>
      <div className="admin-h"><h2>Student requests</h2><span className="muted small">Approve to publish on /requests for others to back. Turn the popular ones into GroupBuys.</span></div>
      {rows.length === 0 ? <div className="empty"><p className="muted">No requests yet.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Request</th><th>From</th><th className="num">Interested</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.title}</strong>{r.target_cents ? ` under ${usd(r.target_cents)}` : ""}{r.details && <div className="small muted">{r.details}</div>}</td>
                  <td>{r.name}<div className="small muted">{r.email} · {fmtDate(r.created_at, tz)}</div></td>
                  <td className="num">{r.votes}</td>
                  <td>
                    <span className="badge neutral">{r.status}</span>
                    {r.campaign_id && <div><Link className="small" href={`/admin?tab=groupbuys&id=${r.campaign_id}`}>Open GroupBuy →</Link></div>}
                  </td>
                  <td><RequestActions id={r.id} status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Alerts() {
  const tz = (await getSettings()).timezone;
  const rows = await all<{ id: number; created_at: string; email: string; university_name: string; hall_name: string; university_id: number | null }>(
    "SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 1000");
  return (
    <>
      <div className="admin-h">
        <h2>Alerts list</h2><span className="badge">{rows.length}</span>
        <span className="small muted">Students who want an email when a new GroupBuy opens. Use “Email alerts list” on a live GroupBuy.</span>
        <div className="spacer" />
        <a className="btn ghost sm" href="/api/admin/waitlist">Download CSV</a>
      </div>
      {rows.length === 0 ? <div className="empty"><p className="muted">No signups yet.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Joined</th><th>Email</th><th>University</th><th>Residence</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small">{fmtDate(r.created_at, tz)}</td><td>{r.email}</td>
                  <td>{r.university_name} {r.university_id == null && <span className="badge warn">not listed</span>}</td><td>{r.hall_name}</td>
                  <td className="num"><DeleteWaitlist id={r.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Settings() {
  return (
    <>
      <div className="admin-h"><h2>Settings</h2></div>
      <SettingsForm domains={await getSetting("email_domains")} feePct={String((await getFeeBps()) / 100)} />
      <IntegrationsPanel
        payments={paymentsEnabled() ? (process.env.STRIPE_SECRET_KEY!.startsWith("sk_live") ? "live" : "test") : "off"}
        webhook={!!process.env.STRIPE_WEBHOOK_SECRET} email={emailEnabled()}
        from={process.env.EMAIL_FROM || "GroupBuy <onboarding@resend.dev>"} adminEmail={process.env.ADMIN_EMAIL || ""}
      />
    </>
  );
}
