import { describe, expect, it } from "vitest";
import {
  type BotContext,
  type Customer,
  type IntegrationSettings,
  type SalesOrder,
  type Style,
  type WaConversation,
  type WaInbound,
  type WaMessage,
  COLLECTIONS as C,
  MemoryStore,
  WA,
  WHOLESALE,
  addLot,
  botReply,
  broadcastAudience,
  catalogueItems,
  emptyLevel,
  handleInbound,
  inServiceWindow,
  orderMessage,
  saveStyle,
} from "../src/index.js";

const tee: Style = {
  id: "OVS01",
  code: "ZX-OVS01",
  name: "Oversized tee",
  category: "Oversized",
  sizes: ["M", "L"],
  colours: [{ name: "Black" }, { name: "White" }],
  price: 1_450_00,
  cost: 780_00,
  tiers: [{ minQty: 12, price: 1_250_00 }],
  active: true,
};

const conv0: WaConversation = { id: "94771234567", step: "idle", cart: [], mode: "bot", unread: 0, updatedAt: "" };
let n = 0;
const msg = (m: Partial<WaInbound>): WaInbound => ({ id: `wamid.${++n}`, from: "94771234567", at: "2026-11-13T10:00:00Z", type: m.replyId ? "interactive" : "text", ...m });
const ctx = (over: Partial<BotContext> = {}): BotContext => ({ businessName: "Zevix", styles: [tee], available: new Map([["ZX-OVS01-BLACK-M", 40], ["ZX-OVS01-BLACK-L", 5]]), orders: [], paymentLink: false, bankDetails: "BOC 0001234567, Zevix (Pvt) Ltd", ...over });

describe("WhatsApp ordering assistant", () => {
  it("takes an order: design, colour, size, quantity with stock and tier prices, address, payment", () => {
    let r = botReply(conv0, msg({ text: "Hi" }), ctx());
    expect(r.replies[0]).toMatchObject({ kind: "buttons", text: expect.stringContaining("Zevix") });
    r = botReply(r.conv, msg({ replyId: "m:order" }), ctx());
    expect(r.replies[0]).toMatchObject({ kind: "list", rows: [{ id: "s:OVS01", title: "Oversized tee" }] });
    r = botReply(r.conv, msg({ replyId: "s:OVS01" }), ctx());
    expect(r.replies[0]!.kind === "text" && r.replies[0].text).toContain("12+ pcs: Rs 1,250.00");
    expect(r.replies[1]).toMatchObject({ kind: "buttons", buttons: [{ id: "c:Black" }, { id: "c:White" }] });
    r = botReply(r.conv, msg({ replyId: "c:Black" }), ctx());
    expect(r.replies[0]).toMatchObject({ kind: "list", rows: [{ id: "z:M", description: "40 in stock" }, { id: "z:L", description: "5 in stock" }] });
    r = botReply(r.conv, msg({ replyId: "z:L" }), ctx());
    // More than in stock is refused.
    const short = botReply(r.conv, msg({ text: "8" }), ctx());
    expect(short.replies[0]).toMatchObject({ text: expect.stringContaining("only 5 left") });
    expect(short.conv.cart).toHaveLength(0);
    r = botReply(r.conv, msg({ text: "5 pcs" }), ctx());
    expect(r.conv.cart).toEqual([{ styleId: "OVS01", colour: "Black", size: "L", qty: 5 }]);
    expect(r.replies[0]!.kind === "buttons" && r.replies[0].text).toContain("Tip: 7 more of this design gets Rs 1,250.00");
    // Add 10 in M: 15 of the design, so the 12+ tier applies to all lines.
    r = botReply(r.conv, msg({ replyId: "c:more" }), ctx());
    r = botReply(r.conv, msg({ replyId: "s:OVS01" }), ctx());
    r = botReply(r.conv, msg({ replyId: "c:Black" }), ctx());
    r = botReply(r.conv, msg({ replyId: "z:M" }), ctx());
    r = botReply(r.conv, msg({ text: "10" }), ctx());
    expect(r.replies[0]!.kind === "buttons" && r.replies[0].text).toContain("*Total Rs 18,750.00* (15 pcs)");
    r = botReply(r.conv, msg({ replyId: "c:checkout" }), ctx());
    expect(r.conv.step).toBe("address");
    r = botReply(r.conv, msg({ text: "No 5, Main St, Kandy. 0771234567" }), ctx());
    expect(r.replies[0]).toMatchObject({ kind: "buttons", buttons: [{ id: "p:bank" }, { id: "p:cod" }] });
    r = botReply(r.conv, msg({ replyId: "p:bank" }), ctx());
    expect(r.order).toEqual({ lines: [{ styleId: "OVS01", colour: "Black", size: "L", qty: 5 }, { styleId: "OVS01", colour: "Black", size: "M", qty: 10 }], address: "No 5, Main St, Kandy. 0771234567", payment: "bank" });
    expect(r.replies[0]!.kind === "text" && r.replies[0].text).toContain("BOC 0001234567");
    expect(r.conv).toMatchObject({ step: "idle", cart: [] });
  });

  it("offers credit to shops with a limit, takes catalogue carts, slips, opt-out and hands over to a person", () => {
    let r = botReply({ ...conv0, step: "address", cart: [{ styleId: "OVS01", colour: "Black", size: "M", qty: 12 }] }, msg({ replyId: "a:saved" }), ctx({ customer: { id: "C1", name: "Lanka Fashion", address: "Galle Rd, Colombo 3", creditLimit: 500_000_00 } }));
    expect(r.conv.address).toBe("Galle Rd, Colombo 3");
    expect(r.replies[0]).toMatchObject({ buttons: [{ id: "p:bank" }, { id: "p:cod" }, { id: "p:credit" }] });

    r = botReply(conv0, msg({ type: "order", order: { items: [{ sku: "ZX-OVS01-WHITE-M", qty: 24 }, { sku: "NOPE", qty: 1 }] } }), ctx());
    expect(r.conv.cart).toEqual([{ styleId: "OVS01", colour: "White", size: "M", qty: 24 }]);

    r = botReply(conv0, msg({ type: "image", image: { mediaId: "M1", caption: "paid" } }), ctx({ orders: [{ id: "O1", number: "SO-000004", status: "draft", total: 18_750_00, paid: 0, paymentStatus: "unpaid" }] }));
    expect(r.slip).toEqual({ orderId: "O1", mediaId: "M1", caption: "paid" });

    expect(botReply(conv0, msg({ text: "STOP" }), ctx()).optOut).toBe(true);
    r = botReply(conv0, msg({ replyId: "m:human" }), ctx({ hours: "9am to 6pm" }));
    expect(r).toMatchObject({ handoff: true, conv: { mode: "human" } });
    // While staff handle it, the assistant stays quiet until the customer asks for the menu.
    expect(botReply(r.conv, msg({ text: "do you have red?" }), ctx()).replies).toEqual([]);
    expect(botReply(r.conv, msg({ text: "menu" }), ctx()).conv.mode).toBe("bot");
  });
});

