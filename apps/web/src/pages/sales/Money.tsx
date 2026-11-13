import { useState } from "react";
import { type Cheque, type CodSettlement, type Courier, type OrderPayment, type SalesOrder, WHOLESALE, codSettlementFor, newId, nextDocNumber, paymentState } from "@pos/core";
import { Empty, Loading, ModuleOff, PageHead, Seg, Stat } from "../../components/ui";
import { dateColombo, money, todayColombo } from "../../lib/format";
import { useWhatsApp } from "../../lib/whatsapp";
import { useApp, useCollection, useStore } from "../../state/app";
import { useSalesData } from "./shared";

type Tab = "owed" | "cod" | "cheques";

export function SalesMoneyPage() {
  const { on } = useApp();
  const data = useSalesData();
  const couriers = useCollection<Courier>(WHOLESALE.couriers);
  const cheques = useCollection<Cheque>(WHOLESALE.cheques);
  const settlements = useCollection<CodSettlement>(WHOLESALE.codSettlements);
  const [tab, setTab] = useState<Tab>("owed");
  if (!on("wholesale")) return <ModuleOff name="Sales & Orders" />;
  if (!data.ready || !couriers || !cheques || !settlements) return <div className="page"><Loading /></div>;
  const owed = data.orders.filter((o) => (o.status === "dispatched" || o.status === "delivered") && o.total > o.paid);
  const codOut = data.orders.filter((o) => o.delivery?.cod && (o.status === "dispatched" || o.status === "delivered") && !o.payments.some((p) => p.method === "cod" && p.status !== "rejected"));
  const inHand = cheques.filter((c) => c.status === "received" || c.status === "deposited");
  return (
    <div className="page">
      <PageHead title="Payments & COD" subtitle="What customers owe, cash collected by couriers and cheques. Settling a courier or clearing a cheque confirms the payments on the orders and posts them to the books." />
      <div className="stats">
        <Stat label="Owed by customers" value={money(owed.reduce((a, o) => a + o.total - o.paid, 0))} sub={`${owed.length} invoices`} />
        <Stat label="Cash with couriers" value={money(codOut.reduce((a, o) => a + (o.delivery?.codAmount ?? o.total - o.paid), 0))} sub={`${codOut.length} parcels`} />
        <Stat label="Cheques in hand" value={money(inHand.reduce((a, c) => a + c.amount, 0))} sub={`${inHand.length} cheques`} />
      </div>
      <div style={{ margin: "12px 0" }}>
        <Seg<Tab> value={tab} onChange={setTab} options={[{ value: "owed", label: "Owed" }, { value: "cod", label: "Courier COD" }, { value: "cheques", label: "Cheques" }]} />
      </div>
      {tab === "owed" ? <Owed orders={owed} /> : tab === "cod" ? <Cod orders={codOut} couriers={couriers} settlements={settlements} /> : <Cheques cheques={cheques} orders={data.orders} />}
    </div>
  );
}

