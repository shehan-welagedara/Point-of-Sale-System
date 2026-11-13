import { useMemo } from "react";
import {
  type Customer,
  type Location,
  type OrderStatus,
  type PriceList,
  type SalesOrder,
  type StockLevel,
  type Style,
  COLLECTIONS as C,
  WHOLESALE,
  availableToPromise,
} from "@pos/core";
import { STARTER_PROPERTY_ID } from "@pos/sample-data";
import { useApp, useCollection } from "../../state/app";

export const STATUS: Record<OrderStatus, { label: string; tone: "" | "good" | "warn" | "bad" | "info" }> = {
  quotation: { label: "Quotation", tone: "info" },
  draft: { label: "New", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "" },
  packed: { label: "Packed", tone: "" },
  dispatched: { label: "On the way", tone: "info" },
  delivered: { label: "Delivered", tone: "good" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export const PAY_LABEL: Record<string, string> = { bank: "Bank transfer", link: "Payment link", cod: "Cash on delivery", cheque: "Cheque", cash: "Cash", card: "Card" };

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS[status];
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
}

export function PayBadge({ o }: { o: Pick<SalesOrder, "paymentStatus" | "payments" | "onCredit"> }) {
  const pending = o.payments.some((p) => p.status === "pending");
  if (o.paymentStatus === "paid") return <span className="badge good">Paid</span>;
  if (pending) return <span className="badge warn">Payment to check</span>;
  if (o.paymentStatus === "partial") return <span className="badge warn">Part paid</span>;
  return <span className="badge">{o.onCredit ? "On credit" : "Unpaid"}</span>;
}

export function useDefaultLocation(): string {
  const locs = useCollection<Location>(C.locations) ?? [];
  return locs.find((l) => l.isDefault)?.id ?? locs[0]?.id ?? "MAIN";
}

export function usePropertyId(): string {
  const { settings } = useApp();
  return settings.pos.defaultPropertyId ?? STARTER_PROPERTY_ID;
}

/** Everything the order screens need, loaded once. */
export function useSalesData() {
  const orders = useCollection<SalesOrder>(WHOLESALE.salesOrders);
  const styles = useCollection<Style>(WHOLESALE.styles);
  const customers = useCollection<Customer>(C.customers);
  const priceLists = useCollection<PriceList>(WHOLESALE.priceLists);
  const levels = useCollection<StockLevel>(C.stockLevels);
  const onHand = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of levels ?? []) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  }, [levels]);
  const available = useMemo(() => availableToPromise(onHand, orders ?? []), [onHand, orders]);
  const ready = Boolean(orders && styles && customers && priceLists && levels);
  return { ready, orders: orders ?? [], styles: styles ?? [], customers: customers ?? [], priceLists: priceLists ?? [], onHand, available };
}

/** What a customer owes on orders already sent (invoiced, unpaid). */
export function owingFor(customerId: string, orders: readonly SalesOrder[], except?: string): number {
  return orders
    .filter((o) => o.customerId === customerId && o.id !== except && (o.status === "dispatched" || o.status === "delivered" || (o.onCredit && (o.status === "confirmed" || o.status === "packed"))))
    .reduce((a, o) => a + Math.max(0, o.total - o.paid), 0);
}

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const SIDES = ["Front", "Back", "Left sleeve", "Right sleeve", "Neck label"];
