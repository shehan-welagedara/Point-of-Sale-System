/**
 * WhatsApp Business (Cloud API) for selling (module "whatsappCommerce").
 *
 * The same code runs on the server (webhook and callable, with Meta's API) and in the local demo
 * (with a simulated WhatsApp), on any DocStore:
 *  - `botReply`: the order-taking assistant, a small state machine with buttons and lists: browse
 *    styles, pick colour, size and quantity (stock and the customer's price checked), checkout with
 *    address and payment method; native catalogue carts; bank slips; "my orders"; talk to a person;
 *    STOP to opt out.
 *  - `handleInbound`: stores the message, runs the bot, creates the draft order, returns the replies.
 *  - order, dispatch, invoice, payment and reminder messages; the catalogue feed for Meta Commerce;
 *    the audience of a broadcast (opted in, not opted out).
 * Free-form replies are only allowed within 24 hours of the customer's last message; outside it a
 * message must be an approved template (`needsTemplate`).
 */
import type { Cents } from "@pos/engine";
import { formatAmount } from "@pos/engine";
import { COLLECTIONS as C, type DocStore } from "./store.js";
import type { Customer, IntegrationSettings, StockLevel } from "./types.js";
import { newId } from "./util.js";
import { type PriceList, type SalesLine, type SalesOrder, type Style, WHOLESALE, nextDocNumber, orderTotals, paymentState, priceLines, styleVariants, unitPrice, variantSku } from "./wholesale.js";

export const WA = { conversations: "waConversations", messages: "waMessages", broadcasts: "waBroadcasts" } as const;

export type WaOutbound =
  | { kind: "text"; text: string }
  | { kind: "buttons"; text: string; buttons: { id: string; title: string }[] }
  | { kind: "list"; text: string; button: string; rows: { id: string; title: string; description?: string }[] }
  | { kind: "image"; link: string; caption?: string }
  | { kind: "template"; name: string; params: string[]; language?: string };

export interface WaInbound {
  id: string;
  from: string;
  name?: string;
  at: string;
  type: "text" | "interactive" | "image" | "order" | "other";
  text?: string;
  /** Id of the button or list row tapped. */
  replyId?: string;
  image?: { mediaId: string; caption?: string };
  /** A cart sent from the WhatsApp catalogue: SKUs and quantities. */
  order?: { items: { sku: string; qty: number }[] };
}

export interface CartLine {
  styleId: string;
  colour: string;
  size: string;
  qty: number;
}

export type BotStep = "idle" | "menu" | "browse" | "colour" | "size" | "qty" | "cart" | "address" | "payment" | "human";

export interface WaConversation {
  /** The customer's WhatsApp id (international number without +). */
  id: string;
  name?: string;
  customerId?: string;
  step: BotStep;
  styleId?: string;
  colour?: string;
  size?: string;
  cart: CartLine[];
  address?: string;
  /** bot: the assistant answers; human: staff reply (the bot is quiet until "menu"). */
  mode: "bot" | "human";
  lastInboundAt?: string;
  lastOutboundAt?: string;
  lastText?: string;
  unread: number;
  assignedTo?: string;
  updatedAt: string;
}

export interface WaMessage {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  at: string;
  /** What was said, as text (buttons and lists summarised). */
  text: string;
  payload?: WaOutbound | Omit<WaInbound, "id" | "from" | "at">;
  /** Outbound: queued → sent → delivered → read, failed; simulated when no live connection. */
  status?: "queued" | "sent" | "delivered" | "read" | "failed" | "simulated";
  /** Meta's message id (status updates refer to it). */
  wamid?: string;
  by?: string;
  error?: string;
  orderId?: string;
}

export interface BotContext {
  businessName: string;
  styles: Style[];
  /** Pieces available per SKU (on hand less orders holding stock). */
  available: ReadonlyMap<string, number>;
  priceList?: PriceList | null;
  customer?: Pick<Customer, "id" | "name" | "address" | "creditLimit"> | null;
  /** The customer's recent orders (for "my orders" and payment slips). */
  orders: Pick<SalesOrder, "id" | "number" | "status" | "total" | "paid" | "paymentStatus">[];
  bankDetails?: string;
  welcome?: string;
  handoff?: string;
  hours?: string;
  /** Payment by link offered (PayHere connected). */
  paymentLink: boolean;
}

export interface BotResult {
  conv: WaConversation;
  replies: WaOutbound[];
  /** Checkout done: the order to create. */
  order?: { lines: CartLine[]; address: string; payment: "bank" | "cod" | "link" | "credit" };
  /** A payment slip sent for an order. */
  slip?: { orderId: string; mediaId: string; caption?: string };
  optOut?: boolean;
  optIn?: boolean;
  handoff?: boolean;
}

