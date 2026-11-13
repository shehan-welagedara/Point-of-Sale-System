import type { Cents } from "@pos/engine";
import type { MemberRole, PosSettings, Role, Staff, Workstation } from "./types.js";

/**
 * Access control for the POS, modelled on Oracle MICROS Simphony / Simphony People Management:
 *
 *   Enterprise (the business) → Property (hotel / outlet) → Revenue Centre (restaurant, bar, room service)
 *
 * - An **employee** belongs to one or more properties and works in a set of revenue centres
 *   (Simphony "operator records").
 * - Each employee has a **role** per property (default role, overridable per property). A role is
 *   a set of **privileges** with numeric **limits** and a **level**: 1 is the most senior. A
 *   manager may authorise or manage only people whose role level is the same or more junior.
 * - Privileges marked "needs authorisation" in a role still require a second, senior employee to
 *   swipe or enter a PIN (manager override), and both people are written to the POS journal.
 */
export const PRIVILEGE_GROUPS = [
  {
    key: "signin",
    label: "Sign-in and time",
    privileges: {
      "pos.signIn": "Sign in to the POS",
      "pos.clockInOut": "Clock in and out (time and attendance)",
      "pos.changeRvc": "Switch to another revenue centre",
      "pos.unlockEmployee": "Unlock employees locked out after wrong PINs",
    },
  },
  {
    key: "checks",
    label: "Checks",
    privileges: {
      "pos.openCheck": "Begin and add to checks",
      "pos.pickupAnyCheck": "Pick up checks owned by other staff",
      "pos.transferCheck": "Transfer checks between staff or tables",
      "pos.splitCheck": "Split and merge checks",
      "pos.changeCovers": "Change covers or table after the check is begun",
      "pos.cancelCheck": "Cancel a check before anything is sent",
      "pos.reopenClosed": "Reopen a closed check (issues a credit note)",
    },
  },
  {
    key: "items",
    label: "Items and prices",
    privileges: {
      "pos.voidUnsent": "Remove items not yet sent to the kitchen",
      "pos.voidSent": "Void items already sent to the kitchen",
      "pos.priceOverride": "Override item prices",
      "pos.openPrice": "Sell open-price items",
      "pos.eightySix": "Mark items out of stock (86)",
    },
  },
  {
    key: "discounts",
    label: "Discounts",
    privileges: {
      "pos.discount": "Apply discounts",
      "pos.discountManager": "Apply manager-only discounts",
    },
  },
  {
    key: "payments",
    label: "Payments",
    privileges: {
      "pos.tender": "Take payments",
      "pos.comp": "Use complimentary / staff meal tenders",
      "pos.refund": "Refund and void closed checks",
    },
  },
  {
    key: "cash",
    label: "Cash management",
    privileges: {
      "pos.noSale": "Open the cash drawer without a sale",
      "pos.paidInOut": "Paid in / paid out of the drawer",
      "pos.reprint": "Reprint bills (marked COPY)",
    },
  },
  {
    key: "reports",
    label: "Reports",
    privileges: {
      "pos.reportsOwn": "View their own sales and cashier report",
      "pos.reports": "View revenue centre and property reports",
      "pos.journal": "View the POS transaction journal",
    },
  },
  {
    key: "manager",
    label: "Manager",
    privileges: {
      "pos.endOfDay": "Run End of Day",
      "pos.managerOverride": "Authorise privileged actions for other staff",
    },
  },
] as const;

type Group = (typeof PRIVILEGE_GROUPS)[number];
type KeysOf<G> = G extends { privileges: infer P } ? keyof P : never;
export type PrivilegeKey = KeysOf<Group> & string;

export const PRIVILEGES: Record<PrivilegeKey, string> = Object.assign({}, ...PRIVILEGE_GROUPS.map((g) => g.privileges));

const ALL = Object.keys(PRIVILEGES) as PrivilegeKey[];
const without = (...p: PrivilegeKey[]) => ALL.filter((k) => !p.includes(k));

