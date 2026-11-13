/**
 * WhatsApp Business from the app: the whatsappApi Cloud Function on a live system; in the local demo
 * the same @pos/core code runs on the local data and messages are marked "simulated".
 */
import { useCallback } from "react";
import {
  type Customer,
  type SalesOrder,
  type WaConversation,
  type WaInbound,
  type WaMessage,
  type WhatsappApiRequest,
  COLLECTIONS as C,
  WA,
  WHOLESALE,
  broadcastAudience,
  handleInbound,
  inServiceWindow,
  newId,
  orderMessage,
  recordOutbound,
} from "@pos/core";
import { httpsCallable } from "firebase/functions";
import { useApp } from "../state/app";
import { firebase } from "./firebase";

type Req = WhatsappApiRequest extends infer R ? (R extends { tenantId: string } ? Omit<R, "tenantId"> : never) : never;

export interface WaStatus {
  accessToken: boolean;
  appSecret: boolean;
  verifyToken: boolean;
  live: boolean;
  phoneNumberId: string;
}

export function useWhatsApp() {
  const { mode, tenant, store, settings, user } = useApp();
  return useCallback(
    async <T = unknown>(req: Req): Promise<T> => {
      if (!tenant || !store) throw new Error("no business selected");
      if (mode === "firebase") {
        try {
          return (await httpsCallable(firebase().functions, "whatsappApi", { timeout: 300_000 })({ tenantId: tenant.id, ...req })).data as T;
        } catch (e) {
          throw new Error((e as { message?: string }).message?.replace(/^.*?:\s*/, "") || "WhatsApp could not complete this");
        }
      }
      const wa = settings.integrations.whatsapp;
      const businessName = settings.business.tradingName || settings.business.legalName;
      const vatRateBp = settings.business.vatRegistered ? settings.tax.vatRate : 0;
      const by = user?.name ?? "Demo";
      const now = new Date();
      switch (req.action) {
        case "status":
          return { accessToken: false, appSecret: false, verifyToken: false, live: false, phoneNumberId: wa.phoneNumberId } as T;
        case "connect":
        case "disconnect":
        case "syncCatalogue":
        case "media":
          throw new Error("this needs the live system connected to Meta (the local demo simulates WhatsApp)");
        case "send": {
          const conv = await store.get<WaConversation>(WA.conversations, req.conversationId);
          if (!conv) throw new Error("conversation not found");
          if (req.message.kind !== "template" && !inServiceWindow(conv, now)) throw new Error("more than 24 hours since the customer's last message: send an approved template instead");
          const m = await recordOutbound(store, conv.id, req.message, { status: "simulated", by }, now);
          await store.merge(WA.conversations, conv.id, { mode: "human", unread: 0, ...(user ? { assignedTo: user.uid } : {}) });
          return m as T;
        }
        case "orderMessage": {
          const o = await store.get<SalesOrder>(WHOLESALE.salesOrders, req.orderId);
          if (!o) throw new Error("order not found");
          const customer = await store.get<Customer>(C.customers, o.customerId);
          const to = o.conversationId ?? customer?.whatsapp;
          if (!to) throw new Error("this customer has no WhatsApp number");
          const conv = await store.get<WaConversation>(WA.conversations, to);
          const built = orderMessage(req.kind, o, { businessName, inWindow: Boolean(conv && inServiceWindow(conv, now)), ...(wa.templates ? { templates: wa.templates } : {}), ...(wa.templateLanguage ? { language: wa.templateLanguage } : {}) });
          if (!built.message) throw new Error(`the customer last wrote more than 24 hours ago: set up the approved template "${built.needsTemplate}" in WhatsApp settings`);
          return (await recordOutbound(store, to, built.message, { status: "simulated", by, orderId: o.id }, now)) as T;
        }
        case "simulate": {
          const from = String(req.message.from).replace(/\D/g, "");
          const msg = { ...req.message, from, id: `sim.${newId()}`, at: now.toISOString() } as WaInbound;
          const r = await handleInbound(store, msg, { settings: wa, businessName, vatRateBp, paymentLink: settings.integrations.payhere.mode === "live", now });
          for (const reply of r.replies) await recordOutbound(store, from, reply, { status: "simulated" }, new Date());
          return { replies: r.replies, orderId: r.order?.id ?? null } as T;
        }
        case "broadcast": {
          const message = { kind: "template" as const, name: req.template, params: req.params, ...(wa.templateLanguage ? { language: wa.templateLanguage } : {}) };
          if (req.test) return { test: await recordOutbound(store, req.test.replace(/\D/g, ""), message, { status: "simulated", by }, now) } as T;
          const audience = broadcastAudience(await store.list<Customer>(C.customers), req.segment);
          for (const c of audience) await recordOutbound(store, c.whatsapp!, message, { status: "simulated", by }, now);
          const b = { id: newId(), name: req.name || req.template, template: req.template, params: req.params, segment: req.segment, at: now.toISOString(), by, recipients: audience.length, sent: audience.length, failed: 0, simulated: true };
          await store.set(WA.broadcasts, b);
          return b as T;
        }
      }
    },
    [mode, tenant, store, settings, user],
  );
}

/** Status ticks for a message we sent. */
export function tick(m: Pick<WaMessage, "status" | "direction">): string {
  if (m.direction === "in") return "";
  return m.status === "read" ? "✓✓ read" : m.status === "delivered" ? "✓✓" : m.status === "sent" ? "✓" : m.status === "failed" ? "⚠ not sent" : m.status === "simulated" ? "simulated" : "…";
}
