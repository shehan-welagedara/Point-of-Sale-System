import type { MemberRole, Role } from "./types.js";

/** POS privilege catalogue (Simphony-style operator privileges). */
export const PRIVILEGES = {
  "pos.signIn": "Sign in to the POS",
  "pos.openCheck": "Begin and add to checks",
  "pos.pickupAnyCheck": "Pick up checks owned by other staff",
  "pos.transferCheck": "Transfer checks between staff or tables",
  "pos.voidUnsent": "Remove items not yet sent to the kitchen",
  "pos.voidSent": "Void items already sent to the kitchen",
  "pos.discount": "Apply discounts",
  "pos.discountManager": "Apply discounts that need a manager",
  "pos.priceOverride": "Override item prices",
  "pos.splitCheck": "Split and merge checks",
  "pos.tender": "Take payments",
  "pos.refund": "Refund and void closed checks",
  "pos.reprint": "Reprint bills (marked COPY)",
  "pos.noSale": "Open the cash drawer without a sale",
  "pos.comp": "Use complimentary / staff meal tenders",
  "pos.eightySix": "Mark items out of stock (86)",
  "pos.endOfDay": "Run End of Day",
  "pos.reports": "View POS reports",
  "pos.managerOverride": "Authorise privileged actions for other staff",
} as const;

export type PrivilegeKey = keyof typeof PRIVILEGES;

const ALL = Object.keys(PRIVILEGES) as PrivilegeKey[];

export const DEFAULT_ROLES: Role[] = [
  { id: "owner", name: "Owner", privileges: ALL },
  { id: "manager", name: "Manager", privileges: ALL },
  {
    id: "cashier",
    name: "Cashier",
    privileges: ["pos.signIn", "pos.openCheck", "pos.pickupAnyCheck", "pos.voidUnsent", "pos.discount", "pos.splitCheck", "pos.tender", "pos.reprint"],
  },
  { id: "server", name: "Server / Steward", privileges: ["pos.signIn", "pos.openCheck", "pos.voidUnsent", "pos.splitCheck"] },
  { id: "kitchen", name: "Kitchen", privileges: ["pos.signIn", "pos.eightySix"] },
];

export function hasPrivilege(role: Pick<Role, "privileges"> | undefined, p: PrivilegeKey): boolean {
  return Boolean(role?.privileges.includes(p));
}

/** Back-office access by member role: which areas a login may change. */
export const MEMBER_ROLE_INFO: Record<MemberRole, { label: string; description: string; canWrite: string[] }> = {
  owner: { label: "Owner", description: "Everything, including modules, billing details and logins.", canWrite: ["*"] },
  admin: { label: "Administrator", description: "All configuration and logins, except removing the owner.", canWrite: ["*"] },
  manager: { label: "Manager", description: "Menu, prices, staff, reports, stock and POS operations.", canWrite: ["menu", "people", "inventory", "purchasing", "crm", "pos", "reports"] },
  accountant: { label: "Accountant", description: "Accounting, journals and reports; read-only elsewhere.", canWrite: ["accounting"] },
  storekeeper: { label: "Storekeeper", description: "Stock, receiving, counts, waste and purchase orders.", canWrite: ["inventory", "purchasing"] },
  auditor: { label: "Auditor", description: "Read-only access to everything, including the audit trail, integrity checks and audit exports.", canWrite: [] },
  viewer: { label: "Viewer", description: "Read-only access to reports and settings.", canWrite: [] },
  terminal: { label: "POS terminal", description: "Device login for POS terminals and tablets: checks, payments and print jobs only.", canWrite: ["pos"] },
};
