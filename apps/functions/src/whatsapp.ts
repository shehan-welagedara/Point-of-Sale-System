/**
 * WhatsApp Business (Meta Cloud API) for selling — module "whatsappCommerce" (docs/25).
 *
 *  - whatsappWebhook (HTTPS): Meta calls it with every customer message and delivery status. GET is
 *    Meta's one-time verification (the verify token); POST must carry Meta's signature
 *    (X-Hub-Signature-256, HMAC-SHA256 of the body with the app secret) or it is refused. Messages
 *    go to the business that owns the number (waRouting/{phoneNumberId}); the ordering assistant
 *    (@pos/core whatsapp.ts) answers, and drafts orders for staff to confirm.
 *  - whatsappApi (callable): staff reply from the inbox, send order messages, sync the catalogue,
 *    send broadcasts, open a payment slip photo, save the connection (owner/admin), and try the
 *    assistant with a simulated customer before going live.
 *
 * The access token and app secret are kept in integrationSecrets/{tenantId}, which no app can read
 * (security rules); the inbox only learns whether they are set.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  type BusinessSettings,
  type Customer,
  type IntegrationSettings,
  type Member,
  type SalesOrder,
  type StockLevel,
  type Style,
  type TaxSettings,
  type Tenant,
  type WaConversation,
  type WaInbound,
  type WaMessage,
  type WaOutbound,
  type WhatsappApiRequest,
  COLLECTIONS as C,
  WA,
  WHOLESALE,
  broadcastAudience,
  catalogueItems,
  cloudPayload,
  handleInbound,
  inServiceWindow,
  isOn,
  newId,
  orderMessage,
  parseWebhook,
  recordOutbound,
} from "@pos/core";
import { AdminStore } from "./admin-store.js";

export type { WhatsappApiRequest };

export const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v23.0"}`;

export interface WaSecrets {
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
}

/** waRouting/{phoneNumberId}: which business owns a number (server only). */
interface Routing {
  tenantId: string;
  verifyToken?: string;
  updatedAt: string;
}

export interface WaDeps {
  fetch: typeof fetch;
  now: () => Date;
}

export class WhatsappError extends Error {
  constructor(
    public code: "invalid-argument" | "permission-denied" | "failed-precondition" | "not-found",
    message: string,
  ) {
    super(message);
  }
}

/** Meta's X-Hub-Signature-256 header: "sha256=" + HMAC-SHA256(body, app secret), compared in constant time. */
export function validSignature(raw: Buffer | string, header: string | undefined, appSecret: string | undefined): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", appSecret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return got.length === want.length && timingSafeEqual(got, want);
}

const secretsOf = async (db: Firestore, tenantId: string): Promise<WaSecrets> => ((await db.collection("integrationSecrets").doc(tenantId).get()).data()?.whatsapp ?? {}) as WaSecrets;

async function settingsOf(db: Firestore, tenantId: string) {
  const s = db.collection("tenants").doc(tenantId).collection("settings");
  const [integ, business, tax] = await Promise.all([s.doc("integrations").get(), s.doc("business").get(), s.doc("tax").get()]);
  const i = integ.data() as IntegrationSettings | undefined;
  const b = business.data() as BusinessSettings | undefined;
  const t = tax.data() as TaxSettings | undefined;
  return {
    wa: i?.whatsapp ?? { mode: "mock" as const, phoneNumberId: "", eodRecipients: [], eodTime: "23:00" },
    payhereLive: i?.payhere?.mode === "live" && Boolean(i.payhere.merchantId),
    businessName: b?.tradingName || b?.legalName || "us",
    vatRateBp: b?.vatRegistered ? (t?.vatRate ?? 0) : 0,
    currency: b?.currency ?? "LKR",
  };
}

