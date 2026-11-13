/**
 * Adds the standard POS roles "IT / System administrator" and "Finance / Accountant" (1.10.1) to
 * businesses that already have roles. Nothing is changed when a business has a role with the same
 * id or name. The definitions match DEFAULT_ROLES in packages/core/src/privileges.ts (checked by the
 * core tests).
 */
export const id = "0005-it-finance-roles";
export const description = "Add the POS roles IT / System administrator and Finance / Accountant";

export const ROLES = [
  {
    id: "itadmin",
    name: "IT / System administrator",
    level: 15,
    privileges: ["pos.signIn", "pos.clockInOut", "pos.changeRvc", "pos.unlockEmployee", "pos.openCheck", "pos.voidUnsent", "pos.cancelCheck", "pos.reprint", "pos.noSale", "pos.reports", "pos.journal"],
    limits: {},
    requireAuth: ["pos.noSale"],
    description: "Sets up and supports devices and printers: test checks, reprints, unlocking employees, the journal and reports. No payments, refunds or discounts.",
  },
  {
    id: "finance",
    name: "Finance / Accountant",
    level: 25,
    privileges: ["pos.signIn", "pos.clockInOut", "pos.changeRvc", "pos.reprint", "pos.paidInOut", "pos.noSale", "pos.reports", "pos.reportsOwn", "pos.journal", "pos.endOfDay"],
    limits: {},
    requireAuth: ["pos.noSale"],
    description: "Cash-up and day close: paid in and out, reports, the journal and End of Day. Doesn't take orders or authorise other staff.",
  },
];

export async function up({ db, log }) {
  let added = 0;
  for (const t of (await db.collection("tenants").get()).docs) {
    const roles = t.ref.collection("roles");
    const existing = (await roles.get()).docs;
    if (!existing.length) continue;
    const names = new Set(existing.map((d) => String(d.data().name ?? "").trim().toLowerCase()));
    for (const r of ROLES) {
      if (existing.some((d) => d.id === r.id) || names.has(r.name.toLowerCase())) continue;
      await roles.doc(r.id).set(r);
      added++;
    }
  }
  log(`added ${added} role(s)`);
  return { added };
}