const money = (c: Cents) => `Rs ${formatAmount(c)}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const MENU: WaOutbound = { kind: "buttons", text: "", buttons: [{ id: "m:order", title: "🛍 Place an order" }, { id: "m:orders", title: "📦 My orders" }, { id: "m:human", title: "💬 Talk to us" }] };

function cartSummary(conv: WaConversation, ctx: BotContext): { text: string; total: Cents } {
  const styles = new Map(ctx.styles.map((s) => [s.id, s]));
  const lines = priceLines(conv.cart.map((c, i) => ({ id: String(i), styleId: c.styleId, styleCode: styles.get(c.styleId)?.code ?? "", name: styles.get(c.styleId)?.name ?? c.styleId, colour: c.colour, size: c.size, sku: variantSku(styles.get(c.styleId)?.code ?? "", c.colour, c.size), qty: c.qty })), styles, ctx.priceList ?? null);
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const text = lines.map((l) => `• ${l.name} – ${l.colour} ${l.size} × ${l.qty} @ ${money(l.unit)} = ${money(l.amount)}`).join("\n");
  return { text: `${text}\n*Total ${money(total)}* (${lines.reduce((a, l) => a + l.qty, 0)} pcs)`, total };
}

const lower = (s?: string) => (s ?? "").trim().toLowerCase();

/** The assistant's next replies and state for one incoming message. */
export function botReply(conv0: WaConversation, msg: WaInbound, ctx: BotContext): BotResult {
  const conv: WaConversation = { ...conv0, cart: [...conv0.cart] };
  const text = lower(msg.text);
  const id = msg.replyId ?? "";
  const live = ctx.styles.filter((s) => s.active && s.publish !== false);
  const out: WaOutbound[] = [];
  const menu = (lead: string): BotResult => {
    conv.step = "menu";
    return { conv, replies: [...out, { ...MENU, text: lead } as WaOutbound] };
  };

  // Opt out and back in (marketing), always honoured.
  if (/^(stop|unsubscribe|optout|opt out)$/.test(text)) {
    return { conv, replies: [{ kind: "text", text: "You won't receive offers from us any more. You can still order here any time. Reply START to receive offers again." }], optOut: true };
  }
  if (/^(start|subscribe)$/.test(text)) return { conv, replies: [{ kind: "text", text: "Thanks! You'll receive our new designs and offers. Reply STOP any time to stop them." }], optIn: true };

  // Staff are handling this chat: the assistant stays quiet unless the customer asks for the menu.
  if (conv.mode === "human" && !/^(menu|hi|hello|order)$/.test(text) && !id.startsWith("m:")) return { conv, replies: [] };
  if (conv.mode === "human") conv.mode = "bot";

  // A payment slip (photo) for the latest unpaid order.
  if (msg.type === "image" && msg.image) {
    const open = ctx.orders.find((o) => o.status !== "cancelled" && o.paymentStatus !== "paid");
    if (open) return { conv, replies: [{ kind: "text", text: `Thank you! We received your payment slip for order ${open.number}. We'll confirm it shortly.` }], slip: { orderId: open.id, mediaId: msg.image.mediaId, ...(msg.image.caption ? { caption: msg.image.caption } : {}) } };
    conv.mode = "human";
    return { conv, replies: [{ kind: "text", text: "Thanks for the photo! A team member will look at it and reply shortly." }], handoff: true };
  }

  // A cart from the WhatsApp catalogue.
  if (msg.type === "order" && msg.order) {
    for (const it of msg.order.items) {
      const style = live.find((s) => styleVariants(s).some((v) => v.sku === it.sku));
      const v = style && styleVariants(style).find((x) => x.sku === it.sku);
      if (style && v && it.qty > 0) conv.cart.push({ styleId: style.id, colour: v.colour, size: v.size, qty: it.qty });
    }
    if (!conv.cart.length) return menu("Sorry, those items aren't available now.");
    conv.step = "cart";
    const sum = cartSummary(conv, ctx);
    return { conv, replies: [{ kind: "buttons", text: `Your order:\n${sum.text}`, buttons: [{ id: "c:checkout", title: "✅ Checkout" }, { id: "c:more", title: "➕ Add more" }, { id: "c:clear", title: "🗑 Clear" }] }] };
  }

  if (/^(hi|hello|hey|menu|start over|ayubowan|vanakkam)\b/.test(text) || (conv.step === "idle" && !id)) {
    return menu(ctx.welcome ?? `Welcome to ${ctx.businessName}! 👋 How can we help you today?`);
  }

  if (id === "m:human" || /\b(agent|human|person|call me)\b/.test(text)) {
    conv.mode = "human";
    conv.step = "human";
    return { conv, replies: [{ kind: "text", text: ctx.handoff ?? `A member of our team will reply shortly${ctx.hours ? ` (${ctx.hours})` : ""}.` }], handoff: true };
  }

  if (id === "m:orders") {
    const recent = ctx.orders.slice(0, 3);
    return menu(recent.length ? `Your recent orders:\n${recent.map((o) => `• ${o.number}: ${o.status}, ${money(o.total)}${o.paymentStatus === "paid" ? " (paid)" : o.paid ? ` (${money(o.total - o.paid)} due)` : ""}`).join("\n")}` : "You have no orders with us yet.");
  }

  if (id === "m:order" || id === "c:more" || /\b(order|catalog|catalogue|price|designs?)\b/.test(text)) {
    if (!live.length) return menu("Our catalogue is being updated. Please try again soon, or tap Talk to us.");
    conv.step = "browse";
    return { conv, replies: [{ kind: "list", text: "Choose a design:", button: "View designs", rows: live.slice(0, 10).map((s) => ({ id: `s:${s.id}`, title: clip(s.name, 24), description: clip(`${s.category} · from ${money(Math.min(s.price, ...(s.tiers ?? []).map((t) => t.price)))}`, 72) })) }] };
  }

  if (id.startsWith("s:")) {
    const style = live.find((s) => s.id === id.slice(2));
    if (!style) return menu("Sorry, that design isn't available now.");
    conv.styleId = style.id;
    conv.step = "colour";
    const tiers = (style.tiers ?? []).map((t) => `${t.minQty}+ pcs: ${money(t.price)}`).join(", ");
    const colours = style.colours.map((c) => ({ id: `c:${c.name}`, title: clip(c.name, 24) }));
    return {
      conv,
      replies: [
        { kind: "text", text: `*${style.name}*\n${money(style.price)} per piece${tiers ? `\nWholesale: ${tiers}` : ""}\nSizes: ${style.sizes.join(", ")}` },
        colours.length <= 3 ? { kind: "buttons", text: "Which colour?", buttons: colours } : { kind: "list", text: "Which colour?", button: "Colours", rows: colours.slice(0, 10) },
      ],
    };
  }

  if (id.startsWith("c:") && !["c:checkout", "c:more", "c:clear"].includes(id) && conv.styleId) {
    const style = live.find((s) => s.id === conv.styleId)!;
    conv.colour = id.slice(2);
    conv.step = "size";
    return { conv, replies: [{ kind: "list", text: `${style.name} in ${conv.colour}: which size?`, button: "Sizes", rows: style.sizes.slice(0, 10).map((size) => { const n = ctx.available.get(variantSku(style.code, conv.colour!, size)) ?? 0; return { id: `z:${size}`, title: size, description: n > 0 ? `${n} in stock` : "Out of stock" }; }) }] };
  }

  if (id.startsWith("z:") && conv.styleId && conv.colour) {
    conv.size = id.slice(2);
    conv.step = "qty";
    return { conv, replies: [{ kind: "text", text: `How many pieces of ${conv.colour} / ${conv.size}? Reply with a number (e.g. 12).` }] };
  }

  if (conv.step === "qty" && conv.styleId && conv.colour && conv.size) {
    const qty = Number.parseInt(text.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(qty) || qty <= 0) return { conv, replies: [{ kind: "text", text: "Please reply with the number of pieces, e.g. 12." }] };
    const style = live.find((s) => s.id === conv.styleId)!;
    const sku = variantSku(style.code, conv.colour, conv.size);
    const inCart = conv.cart.filter((c) => c.styleId === style.id && c.colour === conv.colour && c.size === conv.size).reduce((a, c) => a + c.qty, 0);
    const avail = (ctx.available.get(sku) ?? 0) - inCart;
    if (qty > avail) return { conv, replies: [{ kind: "text", text: avail > 0 ? `Sorry, only ${avail} left in ${conv.colour} / ${conv.size}. Reply with ${avail} or less.` : `Sorry, ${conv.colour} / ${conv.size} is out of stock.` }] };
    conv.cart.push({ styleId: style.id, colour: conv.colour, size: conv.size, qty });
    conv.step = "cart";
    const styleQty = conv.cart.filter((c) => c.styleId === style.id).reduce((a, c) => a + c.qty, 0);
    const next = (style.tiers ?? []).filter((t) => t.minQty > styleQty).sort((a, b) => a.minQty - b.minQty)[0];
    const sum = cartSummary(conv, ctx);
    return { conv, replies: [{ kind: "buttons", text: `Added ✅\n${sum.text}${next ? `\n\nTip: ${next.minQty - styleQty} more of this design gets ${money(unitPrice(style, { size: conv.size, colour: conv.colour, styleQty: next.minQty, priceList: ctx.priceList ?? null }).base)} per piece.` : ""}`, buttons: [{ id: "c:checkout", title: "✅ Checkout" }, { id: "c:more", title: "➕ Add more" }, { id: "c:clear", title: "🗑 Clear" }] }] };
  }

  if (id === "c:clear") {
    conv.cart = [];
    return menu("Your cart is empty.");
  }

  if (id === "c:checkout") {
    if (!conv.cart.length) return menu("Your cart is empty.");
    conv.step = "address";
    const saved = ctx.customer?.address ?? conv.address;
    return { conv, replies: [saved ? { kind: "buttons", text: `Deliver to:\n${saved}`, buttons: [{ id: "a:saved", title: "Yes, this address" }, { id: "a:new", title: "Another address" }, { id: "a:pickup", title: "I'll collect" }] } : { kind: "buttons", text: "Where should we deliver? Reply with the full address and a phone number, or choose:", buttons: [{ id: "a:pickup", title: "I'll collect" }] }] };
  }

  if (conv.step === "address") {
    if (id === "a:new") return { conv, replies: [{ kind: "text", text: "Please reply with the delivery address and a phone number." }] };
    const address = id === "a:saved" ? (ctx.customer?.address ?? conv.address ?? "") : id === "a:pickup" ? "Pickup" : (msg.text ?? "").trim();
    if (address.length < 4) return { conv, replies: [{ kind: "text", text: "Please reply with the delivery address and a phone number." }] };
    conv.address = address;
    conv.step = "payment";
    const credit = (ctx.customer?.creditLimit ?? 0) > 0;
    const buttons = [{ id: "p:bank", title: "🏦 Bank transfer" }, address === "Pickup" ? { id: "p:cash", title: "💵 Pay on pickup" } : { id: "p:cod", title: "💵 Cash on delivery" }, ...(ctx.paymentLink ? [{ id: "p:link", title: "💳 Pay online" }] : credit ? [{ id: "p:credit", title: "🧾 On my account" }] : [])];
    return { conv, replies: [{ kind: "buttons", text: "How would you like to pay?", buttons: buttons.slice(0, 3) }] };
  }

  if (conv.step === "payment" && id.startsWith("p:")) {
    const payment = id === "p:bank" ? "bank" : id === "p:link" ? "link" : id === "p:credit" ? "credit" : "cod";
    const order = { lines: conv.cart, address: conv.address ?? "", payment } as const;
    const sum = cartSummary(conv, ctx);
    conv.cart = [];
    conv.step = "idle";
    delete conv.styleId;
    delete conv.colour;
    delete conv.size;
    const how = payment === "bank" ? `\n\nPlease transfer ${money(sum.total)} to:\n${ctx.bankDetails ?? "(our bank details will follow)"}\nand send a photo of the slip here.` : payment === "link" ? "\n\nWe'll send you a secure payment link." : payment === "credit" ? "\n\nWe'll add it to your account." : "\n\nPlease pay the courier on delivery.";
    return { conv, replies: [{ kind: "text", text: `Thank you! 🙏 Your order is received:\n${sum.text}${order.address && order.address !== "Pickup" ? `\nDeliver to: ${order.address}` : "\nPickup"}${how}\n\nWe'll confirm it shortly.` }], order };
  }

  return menu("Sorry, I didn't get that. Please choose:");
}

