import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Check, type DailyStats, type MenuItem, COLLECTIONS as C, aggregateChecks, hasPrivilege, mergeStats } from "@pos/core";
import { money, moneyShort } from "../../../lib/format";
import { useCollection } from "../../../state/app";
import { Icon, type IconName } from "./icons";
import type { PosApi } from "./MobilePos";
import type { MobileStyle } from "@pos/core";

/** Business dates before `date` (inclusive), oldest first. */
export function lastDays(date: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${date}T00:00:00Z`);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(d.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

const dayLabel = (date: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/**
 * Sales figures the signed-in employee may see: the property's daily totals (reports privilege),
 * or only their own checks today (own-reports privilege), or nothing.
 */
export function useSales(api: PosApi, days: number) {
  const all = hasPrivilege(api.role, "pos.reports");
  const own = !all && hasPrivilege(api.role, "pos.reportsOwn");
  const dates = useMemo(() => lastDays(api.bd, Math.max(days, 8)), [api.bd, days]);
  const stats = (useCollection<DailyStats>(all ? C.dailyStats : null, { where: [["businessDate", ">=", dates[0]!]] }) ?? []).filter((s) => s.propertyId === api.ws.propertyId);
  const todays = useCollection<Check>(own ? C.checks : null, { where: [["businessDate", "==", api.bd]] }) ?? [];
  return useMemo(() => {
    if (all) {
      const byDate = new Map(stats.map((s) => [s.businessDate, s]));
      const series = dates.slice(-days).map((d) => ({ date: d, label: dayLabel(d), value: byDate.get(d)?.netSales ?? 0 }));
      const range = mergeStats(dates.slice(-days).map((d) => byDate.get(d)).filter((s): s is DailyStats => Boolean(s)), api.ws.propertyId);
      const today = byDate.get(api.bd);
      const yesterday = byDate.get(dates[dates.length - 2]!);
      const prev = mergeStats(dates.slice(-2 * days, -days).map((d) => byDate.get(d)).filter((s): s is DailyStats => Boolean(s)), api.ws.propertyId);
      return { scope: "property" as const, series, range, today, yesterday, prev };
    }
    if (own) {
      const mine = todays.filter((c) => c.status === "closed" && c.staffId === api.user.id && c.propertyId === api.ws.propertyId);
      const range = aggregateChecks(mine, api.ctx, "mine");
      return { scope: "mine" as const, series: [], range, today: range, yesterday: undefined, prev: undefined };
    }
    return { scope: "none" as const, series: [], range: undefined, today: undefined, yesterday: undefined, prev: undefined };
  }, [all, own, stats, todays, dates, days, api.bd, api.ws.propertyId, api.user.id, api.ctx]);
}

export function change(now: number, before: number | undefined): { text: string; up: boolean } | null {
  if (!before) return null;
  const p = ((now - before) / before) * 100;
  return { text: `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`, up: p >= 0 };
}

/**
 * Line (Bright) or bar (Indigo) chart of daily sales, drawn as SVG.
 * The drawing is sized to the space it really has, so on a PC or tablet the chart gets wider and a
 * little taller while the day labels and dots stay at their phone size instead of being scaled up.
 */
export function SalesChart({ data, kind, height: baseHeight = 150 }: { data: { label: string; value: number }[]; kind: "line" | "bars"; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = Math.round(entries[0]?.contentRect.width ?? 0);
      if (cw > 0) setW((prev) => (Math.abs(prev - cw) > 1 ? cw : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = Math.round(Math.min(baseHeight * 1.6, Math.max(baseHeight, w * 0.2)));
  const pad = 22;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const y = (v: number) => height - 26 - (v / max) * (height - 46);
  const pts = data.map((d, i) => [pad + i * step, y(d.value)] as const);
  const showLabels = data.length <= 10;
  return (
    <svg ref={ref} className="m-chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label="Sales chart">
      <defs>
        <linearGradient id="m-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--m-accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--m-accent)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="m-bar" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--m-accent-2)" />
          <stop offset="1" stopColor="var(--m-accent)" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={pad} x2={w - pad} y1={y(max * f)} y2={y(max * f)} className="m-grid" />)}
      {kind === "line" ? (
        <>
          {pts.length > 1 ? <path d={`M${pts[0]![0]},${height - 26} ${pts.map(([x, yy]) => `L${x},${yy}`).join(" ")} L${pts[pts.length - 1]![0]},${height - 26} Z`} fill="url(#m-area)" /> : null}
          <polyline points={pts.map(([x, yy]) => `${x},${yy}`).join(" ")} fill="none" stroke="var(--m-accent)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
          {pts.map(([x, yy], i) => <circle key={i} cx={x} cy={yy} r={i === pts.length - 1 ? 4.5 : 3} fill="var(--m-card)" stroke="var(--m-accent)" strokeWidth={2} />)}
        </>
      ) : (
        data.map((d, i) => {
          const bw = Math.min(w > 600 ? 44 : 26, ((w - pad * 2) / data.length) * 0.6);
          const x = pad + (data.length > 1 ? i * step : (w - pad * 2) / 2) - bw / 2;
          return <rect key={i} x={x} y={y(d.value)} width={bw} height={Math.max(2, height - 26 - y(d.value))} rx={6} fill={i === data.length - 1 ? "url(#m-bar)" : "var(--m-bar-past)"} />;
        })
      )}
      {showLabels ? data.map((d, i) => <text key={i} x={pad + (data.length > 1 ? i * step : (w - pad * 2) / 2)} y={height - 6} textAnchor="middle" className="m-axis">{d.label}</text>) : null}
    </svg>
  );
}

export function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${30 - (v / max) * 26}`).join(" ");
  return (
    <svg className="m-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function StatTile({ icon, tone, label, value, delta }: { icon: IconName; tone: string; label: string; value: string; delta?: { text: string; up: boolean } | null }) {
  return (
    <div className="m-stat">
      <span className="m-stat-ico" style={{ ["--tone" as string]: tone }}><Icon name={icon} size={18} /></span>
      <span className="m-stat-label">{label}</span>
      <strong className="m-stat-value">{value}</strong>
      {delta ? <span className={`m-delta ${delta.up ? "up" : "down"}`}>{delta.text} vs yesterday</span> : null}
    </div>
  );
}

