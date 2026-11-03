import type { Cents } from "@pos/engine";
import type { Asset } from "./types.js";

/** Months from period `a` to period `b` (YYYY-MM), inclusive of both ends minus one: same month = 0. */
export function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

export function addMonths(period: string, n: number): string {
  const total = Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Depreciation to post for `period`. Straight-line uses the cumulative target (cost − salvage) ×
 * months / life, so rounding never drifts and missed months are caught up automatically; written-
 * down value applies the annual rate monthly to net book value. Never depreciates below salvage.
 */
export function depreciationFor(asset: Asset, period: string): Cents {
  if (asset.status !== "active") return 0;
  const start = asset.availableDate.slice(0, 7);
  if (period < start) return 0;
  const depreciable = asset.cost - asset.salvageValue;
  const remaining = depreciable - asset.accumulatedDep;
  if (remaining <= 0) return 0;
  if (asset.method === "SL") {
    const months = Math.min(asset.usefulLifeMonths, monthsBetween(start, period) + 1);
    const target = Math.min(depreciable, Math.round((depreciable * months) / asset.usefulLifeMonths));
    return Math.max(0, Math.min(remaining, target - asset.accumulatedDep));
  }
  const rate = asset.wdvRateBp ?? 0;
  const nbv = asset.cost - asset.accumulatedDep;
  const amount = Math.round((nbv * rate) / 10_000 / 12);
  return Math.max(0, Math.min(remaining, amount));
}

export interface ScheduleRow {
  period: string;
  amount: Cents;
  accumulated: Cents;
  netBookValue: Cents;
}

export function depreciationSchedule(asset: Asset, maxMonths = 600): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let a: Asset = { ...asset, accumulatedDep: 0, status: "active" };
  let period = asset.availableDate.slice(0, 7);
  for (let i = 0; i < maxMonths; i++) {
    const amount = depreciationFor(a, period);
    if (amount <= 0 && a.accumulatedDep >= a.cost - a.salvageValue) break;
    if (amount <= 0 && asset.method === "WDV") break;
    a = { ...a, accumulatedDep: a.accumulatedDep + amount };
    rows.push({ period, amount, accumulated: a.accumulatedDep, netBookValue: a.cost - a.accumulatedDep });
    period = addMonths(period, 1);
  }
  return rows;
}

export function netBookValue(asset: Asset): Cents {
  return asset.cost - asset.accumulatedDep;
}
