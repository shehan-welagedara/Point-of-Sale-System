import type { Cents } from "@pos/engine";
import { COLLECTIONS as C, type DocStore } from "./store.js";
import type { DailyStats, MenuCategory, MenuItem, MoneyQty, OrderType, TenderMedia } from "./types.js";
import { emptyDailyStats } from "./pos.js";

/** Day totals for a property and date range (reads one small document per day). */
export async function loadStats(store: DocStore, propertyId: string, from: string, to: string): Promise<DailyStats[]> {
  return store.list<DailyStats>(C.dailyStats, {
    where: [
      ["propertyId", "==", propertyId],
      ["businessDate", ">=", from],
      ["businessDate", "<=", to],
    ],
    orderBy: ["businessDate", "asc"],
  });
}

function addMap<T extends MoneyQty>(into: Record<string, T>, from: Record<string, T> | undefined): void {
  for (const [k, v] of Object.entries(from ?? {})) {
    const cur = into[k] ?? ({ qty: 0, amount: 0 } as T);
    const merged: Record<string, number> = { ...(cur as unknown as Record<string, number>) };
    for (const [f, n] of Object.entries(v as unknown as Record<string, number>)) merged[f] = (merged[f] ?? 0) + n;
    into[k] = merged as unknown as T;
  }
}

/** Sums several days into one totals record. */
export function mergeStats(stats: readonly DailyStats[], propertyId = "all", label = "range"): DailyStats {
  const out = emptyDailyStats(propertyId, label);
  for (const s of stats) {
    for (const k of ["checks", "covers", "itemsTotal", "discounts", "netSales", "serviceCharge", "sscl", "tdl", "vat", "total", "rounding"] as const) {
      out[k] += s[k] ?? 0;
    }
    addMap(out.items, s.items);
    addMap(out.categories, s.categories);
    addMap(out.majorGroups, s.majorGroups);
    addMap(out.orderTypes, s.orderTypes);
    addMap(out.hours, s.hours);
    addMap(out.tenders, s.tenders);
    out.voids = { qty: out.voids.qty + (s.voids?.qty ?? 0), amount: out.voids.amount + (s.voids?.amount ?? 0) };
  }
  return out;
}

export interface DailyRevenueRow {
  date: string;
  checks: number;
  covers: number;
  grossSales: Cents;
  discounts: Cents;
  netSales: Cents;
  serviceCharge: Cents;
  sscl: Cents;
  vat: Cents;
  total: Cents;
  avgCheck: Cents;
  avgPerCover: Cents;
}

export function dailyRevenue(stats: readonly DailyStats[]): DailyRevenueRow[] {
  return stats.map((s) => ({
    date: s.businessDate,
    checks: s.checks,
    covers: s.covers,
    grossSales: s.itemsTotal,
    discounts: s.discounts,
    netSales: s.netSales,
    serviceCharge: s.serviceCharge,
    sscl: s.sscl + s.tdl,
    vat: s.vat,
    total: s.total,
    avgCheck: s.checks ? Math.round(s.total / s.checks) : 0,
    avgPerCover: s.covers ? Math.round(s.netSales / s.covers) : 0,
  }));
}

export interface ItemSalesRow {
  itemId: string;
  code: string;
  name: string;
  category: string;
  qty: number;
  netSales: Cents;
  mixPctBp: number;
  cost: Cents;
  grossProfit: Cents;
}

export function itemSales(merged: DailyStats, menuItems: readonly MenuItem[], categories: readonly MenuCategory[]): ItemSalesRow[] {
  const items = new Map(menuItems.map((m) => [m.id, m]));
  const cats = new Map(categories.map((c) => [c.id, c.name]));
  const total = Object.values(merged.items).reduce((a, v) => a + v.amount, 0);
  return Object.entries(merged.items)
    .map(([id, v]) => {
      const m = items.get(id);
      const cost = Math.round((m?.cost ?? 0) * v.qty);
      return {
        itemId: id,
        code: m?.code ?? id,
        name: m?.name ?? id,
        category: cats.get(m?.categoryId ?? "") ?? "—",
        qty: v.qty,
        netSales: v.amount,
        mixPctBp: total ? Math.round((v.amount / total) * 10_000) : 0,
        cost,
        grossProfit: v.amount - cost,
      };
    })
    .sort((a, b) => b.netSales - a.netSales);
}