// ───────────────────────────── Store side ─────────────────────────────

/** What the bot needs about the business, from the store. */
async function botContext(store: DocStore, conv: WaConversation, settings: IntegrationSettings["whatsapp"], businessName: string, paymentLink: boolean): Promise<BotContext> {
  const [styles, levels, customers, priceLists, orders] = await Promise.all([
    store.list<Style>(WHOLESALE.styles),
    store.list<StockLevel>(C.stockLevels),
    store.list<Customer>(C.customers, { where: [["whatsapp", "==", conv.id]] }),
    store.list<PriceList>(WHOLESALE.priceLists),
    store.list<SalesOrder>(WHOLESALE.salesOrders, { where: [["conversationId", "==", conv.id]] }),
  ]);
  const customer = customers[0] ?? null;
  const onHand = new Map<string, number>();
  for (const l of levels) onHand.set(l.itemId, (onHand.get(l.itemId) ?? 0) + l.qty);
  const open = await store.list<SalesOrder>(WHOLESALE.salesOrders, { where: [["status", "in", ["confirmed", "packed"]]] });
  for (const o of open) for (const l of o.lines) onHand.set(l.sku, (onHand.get(l.sku) ?? 0) - l.qty);
  return {
    businessName,
    styles,
    available: onHand,
    priceList: customer?.priceListId ? (priceLists.find((p) => p.id === customer.priceListId) ?? null) : null,
    customer,
    orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    ...(settings.bankDetails ? { bankDetails: settings.bankDetails } : {}),
    ...(settings.bot?.welcome ? { welcome: settings.bot.welcome } : {}),
    ...(settings.bot?.handoff ? { handoff: settings.bot.handoff } : {}),
    ...(settings.bot?.hours ? { hours: settings.bot.hours } : {}),
    paymentLink,
  };
}