function Owed({ orders }: { orders: SalesOrder[] }) {
  const { on, toast } = useApp();
  const wa = useWhatsApp();
  const today = todayColombo();
  const byCustomer = new Map<string, SalesOrder[]>();
  for (const o of orders) byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o]);
  const rows = [...byCustomer.values()]
    .map((list) => ({ name: list[0]!.customerName, list, due: list.reduce((a, o) => a + o.total - o.paid, 0), oldest: list.map((o) => o.dueDate ?? o.date).sort()[0]! }))
    .sort((a, b) => a.oldest.localeCompare(b.oldest));
  if (!rows.length) return <div className="card"><Empty title="Nobody owes you anything" /></div>;
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead><tr><th>Customer</th><th>Invoices</th><th>Oldest due</th><th className="num">Owed</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const late = Math.round((Date.parse(today) - Date.parse(r.oldest)) / 86_400_000);
            return (
              <tr key={r.list[0]!.customerId}>
                <td>{r.name}</td>
                <td className="small">{r.list.map((o) => o.invoiceNo ?? o.number).join(", ")}</td>
                <td>{dateColombo(r.oldest)} {late > 0 ? <span className="badge bad">{late} days late</span> : null}</td>
                <td className="num">{money(r.due)}</td>
                <td>{on("whatsappCommerce") ? <button className="btn small" onClick={() => wa({ action: "orderMessage", orderId: r.list[0]!.id, kind: "reminder" }).then(() => toast("Reminder sent")).catch((e: Error) => toast(e.message, true))}>Remind on WhatsApp</button> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cod({ orders, couriers, settlements }: { orders: SalesOrder[]; couriers: Courier[]; settlements: CodSettlement[] }) {
  const { toast, user, on, ledger } = useApp();
  const store = useStore();
  const [courierId, setCourierId] = useState(couriers[0]?.id ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const courier = couriers.find((c) => c.id === courierId);
  const mine = orders.filter((o) => o.delivery?.courierId === courierId);
  const chosen = mine.filter((o) => picked.has(o.id));
  const sum = courier ? codSettlementFor(courier, chosen) : { collected: 0, fees: 0, net: 0 };

  async function settle() {
    if (!courier || !chosen.length || busy) return;
    setBusy(true);
    try {
      const at = new Date().toISOString();
      const by = user?.name ?? "staff";
      const today = todayColombo();
      for (const o of chosen) {
        const amount = o.delivery?.codAmount ?? o.total - o.paid;
        const fee = codSettlementFor(courier, [o]).fees;
        const p: OrderPayment = { id: newId(), method: "cod", amount, at, by, reference: `${courier.name}${reference ? ` ${reference}` : ""}`, status: "pending" };
        const payments = [...o.payments, p];
        await store.merge(WHOLESALE.salesOrders, o.id, { payments, ...paymentState(o.total, payments), updatedAt: at });
        if (on("accounting")) await ledger({ action: "postSalesOrder", orderId: o.id, event: "payment", paymentId: p.id, date: today, fees: fee });
        else {
          const done = payments.map((x) => (x.id === p.id ? { ...x, status: "confirmed" as const } : x));
          await store.merge(WHOLESALE.salesOrders, o.id, { payments: done, ...paymentState(o.total, done) });
        }
      }
      const s: CodSettlement = { id: await nextDocNumber(store, "CS"), courierId: courier.id, date: today, orderIds: chosen.map((o) => o.id), ...sum, ...(reference ? { reference } : {}), by, at };
      await store.set(WHOLESALE.codSettlements, s);
      toast(`${s.id}: ${money(sum.net)} from ${courier.name} for ${chosen.length} parcels`);
      setPicked(new Set());
      setReference("");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  if (!couriers.length) return <div className="card"><Empty title="No couriers yet"><p>Add your delivery companies under Couriers.</p></Empty></div>;
  return (
    <div className="stack">
      <div className="card pad">
        <div className="row wrap">
          <select className="input" value={courierId} onChange={(e) => { setCourierId(e.target.value); setPicked(new Set()); }} aria-label="Courier">
            {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="grow small muted">Tick the parcels in the courier's payment statement.</span>
        </div>
        {mine.length === 0 ? <Empty title="No cash on delivery waiting from this courier" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th /><th>Order</th><th>Customer</th><th>Tracking</th><th className="num">COD</th></tr></thead>
              <tbody>
                {mine.map((o) => (
                  <tr key={o.id}>
                    <td><input type="checkbox" checked={picked.has(o.id)} aria-label={`Settle ${o.number}`} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(o.id); else n.delete(o.id); setPicked(n); }} /></td>
                    <td className="mono">{o.number}</td>
                    <td>{o.customerName}</td>
                    <td>{o.delivery?.trackingNo ?? "—"}</td>
                    <td className="num">{money(o.delivery?.codAmount ?? o.total - o.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {chosen.length ? (
          <div className="row wrap" data-testid="cod-summary">
            <span className="grow">Collected {money(sum.collected)} · fees {money(sum.fees)} · <b>to the bank {money(sum.net)}</b></span>
            <input className="input" placeholder="Statement / transfer ref." value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Settlement reference" />
            <button className="btn primary" disabled={busy} onClick={settle}>Record settlement</button>
          </div>
        ) : null}
      </div>
      {settlements.length ? (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Settlement</th><th>Courier</th><th>Date</th><th className="num">Parcels</th><th className="num">Collected</th><th className="num">Fees</th><th className="num">Net</th></tr></thead>
            <tbody>{[...settlements].sort((a, b) => b.at.localeCompare(a.at)).map((s) => <tr key={s.id}><td className="mono">{s.id}</td><td>{couriers.find((c) => c.id === s.courierId)?.name ?? s.courierId}</td><td>{dateColombo(s.date)}</td><td className="num">{s.orderIds.length}</td><td className="num">{money(s.collected)}</td><td className="num">{money(s.fees)}</td><td className="num">{money(s.net)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Cheques({ cheques, orders }: { cheques: Cheque[]; orders: SalesOrder[] }) {
  const { toast, on, ledger } = useApp();
  const store = useStore();
  const today = todayColombo();
  async function set(c: Cheque, status: Cheque["status"]) {
    try {
      if (status === "deposited" && c.chequeDate > today) throw new Error(`this cheque is dated ${dateColombo(c.chequeDate)}: it can't be banked before then`);
      const at = new Date().toISOString();
      await store.merge(WHOLESALE.cheques, c.id, { status, ...(status === "deposited" ? { depositedAt: at } : status === "cleared" ? { clearedAt: at } : status === "bounced" ? { bouncedAt: at } : {}) });
      const o = orders.find((x) => x.id === c.orderId);
      const p = o?.payments.find((x) => x.chequeId === c.id);
      if (o && p && p.status === "pending" && (status === "cleared" || status === "bounced")) {
        if (status === "cleared" && on("accounting")) await ledger({ action: "postSalesOrder", orderId: o.id, event: "payment", paymentId: p.id, date: today });
        else {
          const payments = o.payments.map((x) => (x.id === p.id ? { ...x, status: status === "cleared" ? ("confirmed" as const) : ("rejected" as const) } : x));
          await store.merge(WHOLESALE.salesOrders, o.id, { payments, ...paymentState(o.total, payments), updatedAt: at });
        }
      }
      toast(status === "bounced" ? `Cheque ${c.number} bounced: the order shows as unpaid again` : `Cheque ${c.number} ${status}`, status === "bounced");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }
  if (!cheques.length) return <div className="card"><Empty title="No cheques"><p>Cheques recorded as payments on orders appear here.</p></Empty></div>;
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead><tr><th>Cheque</th><th>Customer</th><th>Date on cheque</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
        <tbody>
          {[...cheques].sort((a, b) => a.chequeDate.localeCompare(b.chequeDate)).map((c) => (
            <tr key={c.id}>
              <td>{c.bank} <span className="mono">{c.number}</span></td>
              <td>{orders.find((o) => o.id === c.orderId)?.customerName ?? c.customerId}</td>
              <td>{dateColombo(c.chequeDate)} {c.chequeDate > today ? <span className="badge warn">post-dated</span> : null}</td>
              <td className="num">{money(c.amount)}</td>
              <td><span className={`badge ${c.status === "cleared" ? "good" : c.status === "bounced" ? "bad" : ""}`}>{c.status}</span></td>
              <td className="row">
                {c.status === "received" ? <button className="btn small" onClick={() => set(c, "deposited")}>Deposited</button> : null}
                {c.status === "deposited" ? <><button className="btn small primary" onClick={() => set(c, "cleared")}>Cleared</button><button className="btn small ghost" onClick={() => set(c, "bounced")}>Bounced</button></> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
