import type { MemberRole, ModuleKey } from "@pos/core";

/**
 * The back office is split into workspaces (SAP Fiori launchpad / Oracle EMC module style):
 * the launchpad shows one tile per module, and each workspace opens with only its own
 * navigation. A workspace appears only when its module is licensed and switched on.
 */
export interface NavItem {
  to: string;
  label: string;
  ico: string;
  module?: ModuleKey;
  roles?: MemberRole[];
}

export interface Workspace {
  key: string;
  name: string;
  tagline: string;
  ico: string;
  /** Tile accent colour. */
  tone: string;
  group: "Operations" | "Back office" | "Finance and control" | "Administration";
  /** Shown when any of these modules is on (none = always). */
  modules?: ModuleKey[];
  roles?: MemberRole[];
  /** Opens outside the back-office shell (the POS). */
  external?: string;
  sections: { label?: string; items: NavItem[] }[];
}

const BOOKS: MemberRole[] = ["owner", "admin", "accountant", "auditor", "manager"];
const ADMINS: MemberRole[] = ["owner", "admin"];

export const WORKSPACES: Workspace[] = [
  {
    key: "pos",
    name: "Point of Sale",
    tagline: "Sign in at a workstation to take orders and payments",
    ico: "▶",
    tone: "#0f766e",
    group: "Operations",
    modules: ["pos"],
    external: "/pos",
    sections: [],
  },
  {
    key: "posconfig",
    name: "POS Configuration",
    tagline: "Revenue centres, devices, tenders, discounts and the POS look",
    ico: "⌨",
    tone: "#2563eb",
    group: "Operations",
    modules: ["pos"],
    sections: [
      { label: "Organisation", items: [{ to: "/emc/setup/organisation", label: "Properties & revenue centres", ico: "⌖" }, { to: "/emc/setup/devices", label: "Workstations & printers", ico: "⌨" }, { to: "/emc/pos/print-queue", label: "Print queue", ico: "⎙" }] },
      { label: "Service", items: [{ to: "/emc/pos/tables", label: "Tables", ico: "▦", module: "tables" }, { to: "/emc/pos/order-types", label: "Order types", ico: "⇄" }] },
      { label: "Payments and rules", items: [{ to: "/emc/pos/tenders", label: "Tender media", ico: "₨" }, { to: "/emc/pos/discounts", label: "Discounts", ico: "%" }, { to: "/emc/pos/reasons", label: "Reason codes", ico: "✎" }] },
      { label: "Look and feel", items: [{ to: "/emc/pos/appearance", label: "Terminal themes", ico: "◐" }, { to: "/emc/pos/mobile", label: "Mobile app style", ico: "▯" }, { to: "/emc/pos/bill", label: "Bill designer", ico: "🧾" }] },
    ],
  },
  {
    key: "menu",
    name: "Menu Management",
    tagline: "Items, prices, photos, modifiers, recipes and costing",
    ico: "☰",
    tone: "#d97706",
    group: "Operations",
    modules: ["pos", "recipes"],
    sections: [
      { items: [{ to: "/emc/menu/items", label: "Menu items", ico: "☰" }, { to: "/emc/menu/categories", label: "Categories", ico: "▣" }, { to: "/emc/menu/modifiers", label: "Modifiers", ico: "⊕" }] },
      { label: "Costing", items: [{ to: "/emc/recipes", label: "Recipes & costing", ico: "⚖", module: "recipes" }] },
    ],
  },
  {
    key: "inventory",
    name: "Inventory & Purchasing",
    tagline: "Stock, FIFO valuation, purchase orders, receiving and counts",
    ico: "▥",
    tone: "#7c3aed",
    group: "Back office",
    modules: ["inventory"],
    sections: [
      { label: "Stock", items: [{ to: "/emc/inventory/stock", label: "Stock on hand", ico: "▥" }, { to: "/emc/inventory/items", label: "Stock items", ico: "◫" }, { to: "/emc/inventory/counts", label: "Stock counts", ico: "✓" }, { to: "/emc/inventory/adjust", label: "Waste & transfers", ico: "⇣" }, { to: "/emc/inventory/movements", label: "Movements", ico: "≡" }] },
      { label: "Purchasing", items: [{ to: "/emc/inventory/po", label: "Purchase orders", ico: "✉", module: "purchasing" }, { to: "/emc/inventory/grn", label: "Goods receipts", ico: "⬇", module: "purchasing" }, { to: "/emc/inventory/vendors", label: "Vendors", ico: "⌂", module: "purchasing" }] },
    ],
  },
  {
    key: "crm",
    name: "Customers",
    tagline: "Guest profiles, visits, loyalty and business buyers",
    ico: "☺",
    tone: "#db2777",
    group: "Back office",
    modules: ["crm"],
    sections: [{ items: [{ to: "/emc/crm/customers", label: "Customers", ico: "☺" }] }],
  },
  {
    key: "insights",
    name: "Reports & Analytics",
    tagline: "Daily revenue, item sales, covers, menu engineering",
    ico: "▤",
    tone: "#0891b2",
    group: "Back office",
    sections: [{ items: [{ to: "/emc/dashboard", label: "Dashboard", ico: "◎" }, { to: "/emc/reports", label: "Reports", ico: "▤" }, { to: "/emc/revenue/engineering", label: "Menu engineering", ico: "◆", module: "revenue" }] }],
  },
  {
    key: "finance",
    name: "Finance",
    tagline: "General ledger, payables, receivables, bank, assets and close",
    ico: "Σ",
    tone: "#15803d",
    group: "Finance and control",
    modules: ["accounting"],
    roles: BOOKS,
    sections: [
      { items: [{ to: "/emc/finance", label: "Overview", ico: "◎" }, { to: "/emc/finance/approvals", label: "Approvals", ico: "✓" }] },
      { label: "Transactions", items: [{ to: "/emc/finance/journals", label: "Journals", ico: "⎘" }, { to: "/emc/finance/payables", label: "Payables", ico: "↗" }, { to: "/emc/finance/receivables", label: "Receivables", ico: "↙" }, { to: "/emc/finance/bank", label: "Bank reconciliation", ico: "⌂" }, { to: "/emc/finance/assets", label: "Fixed assets", ico: "▣" }, { to: "/emc/finance/documents", label: "All documents", ico: "≡" }] },
      { label: "Reporting and close", items: [{ to: "/emc/finance/statements", label: "Financial statements", ico: "Σ" }, { to: "/emc/finance/budgets", label: "Budgets", ico: "◔" }, { to: "/emc/finance/periods", label: "Period close", ico: "⏏" }] },
      { label: "Setup", items: [{ to: "/emc/finance/accounts", label: "Chart of accounts", ico: "#" }, { to: "/emc/finance/settings", label: "Finance settings", ico: "↔" }] },
    ],
  },
  {
    key: "audit",
    name: "Audit Center",
    tagline: "Audit trail, POS journal, integrity checks and data quality",
    ico: "⛨",
    tone: "#b91c1c",
    group: "Finance and control",
    roles: ["owner", "admin", "auditor", "accountant", "manager"],
    sections: [
      { items: [{ to: "/emc/audit?tab=integrity", label: "Integrity", ico: "⛨" }, { to: "/emc/audit?tab=trail", label: "System audit trail", ico: "≡" }, { to: "/emc/audit?tab=journal", label: "POS transaction journal", ico: "⎘" }, { to: "/emc/audit?tab=exceptions", label: "Exceptions by employee", ico: "!" }, { to: "/emc/audit?tab=quality", label: "Data quality", ico: "✓" }] },
      { label: "Controls", items: [{ to: "/emc/audit?tab=numbering", label: "Numbering", ico: "#" }, { to: "/emc/audit?tab=sod", label: "Segregation of duties", ico: "⇋" }, { to: "/emc/audit?tab=access", label: "Access review", ico: "⚿" }, { to: "/emc/audit?tab=exports", label: "Auditor exports", ico: "⇪" }] },
    ],
  },
  {
    key: "people",
    name: "People & Security",
    tagline: "Employees, roles and privileges, revenue-centre access, logins",
    ico: "☻",
    tone: "#9333ea",
    group: "Administration",
    sections: [
      { label: "POS", items: [{ to: "/emc/people/staff", label: "Employees", ico: "☻" }, { to: "/emc/people/roles", label: "Roles & privileges", ico: "⚑" }, { to: "/emc/people/timecards", label: "Time cards", ico: "◷" }, { to: "/emc/people/signin", label: "Sign-in policy", ico: "⚿" }] },
      { label: "Back office", items: [{ to: "/emc/people/logins", label: "Back-office logins", ico: "⚿", roles: ADMINS }] },
    ],
  },
  {
    key: "admin",
    name: "Administration",
    tagline: "Business and tax, branding, licence and modules, integrations",
    ico: "⚙",
    tone: "#475569",
    group: "Administration",
    sections: [
      { items: [{ to: "/emc/setup/business", label: "Business & tax", ico: "⚙" }, { to: "/emc/setup/branding", label: "Branding", ico: "✦" }, { to: "/emc/setup/licence", label: "Licence & modules", ico: "⧉" }, { to: "/emc/setup/integrations", label: "Integrations", ico: "⟲" }, { to: "/emc/setup/data", label: "Excel import & export", ico: "⇪" }] },
    ],
  },
];

export function visibleWorkspaces(on: (m: ModuleKey) => boolean, role: MemberRole | null): Workspace[] {
  return WORKSPACES.filter((w) => (!w.modules || w.modules.some(on)) && (!w.roles || !role || w.roles.includes(role)));
}

/** The workspace a back-office path belongs to. */
export function workspaceFor(pathname: string, search: string): Workspace | undefined {
  const full = pathname + search;
  let best: { w: Workspace; len: number } | undefined;
  for (const w of WORKSPACES) {
    for (const s of w.sections) {
      for (const i of s.items) {
        const base = i.to.split("?")[0]!;
        const hit = full.startsWith(i.to) || pathname === base || pathname.startsWith(`${base}/`);
        if (hit && (!best || base.length > best.len)) best = { w, len: base.length };
      }
    }
  }
  return best?.w;
}
