import { describe, expect, it } from "vitest";
import { type DailyStats, emptyDailyStats, insights } from "../src/index.js";

const money = (c: number) => `Rs ${Math.round(c / 100).toLocaleString("en-LK")}`;
const day = (date: string, o: { sales: number; checks?: number; covers?: number; voids?: number; discounts?: number; hours?: Record<string, number>; items?: Record<string, number> }): DailyStats => {
  const s = emptyDailyStats("MAIN", date);
  s.netSales = o.sales;
  s.checks = o.checks ?? 40;
  s.covers = o.covers ?? 60;
  s.voids = { qty: 1, amount: o.voids ?? 0 };
  s.discounts = o.discounts ?? 0;
  s.hours = Object.fromEntries(Object.entries(o.hours ?? { "12": o.sales / 2, "19": o.sales / 2 }).map(([h, a]) => [h, { qty: 10, amount: a }]));
  s.items = Object.fromEntries(Object.entries(o.items ?? {}).map(([id, q]) => [id, { qty: q, amount: q * 100_000 }]));
  return s;
};
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const TODAY = "2026-11-13"; // a Friday

describe("insights", () => {
  it("compares today with a usual day of the same weekday, up to the hour", () => {
    const days = [7, 14, 21].map((n) => day(shift(TODAY, -n), { sales: 10_000_000, hours: { "11": 2_000_000, "12": 3_000_000, "19": 5_000_000 } }));
    days.push(day(TODAY, { sales: 7_000_000, hours: { "11": 3_000_000, "12": 4_000_000 } }));
    const r = insights({ today: TODAY, hour: 13, days, money });
    const pace = r.find((i) => i.key === "pace")!;
    expect(pace.title).toBe("Sales are 40% above a usual Friday");
    expect(pace.tone).toBe("good");
    expect(pace.detail).toContain("by 1 pm");
  });
  it("says nothing about the pace without enough history or early in the day", () => {
    const days = [day(shift(TODAY, -7), { sales: 10_000_000 }), day(TODAY, { sales: 1_000_000 })];
    expect(insights({ today: TODAY, hour: 13, days, money }).find((i) => i.key === "pace")).toBeUndefined();
    const more = [7, 14].map((n) => day(shift(TODAY, -n), { sales: 10_000_000 }));
    expect(insights({ today: TODAY, hour: 8, days: [...more, day(TODAY, { sales: 100 })], money }).find((i) => i.key === "pace")).toBeUndefined();
  });
  it("flags a slow yesterday, unusual voids and a dish selling less", () => {
    const days: DailyStats[] = [];
    for (let n = 1; n <= 28; n++) days.push(day(shift(TODAY, -n), { sales: n === 1 ? 6_000_000 : 10_000_000, voids: n <= 6 ? 150_000 : 20_000, items: { K1: n <= 6 ? 2 : 6 } }));
    const r = insights({ today: TODAY, hour: 9, days, money, itemNames: { K1: "Chicken Kottu" }, limit: 10 });
    expect(r.find((i) => i.key === "yesterday")?.title).toBe("Yesterday was 40% slower than a usual Thursday");
    const voids = r.find((i) => i.key === "voids")!;
    expect(voids.tone).toBe("bad");
    expect(voids.title).toBe("Voids are 6.4× usual this week");
    expect(r.find((i) => i.key === "item-fall")?.title).toBe("Chicken Kottu is selling 71% less this week");
    // Problems first.
    expect(r[0]!.tone).toBe("bad");
  });
  it("keeps to a few insights and gives each a place to look", () => {
    const days: DailyStats[] = [];
    for (let n = 0; n <= 28; n++) days.push(day(shift(TODAY, -n), { sales: n === 0 ? 20_000_000 : n === 1 ? 2_000_000 : 10_000_000, voids: n <= 7 ? 500_000 : 10_000, discounts: n <= 7 ? 2_000_000 : 50_000, hours: { "12": n === 0 ? 20_000_000 : 5_000_000, "19": n === 0 ? 0 : 5_000_000 } }));
    const r = insights({ today: TODAY, hour: 14, days, money });
    expect(r.length).toBe(4);
    expect(r.filter((i) => i.tone !== "info").every((i) => i.action?.to.startsWith("/emc/"))).toBe(true);
  });
});
