import { COLLECTIONS as C, DEFAULT_ROLES, type ModuleKey, type WriteOp } from "@pos/core";
import { defaultChartOfAccounts, defaultCostCenters, LEDGER as L } from "@pos/ledger";
import { sampleTenders } from "./index.js";

/** Outlet id of a new business (one outlet; more can be added under POS Configuration). */
export const STARTER_PROPERTY_ID = "MAIN";
export const STARTER_LOCATION_ID = "MAIN";

/**
 * The basics every new client business needs, so it is usable at once:
 * - the outlet and its cost centre;
 * - revenue centres, order types, payment methods and reason codes (POS);
 * - the main store (inventory);
 * - the standard roles;
 * - the Sri Lankan restaurant chart of accounts (accounting).
 * Parts are included only for the modules the client chose, so the security rules accept them.
 * Pass `existing` (collection → ids) to add only what is missing (Setup checklist).
 */
export function starterConfig(args: { name: string; addressLines?: string[]; modules: Partial<Record<ModuleKey, boolean>>; existing?: Partial<Record<string, Set<string>>> }): WriteOp[] {
  const ops: WriteOp[] = [];
  const put = (col: string, data: { id: string } & Record<string, unknown>) => {
    if (!args.existing?.[col]?.has(data.id)) ops.push({ op: "set", col, data });
  };
  const on = (m: ModuleKey) => Boolean(args.modules[m]);
  put(C.properties, { id: STARTER_PROPERTY_ID, code: STARTER_PROPERTY_ID, name: args.name, addressLines: args.addressLines ?? [], active: true });
  DEFAULT_ROLES.forEach((r) => put(C.roles, { ...r }));
  if (on("pos")) {
    put(C.revenueCenters, { id: "RESTAURANT", propertyId: STARTER_PROPERTY_ID, code: "RESTAURANT", name: "Restaurant", serviceMode: "table", defaultOrderTypeId: "dine-in", active: true });
    put(C.revenueCenters, { id: "TAKEAWAY", propertyId: STARTER_PROPERTY_ID, code: "TAKEAWAY", name: "Takeaway", serviceMode: "quick", defaultOrderTypeId: "takeaway", active: true });
    ([["dine-in", "Dine-in", true], ["takeaway", "Takeaway", false], ["delivery", "Delivery", false]] as const).forEach(([id, name, requiresTable], i) => put(C.orderTypes, { id, name, requiresTable, sortOrder: i + 1, active: true }));
  }
  sampleTenders().filter((t) => t.type !== "foreignCash" || on("pos")).forEach((t) => put(C.tenderMedia, { ...t, active: t.type === "cash" || t.type === "card" || (t.type === "lankaqr" && on("lankaqr")) || (t.type === "payhere" && on("payhere")) }));
  const reasons: [string, string][] = [["void", "Customer changed mind"], ["void", "Wrong entry"], ["void", "Kitchen error"], ["refund", "Quality complaint"], ["comp", "Guest recovery"], ["waste", "Spoiled"], ["waste", "Expired"], ["waste", "Burnt / dropped"], ["waste", "Spillage"], ["paidOut", "Petty cash purchase"]];
  reasons.forEach(([type, name], i) => put(C.reasonCodes, { id: `RC${String(i + 1).padStart(2, "0")}`, type, name }));
  if (on("inventory")) put(C.locations, { id: STARTER_LOCATION_ID, name: "Main store", isDefault: true });
  if (on("accounting")) {
    defaultChartOfAccounts().forEach((a) => put(C.accounts, a as unknown as { id: string }));
    defaultCostCenters([{ id: STARTER_PROPERTY_ID, name: args.name }]).forEach((cc) => put(L.costCenters, cc as unknown as { id: string }));
  }
  return ops;
}
