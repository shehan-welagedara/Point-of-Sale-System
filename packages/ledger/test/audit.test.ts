import { describe, expect, it } from "vitest";
import { type Invoice, COLLECTIONS as C, MemoryStore, invoiceHash, newId } from "@pos/core";
import {
  type AccountBalance,
  type AuditEvent,
  type LedgerEntry,
  type Voucher,
  LEDGER as L,
  defaultChartOfAccounts,
  diffDocs,
  generateSaft,
  makeAuditEvent,
  postPosDay,
  sealEvents,
  sequenceGaps,
  sodConflicts,
  sodViolations,
  submitVoucher,
  verifyAuditTrail,
  verifyInvoices,
  verifyLedger,
} from "../src/index.js";
import { NOW, alice, dayStats, journal, ledgerStore } from "./fixtures.js";

describe("audit trail", () => {
  it("records what changed, by whom, and seals events in a hash chain", async () => {
    expect(diffDocs({ id: "K1", price: 100, name: "Kottu" }, { id: "K1", price: 120, name: "Kottu" })).toEqual({ action: "update", changedFields: ["price"], before: { price: 100 }, after: { price: 120 } });
    expect(diffDocs(null, { id: "x", a: 1 }).action).toBe("create");
    expect(diffDocs({ id: "x" }, null).action).toBe("delete");
    expect(await makeAuditEvent({ id: "e", at: NOW, actorType: "user", collection: "c", docId: "d", before: { a: 1, updatedAt: "x" }, after: { a: 1, updatedAt: "y" } })).toBeNull();

    // A local store records every write through its hook.
    const store = new MemoryStore();
    const events: AuditEvent[] = [];
    store.onWrite = (w) => {
      void makeAuditEvent({ id: newId(), at: new Date().toISOString(), actorType: "user", actorId: "alice", collection: w.col, docId: w.id, before: w.before, after: w.after }).then((e) => e && events.push(e));
    };
    await store.set(C.menuItems, { id: "K001", price: 120_000, name: "Chicken Kottu" });
    await store.merge(C.menuItems, "K001", { price: 130_000 });
    await store.remove(C.menuItems, "K001");
    await new Promise((r) => setTimeout(r, 20));
    expect(events.map((e) => e.action)).toEqual(["create", "update", "delete"]);
    expect(events[1]).toMatchObject({ changedFields: ["price"], before: { price: 120_000 }, after: { price: 130_000 }, actorId: "alice" });

    const s1 = await sealEvents(events.slice(0, 2), null, NOW);
    const s2 = await sealEvents(events.slice(2), s1, NOW);
    expect(s2!.prevSealHash).toBe(s1!.sealHash);
    expect(await verifyAuditTrail(events, [s1!, s2!])).toEqual([]);

    // Editing, deleting or back-dating any event is detected.
    const edited = events.map((e, i) => (i === 1 ? { ...e, after: { price: 125_000 } } : e));
    expect((await verifyAuditTrail(edited, [s1!, s2!])).map((x) => x.message).join()).toMatch(/altered after it was recorded/);
    expect((await verifyAuditTrail(events.slice(1), [s1!, s2!])).map((x) => x.message).join()).toMatch(/no longer exist \(events deleted\)/);
    const inserted = { ...events[0]!, id: "00000000000000000000000000", at: "2026-01-01T00:00:00.000Z" };
    expect((await verifyAuditTrail([...events, inserted], [s1!, s2!])).map((x) => x.message).join()).toMatch(/not in any seal/);
    expect((await verifyAuditTrail(events, [{ ...s1!, count: 1 }, s2!])).map((x) => x.message).join()).toMatch(/Seal SEAL-00000001 was altered/);
    expect((await verifyAuditTrail(events, [s2!])).map((x) => x.message).join()).toMatch(/chain broken/);
  });
});

