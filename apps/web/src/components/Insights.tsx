import { type DailyStats, type Insight, type MenuItem, COLLECTIONS as C, addDays, insights } from "@pos/core";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { money, todayColombo } from "../lib/format";
import { useCollection } from "../state/app";

const ICON: Record<Insight["tone"], string> = { good: "▲", warn: "▼", bad: "!", info: "◷" };

const hourColombo = () => Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", hour12: false })) % 24;

/** The few things worth noticing today, from five weeks of daily figures. */
export function useInsights(stats: DailyStats[] | undefined, enabled: boolean): Insight[] {
  const menuItems = useCollection<MenuItem>(enabled ? C.menuItems : null);
  return useMemo(() => {
    if (!enabled || !stats?.length) return [];
    const itemNames = Object.fromEntries((menuItems ?? []).map((m) => [m.id, m.name]));
    return insights({ today: todayColombo(), hour: hourColombo(), days: stats, itemNames, money });
  }, [stats, menuItems, enabled]);
}

/** Five weeks back from today: enough for "a usual Friday" and this week against last. */
export const insightRange = () => ({ from: addDays(todayColombo(), -34), to: todayColombo() });

export function InsightList({ items, title = "Worth knowing" }: { items: Insight[]; title?: string }) {
  if (!items.length) return null;
  return (
    <section className="stack tight insights" aria-label={title} data-testid="insights">
      <h2 className="insights-title">{title}</h2>
      <div className="insight-list">
        {items.map((i) => (
          <div key={i.key} className={`insight ${i.tone}`}>
            <span className="insight-ico" aria-hidden="true">{ICON[i.tone]}</span>
            <div className="grow">
              <strong>{i.title}</strong>
              <span className="small muted">{i.detail}</span>
              {i.action ? <Link to={i.action.to} className="small insight-go">{i.action.label} →</Link> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