export interface CoversRow {
  orderType: string;
  checks: number;
  covers: number;
  netSales: Cents;
  avgPerCover: Cents;
}

export function coversReport(merged: DailyStats, orderTypes: readonly OrderType[]): CoversRow[] {
  const names = new Map(orderTypes.map((o) => [o.id, o.name]));
  return Object.entries(merged.orderTypes).map(([id, v]) => {
    const covers = (v as MoneyQty & { covers?: number }).covers ?? 0;
    return { orderType: names.get(id) ?? id, checks: v.qty, covers, netSales: v.amount, avgPerCover: covers ? Math.round(v.amount / covers) : 0 };
  });
}

export interface BreakdownRow {
  key: string;
  label: string;
  qty: number;
  amount: Cents;
  pctBp: number;
}

export function breakdown(map: Record<string, MoneyQty>, label: (key: string) => string): BreakdownRow[] {
  const total = Object.values(map).reduce((a, v) => a + v.amount, 0);
  return Object.entries(map)
    .map(([key, v]) => ({ key, label: label(key), qty: v.qty, amount: v.amount, pctBp: total ? Math.round((v.amount / total) * 10_000) : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function salesByHour(merged: DailyStats): BreakdownRow[] {
  return breakdown(merged.hours, (h) => `${h}:00`).sort((a, b) => a.key.localeCompare(b.key));
}

export function tenderSummary(merged: DailyStats, tenders: readonly TenderMedia[]): BreakdownRow[] {
  const names = new Map(tenders.map((t) => [t.id, t.name]));
  return breakdown(merged.tenders, (k) => names.get(k) ?? k);
}

export type MenuClass = "Star" | "Plowhorse" | "Puzzle" | "Dog";

export interface MenuEngineeringRow {
  itemId: string;
  name: string;
  qty: number;
  mixPctBp: number;
  /** Contribution margin per portion (net price − cost). */
  margin: Cents;
  popularity: "High" | "Low";
  profitability: "High" | "Low";
  class: MenuClass;
}

/**
 * Kasavana & Smith menu engineering: popularity is high when an item's mix % is at least 70% of
 * an even share; profitability is high when its contribution margin is at least the weighted average.
 */
export function menuEngineering(merged: DailyStats, menuItems: readonly MenuItem[]): MenuEngineeringRow[] {
  const items = new Map(menuItems.map((m) => [m.id, m]));
  const rows = Object.entries(merged.items).filter(([id, v]) => v.qty > 0 && items.has(id));
  const totalQty = rows.reduce((a, [, v]) => a + v.qty, 0);
  if (!totalQty) return [];
  const margins = rows.map(([id, v]) => ({ id, v, margin: Math.round(v.amount / v.qty - (items.get(id)!.cost ?? 0)) }));
  const avgMargin = margins.reduce((a, m) => a + m.margin * m.v.qty, 0) / totalQty;
  const popularityThreshold = (1 / rows.length) * 0.7;
  return margins
    .map(({ id, v, margin }) => {
      const mix = v.qty / totalQty;
      const popular = mix >= popularityThreshold;
      const profitable = margin >= avgMargin;
      const cls: MenuClass = popular && profitable ? "Star" : popular ? "Plowhorse" : profitable ? "Puzzle" : "Dog";
      return {
        itemId: id,
        name: items.get(id)!.name,
        qty: v.qty,
        mixPctBp: Math.round(mix * 10_000),
        margin,
        popularity: popular ? ("High" as const) : ("Low" as const),
        profitability: profitable ? ("High" as const) : ("Low" as const),
        class: cls,
      };
    })
    .sort((a, b) => b.qty - a.qty);
}