describe("ledger integrity", () => {
  it("passes on clean books and detects tampering with any posted figure", async () => {
    const { store, runner } = await ledgerStore({ journalApprovalThreshold: 1_000_000_00 });
    await store.set(L.vouchers, journal("j1", [{ account: "6100", debit: 150_000_00, credit: 0 }, { account: "1010", debit: 0, credit: 150_000_00 }]));
    await submitVoucher(runner, { voucherId: "j1", actor: alice, now: NOW });
    await store.set(C.dailyStats, dayStats(10_000_00, 4_000_00));
    await postPosDay(runner, { propertyId: "CMB", businessDate: "2026-11-03", actor: alice, now: NOW });
    const load = async () => [await store.list<Voucher>(L.vouchers), await store.list<LedgerEntry>(L.ledger), await store.list<AccountBalance>(L.balances)] as const;
    expect(await verifyLedger(...(await load()))).toEqual([]);

    const [v, e, b] = await load();
    const tamperedAmount = e.map((x) => (x.account === "6100" ? { ...x, debit: 100_000_00 } : x));
    const msgs = (await verifyLedger(v, tamperedAmount, b)).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/debits .* ≠ credits/);
    expect(msgs).toMatch(/hash mismatch/);
    expect(msgs).toMatch(/differs from the ledger/);
    const deleted = await verifyLedger(v.filter((x) => x.id !== "j1"), e.filter((x) => x.voucherId !== "j1"), b);
    expect(deleted.map((i) => i.message).join(" | ")).toMatch(/chain is broken|differs from the ledger/);
    expect(sodViolations([{ ...v[0]!, approvedBy: v[0]!.createdBy }])).toHaveLength(1);
  });

  it("verifies invoice chains and finds numbering gaps", async () => {
    const mk = async (id: string, prevHash: string, at: string): Promise<Invoice> => {
      const base = { id, checkId: id, workstationId: "W01", issuedAt: at, supplyDate: "2026-11-03", businessDate: "2026-11-03", vatRegistered: true, seller: { legalName: "S", tin: "1", addressLines: [] }, totals: {} as Invoice["totals"], prevHash };
      return { ...base, hash: await invoiceHash(base) };
    };
    const i1 = await mk("26NOV_W01_1", "", "2026-11-03T10:00:00Z");
    const i2 = await mk("26NOV_W01_2", i1.hash, "2026-11-03T11:00:00Z");
    const i4 = await mk("26NOV_W01_4", i2.hash, "2026-11-03T12:00:00Z");
    expect(await verifyInvoices([i1, i2, i4])).toEqual([]);
    expect((await verifyInvoices([i1, { ...i2, seller: { ...i2.seller, legalName: "Other" } }, i4])).length).toBe(1);
    expect(sequenceGaps([i1.id, i2.id, i4.id, "JV-202627-00001", "JV-202627-00003", "PAY-202627-00001"])).toEqual([
      { series: "26NOV_W01", missing: ["26NOV_W01_3"] },
      { series: "JV-202627-", missing: ["JV-202627-00002"] },
    ]);
  });

  it("flags incompatible duties", () => {
    const f = sodConflicts([
      { uid: "1", email: "o@x", name: "Owner", role: "owner" },
      { uid: "2", email: "a@x", name: "Accountant", role: "accountant" },
      { uid: "3", email: "s@x", name: "Storekeeper", role: "storekeeper" },
    ]);
    expect(f.filter((x) => x.member.role === "owner").map((x) => x.rule.id)).toEqual(["SOD-01", "SOD-02", "SOD-03"]);
    expect(f.filter((x) => x.member.role !== "owner")).toEqual([]);
  });
});

describe("SAF-T export", () => {
  it("writes the standard audit file with balanced journal totals", async () => {
    const { store, runner } = await ledgerStore({ journalApprovalThreshold: 1_000_000_00 });
    await store.set(L.vouchers, journal("j1", [{ account: "6100", debit: 150_000_00, credit: 0, memo: "Rent & <service>" }, { account: "1010", debit: 0, credit: 150_000_00 }]));
    await submitVoucher(runner, { voucherId: "j1", actor: alice, now: NOW });
    const xml = generateSaft({
      business: { id: "business", legalName: "Spice Lagoon (Pvt) Ltd", tradingName: "Spice Lagoon", tin: "100000000", vatRegistered: true, ssclLiable: false, addressLines: ["Colombo 03"], phone: "011", email: "a@b" },
      software: { name: "POS Suite", version: "0.2" },
      currency: "LKR",
      fromDate: "2026-11-01",
      toDate: "2026-11-30",
      accounts: defaultChartOfAccounts(),
      balances: await store.list(L.balances),
      entries: await store.list(L.ledger),
      vouchers: await store.list(L.vouchers),
      customers: [],
      suppliers: [{ id: "V1", code: "V1", name: "Fresh & Co", phone: "077", paymentTermsDays: 30, active: true }],
      taxes: [{ code: "VAT", description: "Value added tax", rateBp: 1800 }],
      createdAt: NOW,
    });
    expect(xml).toContain('<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:2.00">');
    expect(xml).toContain("<TotalDebit>150000.00</TotalDebit><TotalCredit>150000.00</TotalCredit>");
    expect(xml).toContain("Rent &amp; &lt;service&gt;");
    expect(xml).toContain("<Name>Fresh &amp; Co</Name>");
    for (const tag of ["Transaction", "Line", "Account", "Journal"]) {
      expect((xml.match(new RegExp(`<${tag}>`, "g")) ?? []).length).toBe((xml.match(new RegExp(`</${tag}>`, "g")) ?? []).length);
    }
  });
});
