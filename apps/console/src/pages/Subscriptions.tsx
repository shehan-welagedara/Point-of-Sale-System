import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useConsole } from "../App";
import { Icon } from "../icons";
import { useGroup } from "../state";
import { type Payment, colomboMonth, date, monthlyLkr, rupees, rupeesShort, subscriptionState } from "../types";
import { Loading, PageHead, SubscriptionBadge } from "../ui";

const CYCLE: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", perpetual: "One-off (perpetual)" };

export function SubscriptionsPage() {
  const { clients } = useConsole();
  const payments = useGroup<Payment>("payments");
  const nav = useNavigate();
  const [filter, setFilter] = useState<"all" | "due" | "overdue">("all");
  if (!clients || !payments) return <Loading />;
  const now = new Date();
  const live = clients.filter((c) => c.status !== "cancelled");
  const state = (c: (typeof clients)[number]) => subscriptionState(c.subscription, now);
  const mrr = live.reduce((n, c) => n + monthlyLkr(c.subscription), 0);
  const month = colomboMonth(now);
  const collected = payments.filter((p) => p.date.startsWith(month)).reduce((n, p) => n + p.amount, 0);
  const due = live.filter((c) => state(c).state === "due");
  const overdue = live.filter((c) => state(c).state === "overdue");
  const amount = (list: typeof live) => list.reduce((n, c) => n + (c.subscription?.priceLkr ?? 0), 0);
  const rows = live
    .filter((c) => (filter === "all" ? true : state(c).state === filter))
    .sort((a, b) => (a.subscription?.paidUntil ?? "9999").localeCompare(b.subscription?.paidUntil ?? "9999"));
  const lastPay = (id: string) => payments.filter((p) => p.clientId === id).sort((a, b) => b.date.localeCompare(a.date))[0];
  const names = Object.fromEntries(clients.map((c) => [c.id, c.name]));
  const recent = [...payments].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)).slice(0, 12);
  const stats: [string, string, string][] = [
    ["Monthly recurring revenue", rupeesShort(mrr), "Every live subscription at its monthly amount"],
    ["Annual run rate", rupeesShort(mrr * 12), "Monthly recurring × 12"],
    ["Collected this month", rupeesShort(collected), `${payments.filter((p) => p.date.startsWith(month)).length} payment(s)`],
    ["Renewals due (14 days)", String(due.length), rupees(amount(due))],
    ["Overdue", String(overdue.length), rupees(amount(overdue))],
  ];
  return (
    <>
      <PageHead title="Subscriptions" sub="What each client pays, when it renews, and the payments you have recorded. Record a payment on the client's Subscription tab: it renews the licence too." />
      <div className="grid stats5">
        {stats.map(([l, v, s]) => (
          <div key={l} className="card stat">
            <div className="l">{l}</div>
            <div className="v">{v}</div>
            <div className="tiny muted">{s}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-head">
          <h2 className="grow">Subscriptions</h2>
          <div className="seg" role="tablist" aria-label="Show">
            {(["all", "due", "overdue"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "due" ? `Due (${due.length})` : `Overdue (${overdue.length})`}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Plan</th><th>Billing</th><th className="num">Price</th><th className="num hide-sm">Per month</th><th>Paid until</th><th>State</th><th className="hide-sm">Last payment</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const p = lastPay(c.id);
                return (
                  <tr key={c.id} className="click" onClick={() => nav(`/clients/${c.id}?tab=subscription`)}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.subscription ? <span className="badge brand">{c.subscription.plan}</span> : <span className="muted">Not set</span>}</td>
                    <td>{c.subscription ? CYCLE[c.subscription.cycle] : "—"}</td>
                    <td className="num">{c.subscription ? rupees(c.subscription.priceLkr) : "—"}</td>
                    <td className="num hide-sm">{c.subscription ? rupees(monthlyLkr(c.subscription)) : "—"}</td>
                    <td>{date(c.subscription?.paidUntil)}</td>
                    <td><SubscriptionBadge c={c} /></td>
                    <td className="hide-sm">{p ? `${rupees(p.amount)} · ${date(p.date)}` : "—"}</td>
                  </tr>
                );
              })}
              {!rows.length ? <tr><td colSpan={8} className="empty">{filter === "all" ? "No clients yet." : "Nothing here right now."}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2 className="grow">Latest payments</h2><span className="tiny muted">Recorded by your staff</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Client</th><th className="num">Amount</th><th>Method</th><th className="hide-sm">Reference</th><th>Paid until</th><th className="hide-sm">By</th></tr></thead>
            <tbody>
              {recent.map((p) => (
                <tr key={`${p.clientId}-${p.id}`}>
                  <td>{date(p.date)}</td>
                  <td>{p.clientId ? <Link to={`/clients/${p.clientId}?tab=subscription`}>{names[p.clientId] ?? p.clientId}</Link> : "—"}</td>
                  <td className="num">{rupees(p.amount)}</td>
                  <td>{p.method}</td>
                  <td className="hide-sm">{p.reference || "—"}</td>
                  <td>{date(p.paidUntil)}</td>
                  <td className="hide-sm tiny">{p.recordedBy}</td>
                </tr>
              ))}
              {!recent.length ? <tr><td colSpan={7} className="empty"><Icon name="pay" /> No payments recorded yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