/** The message as text, for the inbox and the conversation list. */
export function outboundText(m: WaOutbound): string {
  if (m.kind === "text") return m.text;
  if (m.kind === "buttons") return `${m.text}\n${m.buttons.map((b) => `[${b.title}]`).join(" ")}`;
  if (m.kind === "list") return `${m.text}\n${m.rows.map((r) => `• ${r.title}${r.description ? ` (${r.description})` : ""}`).join("\n")}`;
  if (m.kind === "image") return m.caption ? `🖼 ${m.caption}` : "🖼 Image";
  return `Template ${m.name}: ${m.params.join(" · ")}`;
}

export function inboundText(m: WaInbound): string {
  if (m.type === "image") return `🖼 Photo${m.image?.caption ? `: ${m.image.caption}` : ""}`;
  if (m.type === "order") return `🛒 Catalogue order (${m.order?.items.length ?? 0} items)`;
  return m.text ?? m.replyId ?? "";
}

/** Within 24 hours of the customer's last message, free-form replies are allowed. */
export function inServiceWindow(conv: Pick<WaConversation, "lastInboundAt">, now: Date): boolean {
  return Boolean(conv.lastInboundAt && now.getTime() - Date.parse(conv.lastInboundAt) < 24 * 3_600_000);
}

export interface InboundResult {
  conv: WaConversation;
  replies: WaOutbound[];
  order?: SalesOrder;
  customer?: Customer;
}

