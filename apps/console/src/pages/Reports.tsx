import { orderBy, where } from "firebase/firestore";
import { useState } from "react";
import { useConsole } from "../App";
import { ChartTable, Columns, HBars, LineChart, type Point, compact } from "../charts";
import { useGroup } from "../state";
import { type Payment, type UsageDay, colomboMonth, fromCents, rupees, todayColombo } from "../types";
import { Loading, PageHead } from "../ui";

const MONTH = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "short" });
const MONTH_LONG = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const DAY_SHORT = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function months(n: number, now = new Date()): string[] {
  const first = colomboMonth(now);
  const [y, m] = first.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 15));
    return d.toISOString().slice(0, 7);
  });
}

export function ReportsPage() {
  const { clients } = useConsole();
  const [range, setRange] = useState<6 | 12>(12);
  const payments = useGroup<Payment>("payments");
  const since = new Date(Date.now() - 30 * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const usage = useGroup<UsageDay & { clientId?: string }>("usage", [where("date", ">=", since), orderBy("date")], since);
  if (!clients || !payments) return <Loading />;
  const live = clients.filter((c) => c.status !== "cancelled");
  const ms = months(range);

  const revenue: Point[] = ms.map((m) => ({ label: MONTH(m), title: MONTH_LONG(m), value: payments.filter((p) => p.date.startsWith(m)).reduce((n, p) => n + p.amount, 0) }));
  const growth: Point[] = ms.map((m) => {
    const end = `${m}-31T23:59:59Z`;
    return { label: MONTH(m), title: `End of ${MONTH_LONG(m)}`, value: live.filter((c) => c.createdAt <= end).length };
  });
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.parse(`${todayColombo()}T12:00:00Z`) - (30 - i) * 86_400_000).toISOString().slice(0, 10));
  const sales: Point[] = days.map((d) => ({ label: DAY_SHORT(d), value: (usage ?? []).filter((u) => u.date === d).reduce((n, u) => n + u.total, 0) / 100 }));
  const sharing = new Set((usage ?? []).map((u) => u.clientId)).size;
  const tally = (key: (c: (typeof live)[number]) => string | undefined): Point[] => {
    const m = new Map<string, number>();
    for (const c of live) {
      const k = key(c);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const versions = tally((c) => c.health?.appVersion);
  const editions = tally((c) => (c.licence ? c.licence.edition.charAt(0).toUpperCase() + c.licence.edition.slice(1) : undefined));
  const industries = tally((c) => c.industry || "Not set");
  const plans = tally((c) => c.subscription?.plan);
  const total = revenue.reduce((n, p) => n + p.value, 0);

  return (
    <>
      <PageHead title="Reports & Analytics" sub="Revenue you collected, how your client base grows, and what the systems report." />
      <div className="seg filter-row" role="tablist" aria-label="Period">
        {([6, 12] as const).map((n) => <button key={n} role="tab" aria-selected={range === n} className={range === n ? "on" : ""} onClick={() => setRange(n)}>Last {n} months</button>)}
      </div>
      <div className="grid cols-2">
        <section className="card">
          <div className="card-head"><h2 className="grow">Revenue collected</h2><span className="small muted">{rupees(total)} in {range} months</span></div>
          <div className="card-body">
            <Columns data={revenue} format={rupees} label={`Revenue collected per month, last ${range} months`} />
            <ChartTable head={["Month", "Collected"]} rows={revenue.map((p) => [p.title ?? p.label, rupees(p.value)])} />
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="grow">Clients</h2><span className="small muted">{live.length} now</span></div>
          <div className="card-body">
            <LineChart data={growth} format={(n) => `${n} client${n === 1 ? "" : "s"}`} label={`Number of clients at the end of each month, last ${range} months`} />
            <ChartTable head={["Month", "Clients"]} rows={growth.map((p) => [p.title ?? p.label, String(p.value)])} />
          </div>
        </section>
      </div>
      <section className="card">
        <div className="card-head"><h2 className="grow">Sales through POS Suite, last 30 days</h2><span className="small muted">{sharing} client(s) share their daily figures</span></div>
        <div className="card-body">
          {usage === undefined ? <Loading /> : <Columns data={sales} format={(n) => fromCents(n * 100)} height={200} label="Total sales per day across clients that share their figures" />}
          <ChartTable head={["Day", "Sales"]} rows={sales.map((p) => [p.label, rupees(p.value)])} />
          <p className="tiny muted">Owners choose on their About page whether yesterday's totals are sent; only totals arrive, never bills or customers.</p>
        </div>
      </section>
      <div className="grid cols-4">
        <section className="card"><div className="card-head"><h2>Versions</h2></div><div className="card-body"><HBars data={versions} empty="No check-ins yet" /></div></section>
        <section className="card"><div className="card-head"><h2>Editions</h2></div><div className="card-body"><HBars data={editions} empty="No licences yet" /></div></section>
        <section className="card"><div className="card-head"><h2>Plans</h2></div><div className="card-body"><HBars data={plans} empty="No subscriptions yet" /></div></section>
        <section className="card"><div className="card-head"><h2>Industries</h2></div><div className="card-body"><HBars data={industries} format={(n) => compact(n)} empty="No clients yet" /></div></section>
      </div>
    </>
  );
}