/** Role levels: 1 = most senior. */
export const DEFAULT_ROLES: Role[] = [
  { id: "owner", name: "Owner / General Manager", level: 1, privileges: ALL, limits: {} },
  { id: "manager", name: "Outlet Manager", level: 10, privileges: ALL, limits: { maxDiscountBp: 5000 } },
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
    id: "supervisor",
    name: "Supervisor / Captain",
    level: 20,
    privileges: without("pos.endOfDay", "pos.reopenClosed", "pos.refund", "pos.unlockEmployee"),
    limits: { maxDiscountBp: 2000, maxVoidAmount: 10_000_00 },
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
  {
    id: "cashier",
    name: "Cashier",
    level: 40,
    privileges: ["pos.signIn", "pos.clockInOut", "pos.openCheck", "pos.pickupAnyCheck", "pos.voidUnsent", "pos.discount", "pos.splitCheck", "pos.tender", "pos.reprint", "pos.paidInOut", "pos.reportsOwn"],
    limits: { maxDiscountBp: 1000 },
    requireAuth: ["pos.paidInOut", "pos.reprint"],
  },
  { id: "server", name: "Server / Steward", level: 50, privileges: ["pos.signIn", "pos.clockInOut", "pos.openCheck", "pos.voidUnsent", "pos.splitCheck", "pos.changeCovers", "pos.reportsOwn"], limits: {} },
  { id: "bartender", name: "Bartender", level: 50, privileges: ["pos.signIn", "pos.clockInOut", "pos.openCheck", "pos.voidUnsent", "pos.tender", "pos.splitCheck", "pos.reportsOwn"], limits: {} },
  { id: "kitchen", name: "Kitchen", level: 70, privileges: ["pos.signIn", "pos.clockInOut", "pos.eightySix"], limits: {} },
  { id: "trainee", name: "Trainee", level: 90, privileges: ["pos.signIn", "pos.clockInOut", "pos.openCheck"], limits: {} },
];

export function hasPrivilege(role: Pick<Role, "privileges"> | undefined, p: PrivilegeKey): boolean {
  return Boolean(role?.privileges.includes(p));
}

/** May `role` do `p` on its own (has it, and the role doesn't demand a second person)? */
export function canPerform(role: Role | undefined, p: PrivilegeKey): boolean {
  return hasPrivilege(role, p) && !(role?.requireAuth ?? []).includes(p);
}

/** Effective role of an employee at a property (per-property role, else the default role). */
export function roleFor(staff: Pick<Staff, "roleId" | "propertyRoles">, propertyId: string, roles: readonly Role[]): Role | undefined {
  const id = staff.propertyRoles?.[propertyId] ?? staff.roleId;
  return roles.find((r) => r.id === id);
}

export const levelOf = (role: Role | undefined) => role?.level ?? 99;

export type LimitKind = "discountBp" | "voidAmount" | "priceOverrideBp" | "refundAmount" | "paidOutAmount";

/** Whether the role's limits cover an amount (no limit set = unlimited when the privilege is held). */
export function withinLimit(role: Role | undefined, kind: LimitKind, value: number): boolean {
  const l = role?.limits ?? {};
  const max = kind === "discountBp" ? l.maxDiscountBp : kind === "voidAmount" ? l.maxVoidAmount : kind === "priceOverrideBp" ? l.maxPriceOverrideBp : kind === "refundAmount" ? l.maxRefundAmount : l.maxPaidOut;
  return max === undefined || value <= max;
}

/**
 * Can `authorizer` approve privilege `p` (with an optional limit check) for `requester`?
 * Rules: a different, active person; holds the privilege and "manager override"; role level the
 * same or more senior than the requester's; the amount is within the authorizer's limit.
 */
export function canAuthorize(args: {
  authorizer: Staff;
  authorizerRole: Role | undefined;
  requester: Staff;
  requesterRole: Role | undefined;
  privilege: PrivilegeKey;
  limit?: { kind: LimitKind; value: number };
}): { ok: boolean; reason?: string } {
  const { authorizer, authorizerRole, requester, requesterRole, privilege, limit } = args;
  if (authorizer.id === requester.id) return { ok: false, reason: "Another person must authorise this" };
  if (authorizer.status !== "active" || authorizer.lockedAt) return { ok: false, reason: `${authorizer.name} cannot authorise (not active)` };
  if (!hasPrivilege(authorizerRole, privilege) || !hasPrivilege(authorizerRole, "pos.managerOverride")) return { ok: false, reason: `${authorizer.name} is not allowed to authorise this` };
  if (levelOf(authorizerRole) > levelOf(requesterRole)) return { ok: false, reason: `${authorizer.name}'s role is junior to ${requester.name}'s` };
  if (limit && !withinLimit(authorizerRole, limit.kind, limit.value)) return { ok: false, reason: `Above ${authorizer.name}'s limit` };
  return { ok: true };
}