/**
 * Handles one incoming WhatsApp message: finds or creates the conversation and the customer, runs
 * the assistant, creates the draft order on checkout and records a payment slip, and stores the
 * messages. Sending the replies is the caller's job (Meta's API, or the simulator).
 */
export async function handleInbound(store: DocStore, msg: WaInbound, opts: { settings: IntegrationSettings["whatsapp"]; businessName: string; vatRateBp: number; paymentLink: boolean; now?: Date }): Promise<InboundResult> {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const prev = await store.get<WaConversation>(WA.conversations, msg.from);
  if (prev && (await store.get<WaMessage>(WA.messages, msg.id))) return { conv: prev, replies: [] }; // Meta retried a delivery
  const conv0: WaConversation = prev ?? { id: msg.from, ...(msg.name ? { name: msg.name } : {}), step: "idle", cart: [], mode: "bot", unread: 0, updatedAt: at };
  // The customer: found by WhatsApp number, else created on the first message.
  let customer = (await store.list<Customer>(C.customers, { where: [["whatsapp", "==", msg.from]] }))[0];
  if (!customer) {
    customer = { id: `WA${msg.from}`, name: msg.name || `+${msg.from}`, phone: `+${msg.from}`, whatsapp: msg.from, tags: ["whatsapp"], marketingConsent: false, visits: 0, totalSpend: 0, points: 0, createdAt: at };
    await store.set(C.customers, customer);
  }
  const conv1: WaConversation = { ...conv0, customerId: customer.id, ...(msg.name ? { name: msg.name } : {}) };
  const ctx = await botContext(store, conv1, opts.settings, opts.businessName, opts.paymentLink);
  const result = opts.settings.bot?.enabled === false ? { conv: { ...conv1, mode: "human" as const }, replies: [] as WaOutbound[] } : botReply(conv1, msg, ctx);
  const conv: WaConversation = { ...result.conv, lastInboundAt: at, lastText: inboundText(msg).slice(0, 120), unread: (conv0.unread ?? 0) + 1, updatedAt: at, ...(result.replies.length ? { lastOutboundAt: at } : {}) };
  await store.set(WA.messages, { id: msg.id, conversationId: msg.from, direction: "in", at, text: inboundText(msg), payload: { type: msg.type, ...(msg.text ? { text: msg.text } : {}), ...(msg.replyId ? { replyId: msg.replyId } : {}), ...(msg.image ? { image: msg.image } : {}), ...(msg.order ? { order: msg.order } : {}) } } satisfies WaMessage);

  if ("optOut" in result && result.optOut) await store.merge(C.customers, customer.id, { whatsappOptIn: false, whatsappOptOutAt: at, marketingConsent: false });
  if ("optIn" in result && result.optIn) await store.merge(C.customers, customer.id, { whatsappOptIn: true, marketingConsent: true });

  let order: SalesOrder | undefined;
  if ("order" in result && result.order) {
    const styles = new Map(ctx.styles.map((s) => [s.id, s]));
    const lines: SalesLine[] = priceLines(
      result.order.lines.map((c) => {
        const s = styles.get(c.styleId)!;
        return { id: newId(), styleId: s.id, styleCode: s.code, name: s.name, colour: c.colour, size: c.size, sku: variantSku(s.code, c.colour, c.size), qty: c.qty };
      }),
      styles,
      ctx.priceList ?? null,
    );
    const totals = orderTotals({ lines, discount: 0, deliveryCharge: 0 }, opts.vatRateBp);
    order = {
      id: newId(),
      number: await nextDocNumber(store, "SO"),
      status: "draft",
      customerId: customer.id,
      customerName: customer.name,
      channel: "whatsapp",
      date: at.slice(0, 10),
      lines,
      discount: 0,
      deliveryCharge: 0,
      subtotal: totals.subtotal,
      vat: totals.vat,
      total: totals.total,
      ...(result.order.address === "Pickup" ? { delivery: { method: "pickup", cod: false } } : { delivery: { method: "courier", address: result.order.address, phone: `+${msg.from}`, cod: result.order.payment === "cod", ...(result.order.payment === "cod" ? { codAmount: totals.total } : {}) } }),
      payments: [],
      paid: 0,
      paymentStatus: "unpaid",
      onCredit: result.order.payment === "credit",
      conversationId: msg.from,
      notes: `WhatsApp order, payment: ${result.order.payment}`,
      createdBy: "whatsapp",
      createdAt: at,
      updatedAt: at,
      history: [{ at, by: "whatsapp", status: "draft", note: `ordered on WhatsApp (${result.order.payment})` }],
    };
    await store.set(WHOLESALE.salesOrders, order);
    if (result.order.address && result.order.address !== "Pickup" && !customer.address) await store.merge(C.customers, customer.id, { address: result.order.address });
  }
  if ("slip" in result && result.slip) {
    const o = await store.get<SalesOrder>(WHOLESALE.salesOrders, result.slip.orderId);
    if (o) {
      const payments = [...o.payments, { id: newId(), method: "bank" as const, amount: o.total - o.paid, at, by: "whatsapp", reference: result.slip.caption ?? "slip on WhatsApp", proofAttachmentId: result.slip.mediaId, status: "pending" as const }];
      await store.set(WHOLESALE.salesOrders, { ...o, payments, ...paymentState(o.total, payments), updatedAt: at, history: [...o.history, { at, by: "whatsapp", status: o.status, note: "payment slip received" }] });
    }
  }
  await store.set(WA.conversations, conv);
  return { conv, replies: result.replies, ...(order ? { order } : {}), customer };
}

