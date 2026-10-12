import Link from "next/link";
import { adminConfigured, isAdmin } from "@/lib/auth";
import { all, databaseIsTemporary } from "@/lib/db";
import {
  currentCycle, fmtDate, fmtMoney, getProducts, getSettings, getUniversities, groupProgress, pickupTime, type Cycle,
} from "@/lib/data";
import { isoToLocalInput } from "@/lib/tz";
import {
  AdminLogin, LogoutButton, ScheduleForm, CampusManager, ProductManager, StoreManager, OrderStatus, ReservationStatus, DeleteWaitlist, CycleSelect,
} from "@/components/admin/AdminClient";
import { Countdown } from "@/components/Countdown";
import { IntegrationsPanel, PickupReminder } from "@/components/admin/AdminClient";
import { paymentsEnabled } from "@/lib/stripe";
import { emailEnabled } from "@/lib/email";
import { sweepStaleCheckouts } from "@/lib/fulfill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — GroupBuy", robots: { index: false } };

const TABS = [
  ["overview", "This round"],
  ["orders", "Orders"],
  ["schedule", "Schedule"],
  ["campuses", "Universities & halls"],
  ["products", "Products"],
  ["store", "Individual store"],
  ["waitlist", "Waitlist"],
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await isAdmin())) return <AdminLogin configured={adminConfigured()} />;
  const sp = await searchParams;
  await sweepStaleCheckouts().catch((e) => console.error("[sweep]", e));
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";

  return (
    <div className="admin-shell">
      <div className="admin-top">
        <div className="container header-inner">
          <Link href="/admin" className="logo" style={{ color: "#fff" }}><span className="logo-mark">G</span>GroupBuy admin</Link>
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
            <strong>Database not connected.</strong> Orders, signups and settings are being stored temporarily and will be lost
            when Vercel restarts the app. Add <code>DATABASE_URL</code> and <code>DATABASE_AUTH_TOKEN</code> (from Turso) in Vercel → Settings → Environment Variables, then redeploy.
          </div>
        )}
        {tab === "overview" && <Overview />}
        {tab === "orders" && <Orders cycleParam={sp.cycle} />}
        {tab === "schedule" && <Schedule />}
        {tab === "campuses" && <CampusManager universities={await getUniversities(false)} />}
        {tab === "products" && <ProductManager products={await getProducts(false)} />}
        {tab === "store" && <Store />}
        {tab === "waitlist" && <Waitlist />}
      </main>
    </div>
  );
}