describe("WhatsApp on the store", () => {
  const settings: IntegrationSettings["whatsapp"] = { mode: "mock", phoneNumberId: "", eodRecipients: [], eodTime: "23:00", bot: { enabled: true }, bankDetails: "BOC 0001234567" };
  it("creates the customer, the draft order and the payment slip, and ignores Meta's retries", async () => {
    const store = new MemoryStore();
    await saveStyle(store, tee);
    await store.set(C.stockLevels, addLot(emptyLevel("MAIN", "ZX-OVS01-BLACK-M"), { lotId: "L1", receivedAt: "2026-11-01", qty: 30, unitCost: 760_00, source: "grn" }));
    const opts = { settings, businessName: "Zevix", vatRateBp: 0, paymentLink: false, now: new Date("2026-11-13T10:00:00Z") };
    const send = (m: Partial<WaInbound>) => handleInbound(store, { ...msg(m), name: "Nimal" }, opts);
    await send({ text: "hi" });
    const customer = (await store.list<Customer>(C.customers))[0]!;
    expect(customer).toMatchObject({ name: "Nimal", whatsapp: "94771234567", phone: "+94771234567" });
    await send({ replyId: "s:OVS01" });
    await send({ replyId: "c:Black" });
    await send({ replyId: "z:M" });
    await send({ text: "12" });
    await send({ replyId: "c:checkout" });
    await send({ text: "12 Temple Rd, Negombo" });
    const done = await send({ replyId: "p:cod" });
    expect(done.order).toMatchObject({ number: "SO-000001", status: "draft", channel: "whatsapp", customerId: customer.id, total: 12 * 1_250_00, delivery: { method: "courier", cod: true, codAmount: 12 * 1_250_00, address: "12 Temple Rd, Negombo" }, conversationId: "94771234567" });
    expect((await store.get<Customer>(C.customers, customer.id))!.address).toBe("12 Temple Rd, Negombo");
    const slip = await send({ type: "image", image: { mediaId: "MEDIA1" } });
    expect(slip.replies[0]).toMatchObject({ text: expect.stringContaining("SO-000001") });
    const order = (await store.get<SalesOrder>(WHOLESALE.salesOrders, done.order!.id))!;
    expect(order.payments).toMatchObject([{ method: "bank", amount: 15_000_00, proofAttachmentId: "MEDIA1", status: "pending" }]);
    expect(order.paymentStatus).toBe("unpaid");
    const conv = (await store.get<WaConversation>(WA.conversations, "94771234567"))!;
    expect(conv.unread).toBe(9);
    // A delivery Meta retries with the same id is ignored.
    const retry = await handleInbound(store, { id: "wamid.dup", from: "94771234567", at: "", type: "text", text: "STOP" }, opts);
    expect(retry.replies).toHaveLength(1);
    expect((await handleInbound(store, { id: "wamid.dup", from: "94771234567", at: "", type: "text", text: "STOP" }, opts)).replies).toEqual([]);
    expect((await store.list<WaMessage>(WA.messages)).filter((m) => m.direction === "in")).toHaveLength(10);
    expect((await store.get<Customer>(C.customers, customer.id))!.whatsappOptOutAt).toBeTruthy();
  });

  it("uses free text inside 24 hours and approved templates outside", () => {
    const o = { id: "O", number: "SO-000007", lines: [{ name: "Oversized tee", colour: "Black", size: "M", qty: 12 }], total: 15_000_00, paid: 5_000_00, delivery: { method: "courier", cod: true, codAmount: 10_000_00, trackingNo: "TRK9" } } as unknown as SalesOrder;
    expect(inServiceWindow({ lastInboundAt: "2026-11-13T00:00:00Z" }, new Date("2026-11-13T23:00:00Z"))).toBe(true);
    expect(inServiceWindow({ lastInboundAt: "2026-11-12T00:00:00Z" }, new Date("2026-11-13T01:00:00Z"))).toBe(false);
    expect(orderMessage("dispatch", o, { businessName: "Zevix", inWindow: true }).message).toMatchObject({ kind: "text", text: expect.stringContaining("Please pay Rs 10,000.00 to the courier") });
    expect(orderMessage("reminder", o, { businessName: "Zevix", inWindow: false })).toEqual({ needsTemplate: "payment_reminder" });
    expect(orderMessage("reminder", o, { businessName: "Zevix", inWindow: false, templates: { payment_reminder: "zevix_payment_due" }, language: "en" }).message).toEqual({ kind: "template", name: "zevix_payment_due", params: ["Rs 10,000.00", "SO-000007"], language: "en" });
  });

  it("builds the catalogue feed and the broadcast audience", () => {
    const items = catalogueItems([tee, { ...tee, id: "X", code: "X", publish: false }], new Map([["ZX-OVS01-BLACK-M", 3]]), { currency: "LKR", imageUrl: (id) => `https://img/${id}.jpg`, link: "https://wa.me/94770000000", brand: "Zevix" });
    expect(items).toHaveLength(4);
    expect(items[0]!.data).toMatchObject({ id: "ZX-OVS01-BLACK-M", item_group_id: "ZX-OVS01", availability: "in stock", price: "1450.00 LKR", size: "M", color: "Black" });
    expect(items[1]!.data.availability).toBe("out of stock");
    const base = { visits: 0, totalSpend: 0, points: 0, createdAt: "", marketingConsent: true, tags: ["retail"] } as unknown as Customer;
    const people = [
      { ...base, id: "a", name: "A", whatsapp: "1", whatsappOptIn: true },
      { ...base, id: "b", name: "B", whatsapp: "2", whatsappOptIn: true, whatsappOptOutAt: "2026-11-01" },
      { ...base, id: "c", name: "C", whatsapp: "3" },
      { ...base, id: "d", name: "D", whatsapp: "4", whatsappOptIn: true, tags: ["shops"], area: "Kandy" },
    ];
    expect(broadcastAudience(people, {}).map((c) => c.id)).toEqual(["a", "d"]);
    expect(broadcastAudience(people, { tags: ["shops"], area: "kandy" }).map((c) => c.id)).toEqual(["d"]);
  });
});