/** Sends one message with the Cloud API; returns Meta's message id or the error. */
export async function graphSend(deps: Pick<WaDeps, "fetch">, phoneNumberId: string, token: string, to: string, m: WaOutbound): Promise<{ wamid?: string; error?: string }> {
  try {
    const res = await deps.fetch(`${GRAPH}/${phoneNumberId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cloudPayload(to, m)) });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) return { error: body.error?.message ?? `WhatsApp refused the message (${res.status})` };
    return { wamid: body.messages?.[0]?.id ?? "" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Sends (live) or simulates (not connected yet, or the simulator) a message and stores it in the
 * conversation with its status.
 */
async function deliver(db: Firestore, tenantId: string, to: string, m: WaOutbound, deps: WaDeps, opts: { live: boolean; phoneNumberId?: string; token?: string; by?: string; orderId?: string }): Promise<WaMessage> {
  const store = new AdminStore(db, tenantId);
  const now = deps.now();
  if (!opts.live || !opts.phoneNumberId || !opts.token) return recordOutbound(store, to, m, { status: "simulated", ...(opts.by ? { by: opts.by } : {}), ...(opts.orderId ? { orderId: opts.orderId } : {}) }, now);
  const sent = await graphSend(deps, opts.phoneNumberId, opts.token, to, m);
  return recordOutbound(store, to, m, { status: sent.error ? "failed" : "sent", ...(sent.wamid ? { wamid: sent.wamid } : {}), ...(sent.error ? { error: sent.error } : {}), ...(opts.by ? { by: opts.by } : {}), ...(opts.orderId ? { orderId: opts.orderId } : {}) }, now);
}

function commerceOn(t: Tenant | undefined): boolean {
  return Boolean(t && t.status !== "archived" && isOn(t.modules, "whatsappCommerce"));
}

// ───────────────────────────── Webhook ─────────────────────────────

/** Meta's verification: echo hub.challenge when the verify token matches a connected number's. */
export async function webhookVerify(db: Firestore, q: Record<string, unknown>): Promise<{ status: number; body: string }> {
  const token = typeof q["hub.verify_token"] === "string" ? q["hub.verify_token"] : "";
  if (q["hub.mode"] !== "subscribe" || token.length < 8) return { status: 403, body: "forbidden" };
  const hit = await db.collection("waRouting").where("verifyToken", "==", token).limit(1).get();
  return hit.empty ? { status: 403, body: "forbidden" } : { status: 200, body: String(q["hub.challenge"] ?? "") };
}

/** Handles a signed webhook delivery. Always answers 200 for deliveries it has dealt with, so Meta doesn't retry. */
export async function webhookReceive(db: Firestore, raw: Buffer | string, signature: string | undefined, body: unknown, deps: WaDeps): Promise<number> {
  const batches = parseWebhook(body);
  for (const b of batches) {
    const route = (await db.collection("waRouting").doc(b.phoneNumberId).get()).data() as Routing | undefined;
    if (!route) continue;
    const secrets = await secretsOf(db, route.tenantId);
    if (!validSignature(raw, signature, secrets.appSecret)) return 401;
    const tenant = (await db.collection("tenants").doc(route.tenantId).get()).data() as Tenant | undefined;
    if (!commerceOn(tenant)) continue;
    const store = new AdminStore(db, route.tenantId);
    const cfg = await settingsOf(db, route.tenantId);
    const live = cfg.wa.mode === "live";
    for (const msg of b.messages) {
      const r = await handleInbound(store, msg, { settings: cfg.wa, businessName: cfg.businessName, vatRateBp: cfg.vatRateBp, paymentLink: cfg.payhereLive, now: deps.now() });
      for (const reply of r.replies) await deliver(db, route.tenantId, msg.from, reply, deps, { live, phoneNumberId: b.phoneNumberId, ...(secrets.accessToken ? { token: secrets.accessToken } : {}) });
    }
    for (const s of b.statuses) {
      const hit = await db.collection("tenants").doc(route.tenantId).collection(WA.messages).where("wamid", "==", s.wamid).limit(1).get();
      const doc = hit.docs[0];
      if (!doc) continue;
      const order = ["queued", "sent", "delivered", "read"];
      const cur = String(doc.get("status") ?? "queued");
      // Statuses can arrive out of order: never step back (read stays read), but a failure always shows.
      if (s.status === "failed" || order.indexOf(s.status) > order.indexOf(cur)) await doc.ref.set({ status: s.status, ...(s.error ? { error: s.error } : {}) }, { merge: true });
    }
  }
  return 200;
}

// ───────────────────────────── Staff API ─────────────────────────────

const SELLERS = ["owner", "admin", "manager", "sales"];

export async function handleWhatsappApi(db: Firestore, uid: string | undefined, req: WhatsappApiRequest, deps: WaDeps): Promise<unknown> {
  if (!uid) throw new WhatsappError("permission-denied", "sign in first");
  if (!req?.tenantId || !req.action) throw new WhatsappError("invalid-argument", "tenantId and action are required");
  const tenantRef = db.collection("tenants").doc(req.tenantId);
  const [tenantSnap, memberSnap] = await Promise.all([tenantRef.get(), tenantRef.collection("members").doc(uid).get()]);
  const tenant = tenantSnap.data() as Tenant | undefined;
  const member = memberSnap.data() as Member | undefined;
  if (!tenant) throw new WhatsappError("not-found", "business not found");
  if (!member || !SELLERS.includes(member.role)) throw new WhatsappError("permission-denied", "only owners, administrators, managers and sales staff use WhatsApp");
  if (!commerceOn(tenant)) throw new WhatsappError("failed-precondition", "WhatsApp Business is not switched on for this business");
  const admin = member.role === "owner" || member.role === "admin";
  const store = new AdminStore(db, req.tenantId);
  const cfg = await settingsOf(db, req.tenantId);
  const secrets = await secretsOf(db, req.tenantId);
  const live = cfg.wa.mode === "live" && Boolean(cfg.wa.phoneNumberId && secrets.accessToken);
  const conn = { live, phoneNumberId: cfg.wa.phoneNumberId, ...(secrets.accessToken ? { token: secrets.accessToken } : {}), by: member.name || uid };

  switch (req.action) {
    case "status":
      return { accessToken: Boolean(secrets.accessToken), appSecret: Boolean(secrets.appSecret), verifyToken: Boolean(secrets.verifyToken), live, phoneNumberId: cfg.wa.phoneNumberId };

    case "connect": {
      if (!admin) throw new WhatsappError("permission-denied", "only the owner or an administrator can connect WhatsApp");
      if (!/^\d{6,20}$/.test(req.phoneNumberId ?? "")) throw new WhatsappError("invalid-argument", "the Phone number ID is the long number in Meta's WhatsApp > API setup");
      if (req.verifyToken !== undefined && req.verifyToken.length < 8) throw new WhatsappError("invalid-argument", "the verify token needs at least 8 characters");
      const owner = (await db.collection("waRouting").doc(req.phoneNumberId).get()).data() as Routing | undefined;
      if (owner && owner.tenantId !== req.tenantId) throw new WhatsappError("failed-precondition", "this WhatsApp number is connected to another business");
      const next: WaSecrets = { ...secrets, ...(req.accessToken ? { accessToken: req.accessToken.trim() } : {}), ...(req.appSecret ? { appSecret: req.appSecret.trim() } : {}), ...(req.verifyToken ? { verifyToken: req.verifyToken.trim() } : {}) };
      await db.collection("integrationSecrets").doc(req.tenantId).set({ whatsapp: next }, { merge: true });
      // One number per business: drop the old routing when the number changes.
      const old = await db.collection("waRouting").where("tenantId", "==", req.tenantId).get();
      for (const d of old.docs) if (d.id !== req.phoneNumberId) await d.ref.delete();
      await db.collection("waRouting").doc(req.phoneNumberId).set({ tenantId: req.tenantId, ...(next.verifyToken ? { verifyToken: next.verifyToken } : {}), updatedAt: deps.now().toISOString() } satisfies Routing);
      return { accessToken: Boolean(next.accessToken), appSecret: Boolean(next.appSecret), verifyToken: Boolean(next.verifyToken) };
    }

    case "disconnect": {
      if (!admin) throw new WhatsappError("permission-denied", "only the owner or an administrator can disconnect WhatsApp");
      const old = await db.collection("waRouting").where("tenantId", "==", req.tenantId).get();
      for (const d of old.docs) await d.ref.delete();
      await db.collection("integrationSecrets").doc(req.tenantId).set({ whatsapp: {} }, { merge: false });
      return { ok: true };
    }

    case "send": {
      const conv = await store.get<WaConversation>(WA.conversations, req.conversationId);
      if (!conv) throw new WhatsappError("not-found", "conversation not found");
      if (!req.message || !["text", "template", "image"].includes(req.message.kind)) throw new WhatsappError("invalid-argument", "a text, image or template message is required");
      if (req.message.kind !== "template" && !inServiceWindow(conv, deps.now())) throw new WhatsappError("failed-precondition", "more than 24 hours since the customer's last message: send an approved template instead");
      const m = await deliver(db, req.tenantId, conv.id, req.message, deps, conn);
      // A person replied: the assistant steps back for this chat; the inbox is read.
      await store.merge(WA.conversations, conv.id, { mode: "human", unread: 0, assignedTo: uid });
      return m;
    }

    case "orderMessage": {
      const o = await store.get<SalesOrder>(WHOLESALE.salesOrders, req.orderId);
      if (!o) throw new WhatsappError("not-found", "order not found");
      const customer = await store.get<Customer>(C.customers, o.customerId);
      const to = o.conversationId ?? customer?.whatsapp;
      if (!to) throw new WhatsappError("failed-precondition", "this customer has no WhatsApp number");
      const conv = await store.get<WaConversation>(WA.conversations, to);
      const built = orderMessage(req.kind, o, { businessName: cfg.businessName, inWindow: Boolean(conv && inServiceWindow(conv, deps.now())), ...(cfg.wa.templates ? { templates: cfg.wa.templates } : {}), ...(cfg.wa.templateLanguage ? { language: cfg.wa.templateLanguage } : {}), ...(req.link ? { link: req.link } : {}) });
      if (!built.message) throw new WhatsappError("failed-precondition", `the customer last wrote more than 24 hours ago: set up the approved template "${built.needsTemplate}" in WhatsApp settings`);
      return deliver(db, req.tenantId, to, built.message, deps, { ...conn, orderId: o.id });
    }

    case "simulate": {
      if (live) throw new WhatsappError("failed-precondition", "the simulator is for trying the assistant before WhatsApp is live");
      const from = String(req.message?.from ?? "").replace(/\D/g, "");
      if (!/^\d{8,15}$/.test(from)) throw new WhatsappError("invalid-argument", "a phone number with country code is required");
      const msg = { ...req.message, from, id: `sim.${newId()}`, at: deps.now().toISOString() } as WaInbound;
      const r = await handleInbound(store, msg, { settings: cfg.wa, businessName: cfg.businessName, vatRateBp: cfg.vatRateBp, paymentLink: cfg.payhereLive, now: deps.now() });
      for (const reply of r.replies) await deliver(db, req.tenantId, from, reply, deps, { live: false });
      return { replies: r.replies, orderId: r.order?.id ?? null };
    }

    case "syncCatalogue": {
      if (!cfg.wa.catalogId) throw new WhatsappError("failed-precondition", "add the Catalogue ID from Meta Commerce Manager first");
      if (!live) throw new WhatsappError("failed-precondition", "connect WhatsApp (live) to sync the catalogue");
      const [styles, levels] = await Promise.all([store.list<Style>(WHOLESALE.styles), store.list<StockLevel>(C.stockLevels)]);
      const onHand = new Map<string, number>();
      for (const l of levels) onHand.set(l.itemId, (onHand.get(l.itemId) ?? 0) + l.qty);
      const items = catalogueItems(styles, onHand, { currency: cfg.currency, imageUrl: (id) => `${req.imageBase.replace(/\/$/, "")}/${encodeURIComponent(id)}.jpg`, link: req.link, brand: cfg.businessName });
      let sent = 0;
      for (let i = 0; i < items.length; i += 500) {
        const chunk = items.slice(i, i + 500);
        const res = await deps.fetch(`${GRAPH}/${cfg.wa.catalogId}/items_batch`, { method: "POST", headers: { Authorization: `Bearer ${secrets.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ item_type: "PRODUCT_ITEM", requests: chunk }) });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new WhatsappError("failed-precondition", `Meta refused the catalogue: ${body.error?.message ?? res.status}`);
        }
        sent += chunk.length;
      }
      await store.merge(C.settings, "integrations", { whatsapp: { ...cfg.wa, catalogSyncedAt: deps.now().toISOString() } });
      return { items: sent };
    }

    case "broadcast": {
      if (!admin && member.role !== "manager") throw new WhatsappError("permission-denied", "broadcasts are sent by a manager, the owner or an administrator");
      if (!/^[a-z0-9_]{1,512}$/.test(req.template ?? "")) throw new WhatsappError("invalid-argument", "broadcasts use an approved template name (lowercase, numbers and _)");
      const params = (req.params ?? []).map(String).slice(0, 10);
      const message: WaOutbound = { kind: "template", name: req.template, params, ...(cfg.wa.templateLanguage ? { language: cfg.wa.templateLanguage } : {}) };
      if (req.test) {
        const to = req.test.replace(/\D/g, "");
        return { test: await deliver(db, req.tenantId, to, message, deps, conn) };
      }
      const audience = broadcastAudience(await store.list<Customer>(C.customers), req.segment ?? {}).slice(0, 2000);
      let sent = 0;
      let failed = 0;
      for (const c of audience) {
        const m = await deliver(db, req.tenantId, c.whatsapp!, message, deps, conn);
        if (m.status === "failed") failed++;
        else sent++;
      }
      const b = { id: newId(), name: (req.name || req.template).slice(0, 80), template: req.template, params, segment: req.segment ?? {}, at: deps.now().toISOString(), by: conn.by, recipients: audience.length, sent, failed, simulated: !live };
      await store.set(WA.broadcasts, b);
      return b;
    }

    case "media": {
      if (!live) throw new WhatsappError("failed-precondition", "photos are kept by WhatsApp: connect it to view them");
      if (!/^\d{5,30}$/.test(req.mediaId ?? "")) throw new WhatsappError("invalid-argument", "media id required");
      const meta = await deps.fetch(`${GRAPH}/${req.mediaId}`, { headers: { Authorization: `Bearer ${secrets.accessToken}` } });
      const info = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
      if (!meta.ok || !info.url) throw new WhatsappError("not-found", "WhatsApp no longer has this photo (kept for 30 days)");
      if ((info.file_size ?? 0) > 5_000_000) throw new WhatsappError("failed-precondition", "the file is too large to show here");
      const file = await deps.fetch(info.url, { headers: { Authorization: `Bearer ${secrets.accessToken}` } });
      const buf = Buffer.from(await file.arrayBuffer());
      return { dataUrl: `data:${info.mime_type ?? "image/jpeg"};base64,${buf.toString("base64")}` };
    }

    default:
      throw new WhatsappError("invalid-argument", "unknown action");
  }
}
