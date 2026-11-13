/**
 * Insights: what an owner should notice today, in plain words, from the daily figures the POS already
 * keeps (no extra data or set-up). Each insight says what happened, compared with what, and where to
 * look. Kept deliberately few (the four that matter most) so they are read, not skimmed.
 */
import type { Cents } from "@pos/engine";
import type { DailyStats } from "./types.js";

export interface Insight {
  key: string;
  tone: "good" | "warn" | "bad" | "info";
  title: string;
  detail: string;
  action?: { label: string; to: string };
}

export interface InsightInput {
  /** Today's business date (YYYY-MM-DD, Sri Lanka). */
  today: string;
  /** The hour now in Sri Lanka (0–23). */
  hour: number;
  /** Daily figures for the last five weeks (any properties; merged per date here). */
  days: readonly DailyStats[];
  /** Menu item names by id. */
  itemNames?: Record<string, string>;
  /** Formats cents as money ("Rs 12,500"). */
  money: (cents: Cents) => string;
  /** At most this many (default 4). */
  limit?: number;
}

const DAY = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100);
const clock = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} am` : `${h - 12} pm`);

interface Day {
  netSales: number;
  checks: number;
  covers: number;
  discounts: number;
  voids: number;
  hours: Record<string, number>;
  hourChecks: Record<string, number>;
  items: Record<string, number>;
}

function byDate(days: readonly DailyStats[]): Map<string, Day> {
  const out = new Map<string, Day>();
  for (const s of days) {
    const d = out.get(s.businessDate) ?? { netSales: 0, checks: 0, covers: 0, discounts: 0, voids: 0, hours: {}, hourChecks: {}, items: {} };
    d.netSales += s.netSales ?? 0;
    d.checks += s.checks ?? 0;
    d.covers += s.covers ?? 0;
    d.discounts += s.discounts ?? 0;
    d.voids += s.voids?.amount ?? 0;
    for (const [h, v] of Object.entries(s.hours ?? {})) {
      d.hours[h] = (d.hours[h] ?? 0) + (v.amount ?? 0);
      d.hourChecks[h] = (d.hourChecks[h] ?? 0) + (v.qty ?? 0);
    }
    for (const [id, v] of Object.entries(s.items ?? {})) d.items[id] = (d.items[id] ?? 0) + (v.qty ?? 0);
    out.set(s.businessDate, d);
  }
  return out;
}

const sumBefore = (d: Day, hour: number) => Object.entries(d.hours).reduce((n, [h, v]) => (Number(h) < hour ? n + v : n), 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function insights(input: InsightInput): Insight[] {
  const { today, hour, money } = input;
  const days = byDate(input.days);
  const out: Insight[] = [];
  const sameWeekday = (date: string) => [7, 14, 21, 28].map((n) => days.get(shift(date, -n))).filter((d): d is Day => Boolean(d && d.netSales > 0));

  // 1. Today's pace against a usual day of the same weekday, up to the last full hour.
  const t = days.get(today);
  const usualToday = sameWeekday(today);
  if (t && hour >= 10 && usualToday.length >= 2) {
    const now = sumBefore(t, hour);
    const usual = avg(usualToday.map((d) => sumBefore(d, hour)));
    if (usual > 0 && now > 0) {
      const p = pct(now, usual);
      if (Math.abs(p) >= 15) {
        out.push({
          key: "pace",
          tone: p > 0 ? "good" : "warn",
          title: `Sales are ${Math.abs(p)}% ${p > 0 ? "above" : "below"} a usual ${weekday(today)}`,
          detail: `${money(now)} by ${clock(hour)}, against ${money(Math.round(usual))} on recent ${weekday(today)}s.`,
          action: { label: "Today's sales", to: "/emc/reports" },
        });
      }
    }
  }

  // 2. Yesterday against a usual day of its weekday.
  const yDate = shift(today, -1);
  const y = days.get(yDate);
  const usualY = sameWeekday(yDate);
  if (y && y.netSales > 0 && usualY.length >= 2) {
    const usual = avg(usualY.map((d) => d.netSales));
    const p = pct(y.netSales, usual);
    if (Math.abs(p) >= 10) {
      out.push({
        key: "yesterday",
        tone: p > 0 ? "good" : "warn",
        title: `Yesterday was ${Math.abs(p)}% ${p > 0 ? "better" : "slower"} than a usual ${weekday(yDate)}`,
        detail: `${money(y.netSales)} from ${y.checks} check${y.checks === 1 ? "" : "s"}, against ${money(Math.round(usual))} on recent ${weekday(yDate)}s.`,
        action: { label: "Daily sales", to: "/emc/reports" },
      });
    }
  }

  // 3. Voids and discounts well above usual (last 7 days against the 21 before).
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => days.get(shift(today, -(from + i)))).filter((d): d is Day => Boolean(d));
  const recent = range(0, 6);
  const before = range(7, 27);
  for (const [k, label, min] of [["voids", "Voids", 200_000], ["discounts", "Discounts", 500_000]] as const) {
    const now = recent.reduce((n, d) => n + d[k], 0);
    const usual = before.length >= 7 ? (before.reduce((n, d) => n + d[k], 0) / before.length) * 7 : 0;
    if (usual > 0 && now >= min && now >= usual * 2) {
      out.push({
        key: k,
        tone: "bad",
        title: `${label} are ${(now / usual).toFixed(1)}× usual this week`,
        detail: `${money(now)} in the last 7 days, against about ${money(Math.round(usual))} in a usual week. See who did them and why.`,
        action: { label: "POS journal", to: "/emc/audit" },
      });
    }
  }

  // 4. A dish selling much more, or much less, this week than last.
  const names = input.itemNames ?? {};
  const qty = (ds: Day[]) => {
    const m: Record<string, number> = {};
    for (const d of ds) for (const [id, q] of Object.entries(d.items)) m[id] = (m[id] ?? 0) + q;
    return m;
  };
  const thisWeek = qty(recent);
  const lastWeek = qty(range(7, 13));
  let rise: [string, number, number, number] | null = null;
  let fall: [string, number, number, number] | null = null;
  for (const id of new Set([...Object.keys(thisWeek), ...Object.keys(lastWeek)])) {
    const a = thisWeek[id] ?? 0;
    const b = lastWeek[id] ?? 0;
    if (b < 10 || !names[id]) continue;
    const p = pct(a, b);
    if (p >= 30 && (!rise || p > rise[1])) rise = [id, p, a, b];
    if (p <= -30 && (!fall || p < fall[1])) fall = [id, p, a, b];
  }
  if (fall) out.push({ key: "item-fall", tone: "warn", title: `${names[fall[0]]} is selling ${Math.abs(fall[1])}% less this week`, detail: `${fall[2]} sold in the last 7 days, against ${fall[3]} the week before. Check its price, quality and whether it was available.`, action: { label: "Menu engineering", to: "/emc/revenue/engineering" } });
  if (rise) out.push({ key: "item-rise", tone: "good", title: `${names[rise[0]]} is selling ${rise[1]}% more this week`, detail: `${rise[2]} sold in the last 7 days, against ${rise[3]} the week before. Make sure its ingredients are in stock.`, action: { label: "Stock", to: "/emc/inventory/stock" } });

  // 5. Spend per guest this week against last week.
  const covers = (ds: Day[]) => ds.reduce((n, d) => n + d.covers, 0);
  const sales = (ds: Day[]) => ds.reduce((n, d) => n + d.netSales, 0);
  const prev = range(7, 13);
  if (covers(recent) >= 20 && covers(prev) >= 20) {
    const a = sales(recent) / covers(recent);
    const b = sales(prev) / covers(prev);
    const p = pct(a, b);
    if (Math.abs(p) >= 8) out.push({ key: "spend", tone: p > 0 ? "good" : "warn", title: `Spend per guest is ${p > 0 ? "up" : "down"} ${Math.abs(p)}% this week`, detail: `${money(Math.round(a))} a guest in the last 7 days, against ${money(Math.round(b))} the week before.`, action: { label: "Covers", to: "/emc/reports" } });
  }

  // 6. Today's busiest hour still to come (staffing and prep).
  if (usualToday.length >= 2) {
    const byHour: Record<string, number[]> = {};
    for (const d of usualToday) for (const [h, v] of Object.entries(d.hours)) (byHour[h] ??= []).push(v);
    const peak = Object.entries(byHour).map(([h, vs]) => [Number(h), vs.reduce((a, b) => a + b, 0) / usualToday.length] as const).sort((a, b) => b[1] - a[1])[0];
    if (peak && peak[0] >= hour && peak[1] > 0) {
      const checks = avg(usualToday.map((d) => d.hourChecks[String(peak[0]).padStart(2, "0")] ?? 0));
      out.push({ key: "peak", tone: "info", title: `Busiest hour on ${weekday(today)}s: ${clock(peak[0])}`, detail: `About ${Math.round(checks)} check${Math.round(checks) === 1 ? "" : "s"} and ${money(Math.round(peak[1]))} between ${String(peak[0]).padStart(2, "0")}:00 and ${String((peak[0] + 1) % 24).padStart(2, "0")}:00 on recent ${weekday(today)}s. Plan staff and prep for it.` });
    }
  }

  const order = { bad: 0, warn: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, input.limit ?? 4);
}