/** Stores an outbound message (before sending, or as simulated). */
export async function recordOutbound(store: DocStore, conversationId: string, m: WaOutbound, extra: Partial<WaMessage> = {}, now = new Date()): Promise<WaMessage> {
  const msg: WaMessage = { id: newId(), conversationId, direction: "out", at: now.toISOString(), text: outboundText(m), payload: m, status: "queued", ...extra };
  await store.set(WA.messages, msg);
  await store.merge(WA.conversations, conversationId, { id: conversationId, lastOutboundAt: msg.at, lastText: msg.text.slice(0, 120), updatedAt: msg.at });
  return msg;
}

// ───────────────────────────── Messages about orders ─────────────────────────────

export type OrderMessageKind = "quotation" | "confirmation" | "dispatch" | "delivered" | "invoice" | "payment" | "reminder";

const TEMPLATE_FOR: Record<OrderMessageKind, keyof NonNullable<IntegrationSettings["whatsapp"]["templates"]>> = {
  quotation: "quotation",
  confirmation: "order_confirmed",
  dispatch: "order_dispatched",
  delivered: "order_delivered",
  invoice: "invoice_ready",
  payment: "payment_received",
  reminder: "payment_reminder",
};

/**
 * The message for an order event: free text inside the 24-hour window, else the approved template
 * (`needsTemplate` when none is set up, so staff know why it can't go).
 */
