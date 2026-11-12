import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  type Budget,
  type Check,
  type DailyStats,
  type InventoryItem,
  type MenuCategory,
  type MenuItem,
  type OrderType,
  type Property,
  type StockLevel,
  type TenderMedia,
  COLLECTIONS as C,
  addDays,
  breakdown,
  coversReport,
  dailyRevenue,
  eodWhatsAppText,
  itemSales,
  loadStats,
  menuEngineering,
  mergeStats,
  newId,
  reorderSuggestions,
  salesByHour,
  tenderSummary,
} from "@pos/core";
import { tablesToWorkbook } from "../../lib/excel";
import { Bar, Empty, Loading, Modal, PageHead, Seg, Stat } from "../../components/ui";
import { downloadBuffer, money, pct, timeColombo, todayColombo } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";
import { useIsPhone } from "../../lib/useIsPhone";
import { PhoneList } from "../../components/PhoneList";

export function useProperty(): { properties: Property[]; propertyId: string } {
  const { settings } = useApp();
  const properties = useCollection<Property>(C.properties) ?? [];
  const propertyId = properties.find((p) => p.id === settings.pos.defaultPropertyId)?.id ?? properties[0]?.id ?? settings.pos.defaultPropertyId;
  return { properties, propertyId };
}

export function useStats(propertyId: string, from: string, to: string, enabled = true): DailyStats[] | undefined {
  const store = useStore();
  const [stats, setStats] = useState<DailyStats[] | undefined>();
  useEffect(() => {
    let alive = true;
    setStats(undefined);
    if (!enabled) return;
    loadStats(store, propertyId, from, to)
      .then((s) => alive && setStats(s))
      .catch((e) => {
        console.error(e);
        if (alive) setStats([]);
      });
    return () => {
      alive = false;
    };
  }, [store, propertyId, from, to, enabled]);
  return stats;
}

const PRESETS: [string, number, number][] = [["Today", 0, 0], ["Yesterday", -1, -1], ["Last 7 days", -6, 0], ["Last 30 days", -29, 0]];

// ───────────────────────────── Dashboard ─────────────────────────────