async function Overview() {
  const [settings, cycle] = await Promise.all([getSettings(), currentCycle()]);
  const tz = settings.timezone;
  const [stats, waitlist, products, progress, perUni] = await Promise.all([
    all<{ orders: number; students: number; revenue: number }>(
      `SELECT COUNT(*) AS orders, COUNT(DISTINCT lower(email)) AS students, COALESCE(SUM(total_cents),0) AS revenue
       FROM orders WHERE cycle_id=? AND status IN ('placed','picked_up')`, [cycle.id]),
    all<{ n: number }>("SELECT COUNT(*) AS n FROM waitlist"),
    getProducts(false),
    groupProgress(cycle.id),
    all<{ university_id: number; university_name: string; orders: number }>(
      `SELECT university_id, university_name, COUNT(*) AS orders FROM orders WHERE cycle_id=? AND status IN ('placed','picked_up')
       GROUP BY university_id, university_name ORDER BY orders DESC`, [cycle.id]),
  ]);
  const s = stats[0];
  const byProduct = products
    .map((p) => {
      const rows = progress.filter((x) => x.product_id === p.id);
      return { p, units: rows.reduce((a, r) => a + r.units, 0), rows };
    })
    .filter((x) => x.units > 0);

  return (
    <>
      <div className="admin-h">
        <h2>Round #{cycle.id}</h2>
        {settings.ordering_paused
          ? <span className="badge warn">Ordering paused</span>
          : <span className="badge good">Open · <Countdown to={cycle.closes_at} /></span>}
        <div className="spacer" />
        <Link className="btn ghost sm" href="/admin?tab=schedule">Edit schedule</Link>
      </div>
      <p className="muted" style={{ marginBottom: 20 }}>
        Order closes and is placed <strong>{fmtDate(cycle.closes_at, tz)}</strong> · pickup from <strong>{fmtDate(pickupTime(cycle, settings), tz)}</strong> ·
        repeats every <strong>{settings.cycle_days} day{settings.cycle_days === 1 ? "" : "s"}</strong>
      </p>
      <div className="kpis">
        <div className="kpi"><div className="small muted">Orders this round</div><div className="v">{s.orders}</div></div>
        <div className="kpi"><div className="small muted">Students</div><div className="v">{s.students}</div></div>
        <div className="kpi"><div className="small muted">Order value</div><div className="v">{fmtMoney(s.revenue)}</div></div>
        <div className="kpi"><div className="small muted">Waitlist</div><div className="v">{waitlist[0].n}</div></div>
      </div>

      <div className="admin-h">
        <h2>Purchase list</h2>
        <span className="muted small">What to buy wholesale when this round closes</span>
        <div className="spacer" />
        <a className="btn ghost sm" href={`/api/admin/orders?cycle=${cycle.id}&view=totals`}>Download CSV</a>
      </div>
      {byProduct.length === 0 ? (
        <div className="empty"><p className="muted">No orders yet this round.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th className="num">Total units</th><th>By university</th></tr></thead>
            <tbody>
              {byProduct.map(({ p, units, rows }) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td className="num">{units}</td>
                  <td>
                    <div className="chips">
                      {rows.map((r) => {
                        const uni = perUni.find((u) => u.university_id === r.university_id)?.university_name ?? `#${r.university_id}`;
                        const ok = r.students >= p.min_group;
                        return (
                          <span key={r.university_id} className={`badge ${ok ? "good" : "neutral"}`} title={`${r.students} students, ${r.units} units`}>
                            {uni}: {r.units} unit{r.units === 1 ? "" : "s"} · {r.students}/{p.min_group} students {ok ? "✓" : ""}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>Green means enough students joined to unlock the deal at that school. Only paid (or pay-at-pickup) orders count.</p>
      <IntegrationsPanel
        payments={paymentsEnabled() ? (process.env.STRIPE_SECRET_KEY!.startsWith("sk_live") ? "live" : "test") : "off"}
        webhook={!!process.env.STRIPE_WEBHOOK_SECRET}
        email={emailEnabled()}
        from={process.env.EMAIL_FROM || "GroupBuy <onboarding@resend.dev>"}
        adminEmail={process.env.ADMIN_EMAIL || ""}
      />
    </>
  );
}

async function Orders({ cycleParam }: { cycleParam?: string }) {
  const settings = await getSettings();
  const current = await currentCycle();
  const cycles = await all<Cycle & { orders: number }>(
    "SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.cycle_id=c.id) AS orders FROM cycles c ORDER BY c.id DESC LIMIT 100");
  const cycleId = cycles.some((c) => String(c.id) === cycleParam) ? Number(cycleParam) : current.id;
  const orders = await all<{
    id: string; created_at: string; name: string; email: string; phone: string; university_name: string; hall_name: string;
    apartment: string; total_cents: number; status: string; items: string; payment_method: string; refunded_cents: number;
  }>(
    `SELECT o.*, (SELECT GROUP_CONCAT(oi.qty || '× ' || oi.product_name, ', ') FROM order_items oi WHERE oi.order_id=o.id) AS items
     FROM orders o WHERE o.cycle_id=? ORDER BY o.created_at DESC`, [cycleId]);
  const tz = settings.timezone;

  return (
    <>
      <div className="admin-h">
        <h2>Orders</h2>
        <CycleSelect value={cycleId} options={cycles.map((c) => ({
          id: c.id, label: `Round #${c.id} · ${c.status === "open" ? "open, closes" : "closed"} ${fmtDate(c.closes_at, tz)} · ${c.orders} orders`,
        }))} />
        <div className="spacer" />
        <a className="btn ghost sm" href={`/api/admin/orders?cycle=${cycleId}&view=orders`}>Orders CSV</a>
        <a className="btn ghost sm" href={`/api/admin/orders?cycle=${cycleId}&view=totals`}>Totals CSV</a>
      </div>
      <PickupReminder cycleId={cycleId} count={orders.filter((o) => o.status === "placed").length} />
      {orders.length === 0 ? <div className="empty"><p className="muted">No orders in this round.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Student</th><th>Campus</th><th>Items</th><th className="num">Total</th><th>Payment</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/order/${o.id}`} target="_blank">{o.id}</Link><div className="small muted">{fmtDate(o.created_at, tz)}</div></td>
                  <td>{o.name}<div className="small muted">{o.email}{o.phone ? ` · ${o.phone}` : ""}</div></td>
                  <td>{o.university_name}<div className="small muted">{o.hall_name}{o.apartment ? ` · ${o.apartment}` : ""}</div></td>
                  <td className="small">{o.items}</td>
                  <td className="num">{fmtMoney(o.total_cents)}</td>
                  <td>
                    {o.payment_method === "stripe"
                      ? o.status === "pending_payment" ? <span className="badge warn">Awaiting payment</span>
                        : o.status === "expired" ? <span className="badge neutral">Not paid</span>
                        : <span className="badge good">Paid online</span>
                      : <span className="badge">Pay at pickup</span>}
                    {o.refunded_cents > 0 && <div className="small muted">Refunded {fmtMoney(o.refunded_cents)}</div>}
                  </td>
                  <td>{o.status === "pending_payment" || o.status === "expired" ? <span className="small muted">—</span> : <OrderStatus id={o.id} status={o.status} paid={o.payment_method === "stripe"} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Schedule() {
  const [settings, cycle] = await Promise.all([getSettings(), currentCycle()]);
  return (
    <ScheduleForm
      settings={settings}
      cycleId={cycle.id}
      closesAt={cycle.closes_at}
      closesLocal={isoToLocalInput(cycle.closes_at, settings.timezone)}
    />
  );
}

async function Store() {
  const settings = await getSettings();
  const [items, reservations] = await Promise.all([
    all<{ id: number; name: string; description: string; image_url: string; price_cents: number; stock: number; active: number }>(
      "SELECT * FROM store_items ORDER BY name"),
    all<{ id: number; code: string | null; created_at: string; item_name: string; qty: number; unit_cents: number; name: string; email: string; university_name: string; hall_name: string; status: string; payment_method: string; refunded_cents: number }>(
      "SELECT * FROM reservations ORDER BY CASE status WHEN 'reserved' THEN 0 WHEN 'pending_payment' THEN 1 ELSE 2 END, created_at DESC LIMIT 300"),
  ]);
  return (
    <>
      <StoreManager items={items} />
      <div className="admin-h"><h2>Reservations</h2></div>
      {reservations.length === 0 ? <div className="empty"><p className="muted">No reservations yet.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Item</th><th>Student</th><th>Campus</th><th className="num">Amount</th><th>Payment</th><th>Status</th></tr></thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id}>
                  <td className="small">{fmtDate(r.created_at, settings.timezone)}</td>
                  <td>{r.qty} × {r.item_name}{r.code && <div className="small muted">{r.code}</div>}</td>
                  <td>{r.name}<div className="small muted">{r.email}</div></td>
                  <td>{r.university_name}<div className="small muted">{r.hall_name}</div></td>
                  <td className="num">{fmtMoney(r.unit_cents * r.qty)}</td>
                  <td>
                    {r.payment_method === "stripe"
                      ? r.status === "pending_payment" ? <span className="badge warn">Awaiting payment (stock held)</span>
                        : r.status === "expired" ? <span className="badge neutral">Not paid</span>
                        : <span className="badge good">Paid online</span>
                      : <span className="badge">Pay at pickup</span>}
                    {r.refunded_cents > 0 && <div className="small muted">Refunded {fmtMoney(r.refunded_cents)}</div>}
                  </td>
                  <td>{r.status === "pending_payment" || r.status === "expired" ? <span className="small muted">—</span> : <ReservationStatus id={r.id} status={r.status} paid={r.payment_method === "stripe"} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Waitlist() {
  const settings = await getSettings();
  const [counts, rows] = await Promise.all([
    all<{ university_name: string; hall_name: string; n: number }>(
      "SELECT university_name, hall_name, COUNT(*) AS n FROM waitlist GROUP BY university_name, hall_name ORDER BY university_name, n DESC"),
    all<{ id: number; created_at: string; email: string; university_name: string; hall_name: string; university_id: number | null }>(
      "SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 500"),
  ]);
  const unis = [...new Set(counts.map((c) => c.university_name))];
  return (
    <>
      <div className="admin-h">
        <h2>Waitlist</h2><span className="badge">{rows.length} signups</span>
        <div className="spacer" />
        <a className="btn ghost sm" href="/api/admin/waitlist">Download CSV</a>
      </div>
      {unis.length > 0 && (
        <div className="kpis">
          {unis.map((u) => {
            const rs = counts.filter((c) => c.university_name === u);
            return (
              <div className="kpi" key={u}>
                <div className="small muted">{u}</div>
                <div className="v">{rs.reduce((a, r) => a + r.n, 0)}</div>
                <div className="small" style={{ marginTop: 6 }}>
                  {rs.map((r) => <div key={r.hall_name} className="row" style={{ gap: 6 }}><span className="muted">{r.hall_name || "No residence given"}</span><div className="spacer" />{r.n}</div>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {rows.length === 0 ? <div className="empty"><p className="muted">No signups yet.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Joined</th><th>Email</th><th>University</th><th>Residence</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small">{fmtDate(r.created_at, settings.timezone)}</td>
                  <td>{r.email}</td>
                  <td>{r.university_name} {r.university_id == null && <span className="badge warn">not listed</span>}</td>
                  <td>{r.hall_name}</td>
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