export function orderMessage(kind: OrderMessageKind, o: SalesOrder, opts: { businessName: string; link?: string; trackingUrl?: string; inWindow: boolean; templates?: IntegrationSettings["whatsapp"]["templates"]; language?: string }): { message?: WaOutbound; needsTemplate?: string } {
  const due = o.total - o.paid;
  const lines = o.lines.map((l) => `• ${l.name} ${l.colour} ${l.size} × ${l.qty}`).join("\n");
  const texts: Record<OrderMessageKind, string> = {
    quotation: `Quotation ${o.quotationNo ?? o.number} from ${opts.businessName}:\n${lines}\nTotal ${money(o.total)}${o.validUntil ? `, valid until ${o.validUntil}` : ""}.${opts.link ? `\nView: ${opts.link}` : ""}\nReply YES to confirm.`,
    confirmation: `✅ Order ${o.number} confirmed: ${o.lines.reduce((a, l) => a + l.qty, 0)} pcs, ${money(o.total)}.\n${lines}${due > 0 ? `\nAmount due: ${money(due)}` : ""}`,
    dispatch: `🚚 Order ${o.number} is on its way${o.delivery?.trackingNo ? ` (tracking ${o.delivery.trackingNo}${opts.trackingUrl ? `: ${opts.trackingUrl}` : ""})` : ""}.${o.delivery?.cod ? ` Please pay ${money(o.delivery.codAmount ?? due)} to the courier.` : ""}`,
    delivered: `📦 Order ${o.number} was delivered. Thank you for your business!`,
    invoice: `🧾 Invoice ${o.invoiceNo ?? o.number} for ${money(o.total)}${due > 0 ? `, due ${o.dueDate ?? "on receipt"}` : " (paid)"}.${opts.link ? `\n${opts.link}` : ""}`,
    payment: `🙏 We received ${money(o.paid)} for order ${o.number}.${due > 0 ? ` Balance ${money(due)}.` : " Fully paid."}`,
    reminder: `Friendly reminder: ${money(due)} is due for order ${o.number}${o.dueDate ? ` (due ${o.dueDate})` : ""}. Thank you!${opts.link ? `\nPay: ${opts.link}` : ""}`,
  };
  if (opts.inWindow) return { message: { kind: "text", text: texts[kind] } };
  const name = opts.templates?.[TEMPLATE_FOR[kind]];
  if (!name) return { needsTemplate: TEMPLATE_FOR[kind] };
  const params: Record<OrderMessageKind, string[]> = {
    quotation: [o.quotationNo ?? o.number, money(o.total)],
    confirmation: [o.number, money(o.total)],
    dispatch: [o.number, o.delivery?.trackingNo ?? "-"],
    delivered: [o.number],
    invoice: [o.invoiceNo ?? o.number, money(o.total)],
    payment: [money(o.paid), o.number],
    reminder: [money(due), o.number],
  };
  return { message: { kind: "template", name, params: params[kind], ...(opts.language ? { language: opts.language } : {}) } };
}

// ───────────────────────────── Catalogue and broadcasts ─────────────────────────────

/** Items for Meta Commerce Manager (catalog items_batch): one per variant, grouped by style. */
export function catalogueItems(styles: readonly Style[], available: ReadonlyMap<string, number>, opts: { currency: string; imageUrl: (styleId: string) => string; link: string; brand: string }) {
  return styles
    .filter((s) => s.active && s.publish !== false)
    .flatMap((s) =>
      styleVariants(s).map((v) => ({
        method: "UPDATE",
        data: {
          id: v.sku,
          item_group_id: s.code,
          title: `${s.name} – ${v.colour} ${v.size}`.slice(0, 150),
          description: (s.description ?? `${s.category}${s.fabric ? `, ${s.fabric}` : ""}`).slice(0, 500) || s.name,
          availability: (available.get(v.sku) ?? 0) > 0 ? "in stock" : "out of stock",
          condition: "new",
          price: `${((s.price + (s.sizeSurcharge?.[v.size] ?? 0) + (s.colourSurcharge?.[v.colour] ?? 0)) / 100).toFixed(2)} ${opts.currency}`,
          image_link: opts.imageUrl(s.id),
          link: opts.link,
          brand: opts.brand,
          size: v.size,
          color: v.colour,
        },
      })),
    );
}

export interface BroadcastSegment {
  /** Everyone opted in, or only customers with these tags / price list / area. */
  tags?: string[];
  priceListId?: string;
  area?: string;
}