export function Dashboard() {
  const { on, settings } = useApp();
  const { propertyId, properties } = useProperty();
  const today = todayColombo();
  const stats = useStats(propertyId, addDays(today, -13), today);
  const menuItems = useCollection<MenuItem>(C.menuItems) ?? [];
  const tenders = useCollection<TenderMedia>(C.tenderMedia) ?? [];
  const items = useCollection<InventoryItem>(on("inventory") ? C.inventoryItems : null) ?? [];
  const levels = useCollection<StockLevel>(on("inventory") ? C.stockLevels : null) ?? [];
  const budgets = useCollection<Budget>(C.budgets) ?? [];
  const openChecks = useCollection<Check>(on("pos") ? C.checks : null, { where: [["status", "==", "open"]] }) ?? [];

  if (!stats) return <div className="page"><Loading /></div>;
  const todayStats = stats.find((s) => s.businessDate === today);
  const lastWeekSame = stats.find((s) => s.businessDate === addDays(today, -7));
  const last7 = stats.filter((s) => s.businessDate > addDays(today, -7));
  const week = mergeStats(last7);
  const maxDay = Math.max(1, ...stats.map((s) => s.netSales));
  const month = today.slice(0, 7);
  const budget = budgets.find((b) => b.month === month && b.propertyId === propertyId);
  const monthSales = stats.filter((s) => s.businessDate.startsWith(month)).reduce((a, s) => a + s.netSales, 0);
  const lowStock = reorderSuggestions(items, levels);
  const top = itemSales(todayStats ?? week, menuItems, []).slice(0, 6);
  const delta = todayStats && lastWeekSame && lastWeekSame.netSales ? Math.round(((todayStats.netSales - lastWeekSame.netSales) / lastWeekSame.netSales) * 100) : null;

  return (
    <div className="page">
      <PageHead
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}`}
        subtitle={`${settings.branding.displayName} · ${properties.find((p) => p.id === propertyId)?.name ?? ""} · Business date ${today}`}
        actions={
          <>
            <Link className="btn" to="/emc/reports">
              Reports
            </Link>
            {on("pos") ? (
              <Link className="btn primary" to="/pos">
                Open POS
              </Link>
            ) : null}
          </>
        }
      />
      <div className="grid cols-4">
        <Stat label="Net sales today" value={money(todayStats?.netSales)} sub={delta === null ? "vs same day last week: —" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs same day last week`} tone={delta === null ? undefined : delta >= 0 ? "good" : "bad"} />
        <Stat label="Checks · covers" value={`${todayStats?.checks ?? 0} · ${todayStats?.covers ?? 0}`} sub={`${openChecks.length} open check${openChecks.length === 1 ? "" : "s"} now`} />
        <Stat label="Avg per cover" value={money(todayStats?.covers ? Math.round(todayStats.netSales / todayStats.covers) : 0)} sub={`7-day avg ${money(week.covers ? Math.round(week.netSales / week.covers) : 0)}`} />
        <Stat label="Month to date" value={money(monthSales)} sub={budget ? `${Math.round((monthSales / budget.salesTarget) * 100)}% of ${money(budget.salesTarget)} target` : "No target set"} />
      </div>
      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h3>Net sales, last 14 days</h3>
            <span className="muted small">{money(stats.reduce((a, s) => a + s.netSales, 0))}</span>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 170 }}>
              {Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map((d) => {
                const s = stats.find((x) => x.businessDate === d);
                const h = s ? Math.max(3, (s.netSales / maxDay) * 150) : 3;
                return (
                  <div key={d} title={`${d}: ${money(s?.netSales)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", height: h, borderRadius: 6, background: d === today ? "var(--accent)" : "var(--brand)", opacity: s ? 1 : 0.25 }} />
                    <span className="tiny muted">{d.slice(8)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Top items {todayStats ? "today" : "this week"}</h3>
          </div>
          <div className="card-body stack tight">
            {top.length === 0 ? <span className="muted">No sales yet</span> : null}
            {top.map((r) => (
              <div key={r.itemId} className="stack tight">
                <div className="row between small">
                  <span>{r.name} × {r.qty}</span>
                  <span className="num">{money(r.netSales)}</span>
                </div>
                <Bar value={r.netSales} max={top[0]?.netSales ?? 1} />
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Payments this week</h3>
          </div>
          <div className="card-body stack tight">
            {tenderSummary(week, tenders).map((t) => (
              <div key={t.key} className="row between small">
                <span>{t.label}</span>
                <span className="num">
                  {money(t.amount)} <span className="muted">({pct(t.pctBp, 0)})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        {on("inventory") ? (
          <div className="card">
            <div className="card-head">
              <h3>Below par level</h3>
              <Link to="/emc/inventory/po" className="small">
                Create purchase order →
              </Link>
            </div>
            <div className="card-body stack tight">
              {lowStock.length === 0 ? <span className="muted small">All stock items are above par.</span> : null}
              {lowStock.slice(0, 8).map((s) => (
                <div key={s.item.id} className="row between small">
                  <span>{s.item.name}</span>
                  <span className="badge warn">order {s.suggestQty} {s.item.purchaseUnit}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────────── Reports ─────────────────────────────

type Tab = "revenue" | "items" | "covers" | "sales" | "checks";

export function Reports() {
  const { settings, on, store, toast } = useApp();
  const { propertyId, properties } = useProperty();
  const today = todayColombo();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [custom, setCustom] = useState(false);
  const phone = useIsPhone();
  const [tab, setTab] = useState<Tab>("revenue");
  const [wa, setWa] = useState<string | null>(null);
  const stats = useStats(propertyId, from, to);
  const menuItems = useCollection<MenuItem>(C.menuItems) ?? [];
  const categories = useCollection<MenuCategory>(C.menuCategories) ?? [];
  const orderTypes = useCollection<OrderType>(C.orderTypes) ?? [];
  const tenders = useCollection<TenderMedia>(C.tenderMedia) ?? [];
  const checks = useCollection<Check>(tab === "checks" ? C.checks : null, { where: [["businessDate", "==", to]] });
  const merged = useMemo(() => mergeStats(stats ?? [], propertyId, `${from}..${to}`), [stats, propertyId, from, to]);

  const revenue = dailyRevenue(stats ?? []);
  const items = itemSales(merged, menuItems, categories);
  const covers = coversReport(merged, orderTypes);
  const catNames = new Map(categories.map((c) => [c.id, c.name]));
  const byCat = breakdown(merged.categories, (k) => catNames.get(k) ?? k);
  const byHour = salesByHour(merged);
  const byTender = tenderSummary(merged, tenders);

  async function exportExcel() {
    const buf = await tablesToWorkbook([
      {
        name: "Daily Revenue",
        title: `Daily revenue ${from} to ${to} – ${settings.branding.displayName}`,
        totals: true,
        rows: revenue,
        columns: [
          { header: "Date", value: (r) => r.date, width: 12 },
          { header: "Checks", value: (r) => r.checks, format: "number" },
          { header: "Covers", value: (r) => r.covers, format: "number" },
          { header: "Gross sales", value: (r) => r.grossSales, format: "money", width: 14 },
          { header: "Discounts", value: (r) => r.discounts, format: "money" },
          { header: "Net sales", value: (r) => r.netSales, format: "money", width: 14 },
          { header: "Service charge", value: (r) => r.serviceCharge, format: "money" },
          { header: "SSCL/TDL", value: (r) => r.sscl, format: "money" },
          { header: "VAT", value: (r) => r.vat, format: "money" },
          { header: "Total", value: (r) => r.total, format: "money", width: 14 },
        ],
      },
      {
        name: "Item-wise",
        totals: true,
        rows: items,
        columns: [
          { header: "Code", value: (r) => r.code },
          { header: "Item", value: (r) => r.name, width: 32 },
          { header: "Category", value: (r) => r.category, width: 20 },
          { header: "Qty", value: (r) => r.qty, format: "number" },
          { header: "Net sales", value: (r) => r.netSales, format: "money", width: 14 },
          { header: "Mix", value: (r) => r.mixPctBp, format: "percentBp" },
          { header: "Cost", value: (r) => r.cost, format: "money" },
          { header: "Gross profit", value: (r) => r.grossProfit, format: "money", width: 14 },
        ],
      },
      {
        name: "Covers",
        totals: true,
        rows: covers,
        columns: [
          { header: "Order type", value: (r) => r.orderType, width: 16 },
          { header: "Checks", value: (r) => r.checks, format: "number" },
          { header: "Covers", value: (r) => r.covers, format: "number" },
          { header: "Net sales", value: (r) => r.netSales, format: "money", width: 14 },
          { header: "Avg per cover", value: (r) => r.avgPerCover, format: "money", width: 14 },
        ],
      },
      { name: "Sales by category", totals: true, rows: byCat, columns: [{ header: "Category", value: (r) => r.label, width: 26 }, { header: "Qty", value: (r) => r.qty, format: "number" }, { header: "Net sales", value: (r) => r.amount, format: "money", width: 14 }, { header: "Share", value: (r) => r.pctBp, format: "percentBp" }] },
      { name: "Sales by hour", totals: true, rows: byHour, columns: [{ header: "Hour", value: (r) => r.label }, { header: "Checks", value: (r) => r.qty, format: "number" }, { header: "Net sales", value: (r) => r.amount, format: "money", width: 14 }] },
      { name: "Payments", totals: true, rows: byTender, columns: [{ header: "Tender", value: (r) => r.label, width: 22 }, { header: "Count", value: (r) => r.qty, format: "number" }, { header: "Amount", value: (r) => r.amount, format: "money", width: 14 }] },
    ]);
    downloadBuffer(buf, `sales-report-${from}-to-${to}.xlsx`);
  }

  async function sendWhatsApp() {
    const day = (stats ?? []).find((s) => s.businessDate === to);
    if (!day || !store) {
      toast(`No sales on ${to}`, true);
      return;
    }
    const text = eodWhatsAppText({ stats: day, business: settings.business, branding: settings.branding, menuItems, tenders, propertyName: properties.find((p) => p.id === propertyId)?.name ?? "" });
    setWa(text);
    const at = new Date().toISOString();
    await store.batch(
      settings.integrations.whatsapp.eodRecipients.map((r) => ({ op: "set" as const, col: C.messageLog, data: { id: newId(), channel: "whatsapp", to: r.phone, template: "eod_report", body: text, mode: settings.integrations.whatsapp.mode, status: "simulated", at } })),
    );
  }

  const maxHour = Math.max(1, ...byHour.map((h) => h.amount));

  return (
    <div className="page fill">
      <PageHead
        title="Reports"
        subtitle="Daily revenue, item-wise sales, covers and sales analysis. Totals come from pre-aggregated daily figures, so they load instantly."
        actions={
          <>
            {on("whatsapp") ? (
              <button className="btn" onClick={sendWhatsApp}>
                WhatsApp EOD ({to})
              </button>
            ) : null}
            <button className="btn primary" onClick={exportExcel} disabled={!stats}>
              Export to Excel
            </button>
          </>
        }
      />
      {phone ? (
        <div className="stack tight">
          <div className="chip-scroll" role="group" aria-label="Period">
            {PRESETS.map(([label, a, b]) => {
              const on = from === addDays(today, a) && to === addDays(today, b);
              return (
                <button key={label} className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => { setCustom(false); setFrom(addDays(today, a)); setTo(addDays(today, b)); }}>
                  {label}
                </button>
              );
            })}
            <button className={`chip${custom || !PRESETS.some(([, a, b]) => from === addDays(today, a) && to === addDays(today, b)) ? " on" : ""}`} onClick={() => setCustom(!custom)}>
              Dates…
            </button>
          </div>
          {custom ? (
            <div className="p-dates">
              <label className="field"><span>From</span><input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="field"><span>To</span><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          ) : null}
        </div>
      ) : (
      <div className="card card-body row wrap">
        <label className="small muted">From</label>
        <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 170 }} />
        <label className="small muted">To</label>
        <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ width: 170 }} />
        <div className="row wrap">
          {PRESETS.map(([label, a, b]) => (
            <button key={label} className="chip" onClick={() => { setFrom(addDays(today, a)); setTo(addDays(today, b)); }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      )}
      <Seg<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "revenue", label: "Daily revenue" },
          { value: "items", label: "Item-wise" },
          { value: "covers", label: "Covers" },
          { value: "sales", label: "Sales analysis" },
          { value: "checks", label: "Checks" },
        ]}
      />
      {!stats ? (
        <Loading />
      ) : stats.length === 0 && tab !== "checks" ? (
        <div className="card">
          <Empty title="No sales in this period" />
        </div>
      ) : tab === "revenue" ? (
        <>
          <div className="grid cols-4">
            <Stat label="Net sales" value={money(merged.netSales)} sub={`Gross ${money(merged.itemsTotal)} · discounts ${money(merged.discounts)}`} />
            <Stat label="Total incl. charges & taxes" value={money(merged.total)} sub={`SC ${money(merged.serviceCharge)} · VAT ${money(merged.vat)}`} />
            <Stat label="Checks · covers" value={`${merged.checks} · ${merged.covers}`} sub={`Avg check ${money(merged.checks ? Math.round(merged.total / merged.checks) : 0)}`} />
            <Stat label="Voids" value={money(merged.voids.amount)} sub={`${merged.voids.qty} item(s)`} tone={merged.voids.qty ? "warn" : undefined} />
          </div>
          {phone ? (
            <div className="card">
              <PhoneList rows={revenue.map((r) => ({ key: r.date, title: new Date(`${r.date}T12:00:00+05:30`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }), sub: `${r.checks} checks · ${r.covers} covers · avg ${money(r.avgPerCover)}`, value: money(r.netSales), valueSub: `total ${money(r.total)}` }))} />
            </div>
          ) : (
          <div className="card table-wrap fill-card">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Checks</th>
                  <th className="num">Covers</th>
                  <th className="num">Gross</th>
                  <th className="num">Discounts</th>
                  <th className="num">Net sales</th>
                  <th className="num">Service ch.</th>
                  <th className="num">SSCL/TDL</th>
                  <th className="num">VAT</th>
                  <th className="num">Total</th>
                  <th className="num">Avg/cover</th>
                </tr>
              </thead>
              <tbody>
                {revenue.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td className="num">{r.checks}</td>
                    <td className="num">{r.covers}</td>
                    <td className="num">{money(r.grossSales)}</td>
                    <td className="num">{money(r.discounts)}</td>
                    <td className="num"><strong>{money(r.netSales)}</strong></td>
                    <td className="num">{money(r.serviceCharge)}</td>
                    <td className="num">{money(r.sscl)}</td>
                    <td className="num">{money(r.vat)}</td>
                    <td className="num">{money(r.total)}</td>
                    <td className="num">{money(r.avgPerCover)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{merged.checks}</td>
                  <td className="num">{merged.covers}</td>
                  <td className="num">{money(merged.itemsTotal)}</td>
                  <td className="num">{money(merged.discounts)}</td>
                  <td className="num">{money(merged.netSales)}</td>
                  <td className="num">{money(merged.serviceCharge)}</td>
                  <td className="num">{money(merged.sscl + merged.tdl)}</td>
                  <td className="num">{money(merged.vat)}</td>
                  <td className="num">{money(merged.total)}</td>
                  <td className="num">{money(merged.covers ? Math.round(merged.netSales / merged.covers) : 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </>
      ) : tab === "items" && phone ? (
        <div className="card">
          <PhoneList rows={items.map((r) => ({ key: r.itemId, title: r.name, sub: `${r.code} · ${r.category} · ${pct(r.mixPctBp)} of sales`, value: money(r.netSales), valueSub: `${r.qty} sold · GP ${money(r.grossProfit)}` }))} />
        </div>
      ) : tab === "items" ? (
        <div className="card table-wrap fill-card">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Item</th>
                <th>Category</th>
                <th className="num">Qty</th>
                <th className="num">Net sales</th>
                <th className="num">Mix</th>
                <th className="num">Cost</th>
                <th className="num">Gross profit</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.itemId}>
                  <td className="mono">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="muted">{r.category}</td>
                  <td className="num">{r.qty}</td>
                  <td className="num">{money(r.netSales)}</td>
                  <td className="num">{pct(r.mixPctBp)}</td>
                  <td className="num">{money(r.cost)}</td>
                  <td className="num">{money(r.grossProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "covers" && phone ? (
        <div className="card">
          <PhoneList rows={covers.map((r) => ({ key: r.orderType, title: r.orderType, sub: `${r.checks} checks · ${r.covers} covers`, value: money(r.netSales), valueSub: `avg ${money(r.avgPerCover)} per cover` }))} />
        </div>
      ) : tab === "covers" ? (
        <div className="card table-wrap fill-card">
          <table className="table">
            <thead>
              <tr>
                <th>Order type</th>
                <th className="num">Checks</th>
                <th className="num">Covers</th>
                <th className="num">Net sales</th>
                <th className="num">Avg per cover</th>
              </tr>
            </thead>
            <tbody>
              {covers.map((r) => (
                <tr key={r.orderType}>
                  <td>{r.orderType}</td>
                  <td className="num">{r.checks}</td>
                  <td className="num">{r.covers}</td>
                  <td className="num">{money(r.netSales)}</td>
                  <td className="num">{money(r.avgPerCover)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{merged.checks}</td>
                <td className="num">{merged.covers}</td>
                <td className="num">{money(merged.netSales)}</td>
                <td className="num">{money(merged.covers ? Math.round(merged.netSales / merged.covers) : 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : tab === "sales" ? (
        <div className="grid cols-2">
          <div className="card">
            <div className="card-head"><h3>By category</h3></div>
            <div className="card-body stack tight">
              {byCat.map((r) => (
                <div key={r.key} className="stack tight">
                  <div className="row between small"><span>{r.label}</span><span className="num">{money(r.amount)} · {pct(r.pctBp, 0)}</span></div>
                  <Bar value={r.amount} max={byCat[0]?.amount ?? 1} />
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>By hour (checks closed)</h3></div>
            <div className="card-body">
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 160 }}>
                {byHour.map((h) => (
                  <div key={h.key} title={`${h.label}: ${money(h.amount)} (${h.qty} checks)`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", height: Math.max(3, (h.amount / maxHour) * 130), background: "var(--brand)", borderRadius: 5 }} />
                    <span className="tiny muted">{h.key}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>By order type</h3></div>
            <div className="card-body stack tight">
              {covers.map((r) => (
                <div key={r.orderType} className="row between small"><span>{r.orderType}</span><span className="num">{money(r.netSales)}</span></div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Payments</h3></div>
            <div className="card-body stack tight">
              {byTender.map((r) => (
                <div key={r.key} className="row between small"><span>{r.label} ({r.qty})</span><span className="num">{money(r.amount)}</span></div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="card table-wrap fill-card">
          <div className="card-head"><h3>Checks closed on {to}</h3></div>
          {!checks ? (
            <Loading />
          ) : phone ? (
            <PhoneList
              rows={checks
                .filter((c) => c.status === "closed")
                .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
                .map((c) => ({
                  key: c.id,
                  title: c.invoiceNo ?? c.id,
                  sub: [timeColombo(c.closedAt), orderTypes.find((o) => o.id === c.orderTypeId)?.name ?? c.orderTypeId, c.payments.map((p) => tenders.find((t) => t.id === p.tenderId)?.name ?? p.tenderId).join(", ")].filter(Boolean).join(" · "),
                  value: money(c.totals?.amountDue),
                  valueSub: `${c.covers} cover${c.covers === 1 ? "" : "s"}`,
                }))}
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Closed</th>
                  <th>Type</th>
                  <th className="num">Covers</th>
                  <th className="num">Items</th>
                  <th className="num">Total</th>
                  <th>Paid by</th>
                </tr>
              </thead>
              <tbody>
                {checks.filter((c) => c.status === "closed").sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")).map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.invoiceNo}</td>
                    <td>{timeColombo(c.closedAt)}</td>
                    <td>{orderTypes.find((o) => o.id === c.orderTypeId)?.name ?? c.orderTypeId}</td>
                    <td className="num">{c.covers}</td>
                    <td className="num">{c.lines.filter((l) => !l.voided).reduce((a, l) => a + l.qty, 0)}</td>
                    <td className="num">{money(c.totals?.amountDue)}</td>
                    <td>{c.payments.map((p) => tenders.find((t) => t.id === p.tenderId)?.name ?? p.tenderId).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {wa ? (
        <Modal title="WhatsApp end-of-day report (simulated)" onClose={() => setWa(null)}>
          <div className="stack">
            <div className="callout">
              Mode: <strong>{settings.integrations.whatsapp.mode}</strong>. Logged for {settings.integrations.whatsapp.eodRecipients.map((r) => r.name).join(", ")}. Real delivery starts once the WhatsApp Business number and the “eod_report” template are approved by Meta.
            </div>
            <div style={{ background: "#e7ffdb", color: "#111", borderRadius: 12, padding: 14, whiteSpace: "pre-wrap", fontSize: 14 }}>{wa}</div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function MenuEngineering() {
  const { propertyId } = useProperty();
  const today = todayColombo();
  const [days, setDays] = useState(30);
  const stats = useStats(propertyId, addDays(today, -(days - 1)), today);
  const menuItems = useCollection<MenuItem>(C.menuItems) ?? [];
  const rows = useMemo(() => menuEngineering(mergeStats(stats ?? []), menuItems), [stats, menuItems]);
  const advice: Record<string, string> = {
    Star: "Keep: protect quality and placement.",
    Plowhorse: "Popular, low margin: review portion cost or nudge the price.",
    Puzzle: "Profitable but slow: promote, rename or reposition on the menu.",
    Dog: "Low on both: rework or remove.",
  };
  const tone: Record<string, string> = { Star: "good", Plowhorse: "info", Puzzle: "warn", Dog: "bad" };
  return (
    <div className="page">
      <PageHead
        title="Menu engineering"
        subtitle="Each item's popularity (sales mix) against its contribution margin (net price minus recipe cost)."
        actions={<Seg value={String(days)} onChange={(v) => setDays(Number(v))} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />}
      />
      <div className="grid cols-4">
        {(["Star", "Plowhorse", "Puzzle", "Dog"] as const).map((k) => (
          <div key={k} className="card stat">
            <span className={`badge ${tone[k]}`} style={{ alignSelf: "flex-start" }}>{k}s</span>
            <span className="value">{rows.filter((r) => r.class === k).length}</span>
            <span className="small muted">{advice[k]}</span>
          </div>
        ))}
      </div>
      <div className="card table-wrap">
        {!stats ? (
          <Loading />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Sold</th>
                <th className="num">Mix</th>
                <th className="num">Margin / portion</th>
                <th>Popularity</th>
                <th>Profitability</th>
                <th>Class</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td>{r.name}</td>
                  <td className="num">{r.qty}</td>
                  <td className="num">{pct(r.mixPctBp)}</td>
                  <td className="num">{money(r.margin)}</td>
                  <td>{r.popularity}</td>
                  <td>{r.profitability}</td>
                  <td><span className={`badge ${tone[r.class]}`}>{r.class}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