/** May a manager edit/assign this role (only roles at their level or more junior)? */
export function canManageRole(managerRole: Role | undefined, target: Role | undefined): boolean {
  return levelOf(managerRole) <= levelOf(target);
}

// ───────────────────────────── Sign-in control ─────────────────────────────

export interface SignInDecision {
  ok: boolean;
  reason?: string;
  /** Revenue centres the employee may operate in on this workstation. */
  rvcIds: string[];
}

export const DEFAULT_SIGN_IN = { mode: "idPin" as NonNullable<PosSettings["signInMode"]>, maxFailedSignIns: 5, autoSignOutSeconds: 120, requireClockIn: false, pinMinLength: 4 };

/** Who may sign in where: status, lockout, employment dates, property and revenue-centre access. */
export function signInDecision(staff: Staff, role: Role | undefined, ws: Pick<Workstation, "propertyId" | "rvcId" | "allowedRvcIds">, allRvcIds: string[], today: string): SignInDecision {
  const deny = (reason: string): SignInDecision => ({ ok: false, reason, rvcIds: [] });
  if (staff.status !== "active") return deny("This employee is not active");
  if (staff.lockedAt) return deny("Locked after too many wrong PINs: a manager must unlock");
  if (staff.hireDate && today < staff.hireDate) return deny("Employment has not started");
  if (staff.terminationDate && today > staff.terminationDate) return deny("Employment has ended");
  if (staff.propertyIds?.length && !staff.propertyIds.includes(ws.propertyId)) return deny("Not set up for this property");
  if (!hasPrivilege(role, "pos.signIn")) return deny("This role may not sign in to the POS");
  const wsRvcs = ws.allowedRvcIds?.length ? ws.allowedRvcIds : [ws.rvcId];
  const mine = staff.rvcIds?.length ? staff.rvcIds : allRvcIds;
  const rvcIds = wsRvcs.filter((r) => mine.includes(r));
  if (!rvcIds.length) return deny("Not set up for this revenue centre");
  return { ok: true, rvcIds };
}

/** Next state after a wrong PIN: counts attempts and locks at the limit. */
export function afterFailedSignIn(staff: Staff, max: number, now: string): Pick<Staff, "failedSignIns" | "lockedAt"> {
  const failed = (staff.failedSignIns ?? 0) + 1;
  return failed >= max ? { failedSignIns: failed, lockedAt: now } : { failedSignIns: failed };
}

export function pinPolicyError(pin: string, minLength: number): string | null {
  if (!/^\d+$/.test(pin)) return "PIN must be digits only";
  if (pin.length < minLength || pin.length > 8) return `PIN must be ${minLength}–8 digits`;
  if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) return "PIN is too easy to guess";
  return null;
}

// ───────────────────────────── Back office ─────────────────────────────

/** Back-office access by member role: which areas a login may change. */
export const MEMBER_ROLE_INFO: Record<MemberRole, { label: string; description: string; canWrite: string[] }> = {
  owner: { label: "Owner", description: "Everything, including licence, modules and logins.", canWrite: ["*"] },
  admin: { label: "Administrator", description: "All configuration and logins, except removing the owner.", canWrite: ["*"] },
  manager: { label: "Manager", description: "Menu, prices, staff, reports, stock and POS operations.", canWrite: ["menu", "people", "inventory", "purchasing", "crm", "pos", "reports"] },
  accountant: { label: "Accountant", description: "Accounting, journals and reports; read-only elsewhere.", canWrite: ["accounting"] },
  storekeeper: { label: "Storekeeper", description: "Stock, receiving, counts, waste and purchase orders.", canWrite: ["inventory", "purchasing"] },
  auditor: { label: "Auditor", description: "Read-only access to everything, including the audit trail, integrity checks and audit exports.", canWrite: [] },
  viewer: { label: "Viewer", description: "Read-only access to reports and settings.", canWrite: [] },
  terminal: { label: "POS terminal", description: "Device login for POS terminals and tablets: checks, payments and print jobs only.", canWrite: ["pos"] },
};

export type { Cents };