/** Who a broadcast goes to: customers on WhatsApp who opted in and haven't opted out. */
export function broadcastAudience(customers: readonly Customer[], seg: BroadcastSegment): Customer[] {
  return customers.filter(
    (c) =>
      c.whatsapp &&
      c.whatsappOptIn === true &&
      !c.whatsappOptOutAt &&
      (!seg.tags?.length || seg.tags.some((t) => c.tags.includes(t))) &&
      (!seg.priceListId || c.priceListId === seg.priceListId) &&
      (!seg.area || (c.area ?? "").toLowerCase() === seg.area.toLowerCase()),
  );
}

export interface Broadcast {
  id: string;
  name: string;
  template: string;
  params: string[];
  segment: BroadcastSegment;
  at: string;
  by: string;
  recipients: number;
  sent: number;
  failed: number;
  simulated: boolean;
}

// ───────────────────────────── Meta Cloud API formats ─────────────────────────────

export interface WaStatusUpdate {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  recipient: string;
  error?: string;
}

export interface WebhookBatch {
  phoneNumberId: string;
  messages: WaInbound[];
  statuses: WaStatusUpdate[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Reads a Cloud API webhook body (messages and delivery statuses), ignoring anything else. */
export function parseWebhook(body: unknown): WebhookBatch[] {
  const out: WebhookBatch[] = [];
  for (const entry of arr(obj(body).entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      const names = new Map(arr(value.contacts).map((c) => [str(obj(c).wa_id) ?? "", str(obj(obj(c).profile).name) ?? ""]));
      const messages: WaInbound[] = [];
      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const from = str(m.from);
        const id = str(m.id);
        if (!from || !id) continue;
        const at = new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()).toISOString();
        const base = { id, from, at, ...(names.get(from) ? { name: names.get(from)! } : {}) };
        const type = str(m.type);
        if (type === "text") messages.push({ ...base, type: "text", text: str(obj(m.text).body) ?? "" });
        else if (type === "interactive") {
          const i = obj(m.interactive);
          const reply = obj(i.button_reply ?? i.list_reply);
          messages.push({ ...base, type: "interactive", replyId: str(reply.id) ?? "", text: str(reply.title) ?? "" });
        } else if (type === "button") messages.push({ ...base, type: "text", text: str(obj(m.button).payload) ?? str(obj(m.button).text) ?? "" });
        else if (type === "image") {
          const img = obj(m.image);
          messages.push({ ...base, type: "image", image: { mediaId: str(img.id) ?? "", ...(str(img.caption) ? { caption: str(img.caption)! } : {}) } });
        } else if (type === "order") {
          const items = arr(obj(m.order).product_items).map((p) => ({ sku: str(obj(p).product_retailer_id) ?? "", qty: Number(obj(p).quantity ?? 0) }));
          messages.push({ ...base, type: "order", order: { items } });
        } else messages.push({ ...base, type: "other", text: `(${type ?? "unknown"} message)` });
      }
      const statuses: WaStatusUpdate[] = [];
      for (const raw of arr(value.statuses)) {
        const s = obj(raw);
        const status = str(s.status);
        if (!str(s.id) || !["sent", "delivered", "read", "failed"].includes(status ?? "")) continue;
        const err = obj(arr(s.errors)[0]);
        statuses.push({ wamid: str(s.id)!, status: status as WaStatusUpdate["status"], recipient: str(s.recipient_id) ?? "", ...(err.title || err.message ? { error: String(err.message ?? err.title) } : {}) });
      }
      out.push({ phoneNumberId, messages, statuses });
    }
  }
  return out;
}

/** The Cloud API request body for sending a message (limits: buttons 3 × 20 chars, list rows 10 × 24). */
export function cloudPayload(to: string, m: WaOutbound): Json {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (m.kind === "text") return { ...base, type: "text", text: { body: m.text.slice(0, 4096), preview_url: true } };
  if (m.kind === "buttons") return { ...base, type: "interactive", interactive: { type: "button", body: { text: m.text.slice(0, 1024) || "…" }, action: { buttons: m.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: clip(b.title, 20) } })) } } };
  if (m.kind === "list") return { ...base, type: "interactive", interactive: { type: "list", body: { text: m.text.slice(0, 1024) }, action: { button: clip(m.button, 20), sections: [{ title: clip(m.button, 24), rows: m.rows.slice(0, 10).map((r) => ({ id: r.id.slice(0, 200), title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}) })) }] } } };
  if (m.kind === "image") return { ...base, type: "image", image: { link: m.link, ...(m.caption ? { caption: m.caption.slice(0, 1024) } : {}) } };
  return { ...base, type: "template", template: { name: m.name, language: { code: m.language ?? "en" }, ...(m.params.length ? { components: [{ type: "body", parameters: m.params.map((p) => ({ type: "text", text: p })) }] } : {}) } };
}