/** Reports tab: totals, chart, top dishes and payment methods. */
export function MobileReports({ api, style, onDetailed }: { api: PosApi; style: MobileStyle; onDetailed: () => void }) {
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const sales = useSales(api, days === 1 ? 7 : days);
  const menu = new Map<string, MenuItem>(api.menuItems.map((m) => [m.id, m]));
  if (sales.scope === "none") {
    return (
      <div className="m-screen">
        <div className="m-empty"><Icon name="lock" size={36} /><p>Your role does not include sales reports.</p></div>
      </div>
    );
  }
  const r = days === 1 ? sales.today : sales.range;
  const net = r?.netSales ?? 0;
  const prevNet = days === 1 ? sales.yesterday?.netSales : sales.prev?.netSales;
  const top = Object.entries(r?.items ?? {}).map(([id, v]) => ({ id, name: menu.get(id)?.name ?? id, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  const topMax = Math.max(1, ...top.map((t) => t.amount));
  const tenders = Object.entries(r?.tenders ?? {}).map(([id, v]) => ({ id, name: api.tenders.find((t) => t.id === id)?.name ?? id, ...v })).sort((a, b) => b.amount - a.amount);
  const tenderTotal = tenders.reduce((s, t) => s + t.amount, 0) || 1;
  return (
    <div className="m-screen m-reports">
      {sales.scope === "property" ? (
        <div className="m-seg">
          {([1, 7, 30] as const).map((d) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d === 1 ? "Today" : d === 7 ? "7 days" : "30 days"}</button>)}
        </div>
      ) : (
        <p className="m-muted small">Your own sales today.</p>
      )}
      <div className="m-card m-hero">
        <span className="m-muted">Net sales</span>
        <strong className="m-big">{moneyShort(net)}</strong>
        {change(net, prevNet) ? <span className={`m-delta ${change(net, prevNet)!.up ? "up" : "down"}`}>{change(net, prevNet)!.text} vs previous {days === 1 ? "day" : `${days} days`}</span> : null}
        {sales.series.length && days !== 1 ? <SalesChart data={sales.series} kind={style === "bright" ? "line" : "bars"} /> : null}
      </div>
      <div className="m-stats">
        <StatTile icon="orders" tone="#1a73e8" label="Orders" value={String(r?.checks ?? 0)} />
        <StatTile icon="users" tone="#9333ea" label="Guests" value={String(r?.covers ?? 0)} />
        <StatTile icon="trend" tone="#16a34a" label="Avg order" value={moneyShort(r?.checks ? Math.round(net / r.checks) : 0)} />
        <StatTile icon="percent" tone="#ea580c" label="Discounts" value={moneyShort(r?.discounts ?? 0)} />
      </div>
      <div className={`m-card${tenders.length ? " m-rep-half" : ""}`}>
        <div className="m-card-head"><strong>Top dishes</strong><span className="m-muted small">by sales</span></div>
        {top.length ? top.map((t) => (
          <div key={t.id} className="m-bar-row">
            <div className="row between"><span>{t.name}</span><span className="m-muted small">{t.qty} sold · {money(t.amount)}</span></div>
            <div className="m-progress"><span style={{ width: `${(t.amount / topMax) * 100}%` }} /></div>
          </div>
        )) : <p className="m-muted small">No sales yet.</p>}
      </div>
      {tenders.length ? (
        <div className="m-card m-rep-half">
          <div className="m-card-head"><strong>Payment methods</strong></div>
          {tenders.map((t) => (
            <div key={t.id} className="m-bar-row">
              <div className="row between"><span>{t.name}</span><span className="m-muted small">{Math.round((t.amount / tenderTotal) * 100)}% · {money(t.amount)}</span></div>
              <div className="m-progress alt"><span style={{ width: `${(t.amount / tenderTotal) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      ) : null}
      <button className="m-btn outline block" onClick={onDetailed}><Icon name="reports" size={18} /> Detailed reports (X, employees, items, exceptions)</button>
    </div>
  );
}
