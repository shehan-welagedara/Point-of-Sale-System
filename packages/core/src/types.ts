import type { CheckTotals, Cents, BasisPoints } from "@pos/engine";
import type { ModuleKey } from "./modules.js";
import type { Edition, Entitlements } from "./licensing.js";

/**
 * Domain model. Every document lives in a tenant-scoped collection (see `COLLECTIONS`) and carries
 * its own `id`. Money is integer cents (LKR × 100); timestamps are ISO-8601 strings; business dates
 * are `YYYY-MM-DD`. Codes (menu item code, inventory code…) double as document ids so Excel
 * round-trips are simple upserts.
 */

export interface Entity {
  id: string;
}

// ───────────────────────────── Tenant & settings ─────────────────────────────

export interface Tenant extends Entity {
  name: string;
  ownerUid: string;
  /** Modules the administrator has switched on (always within the entitlement). */
  modules: Partial<Record<ModuleKey, boolean>>;
  /** Edition in force: "demo"/"trial" until a licence key is activated. */
  plan: Edition;
  /** What the business may use (from the licence, or the built-in trial/demo). */
  entitlements?: Entitlements;
  /** Activated licence (written by the server after verifying the vendor's signature). */
  licence?: TenantLicence;
  trialEndsAt?: string;
  status: "active" | "suspended";
  createdAt: string;
}

export interface TenantLicence {
  token: string;
  licenceId: string;
  licensee: string;
  edition: Edition;
  addOns: ModuleKey[];
  billing: "subscription" | "perpetual" | "trial";
  validFrom: string;
  expiresAt: string;
  graceDays: number;
  activatedAt: string;
  activatedBy: string;
  /** True when signed with the public demo key (not for live trading). */
  demoKey?: boolean;
}

export interface BusinessSettings extends Entity {
  id: "business";
  legalName: string;
  tradingName: string;
  /** 9-digit TIN as printed on the VAT registration certificate. */
  tin: string;
  vatRegistered: boolean;
  ssclLiable: boolean;
  addressLines: string[];
  phone: string;
  email: string;
  website?: string;
  /** Marks data that is sample-only so the UI can warn before go-live. */
  isSample?: boolean;
}

export interface BrandingSettings extends Entity {
  id: "branding";
  /** Name shown in the app chrome (the restaurant brand). */
  displayName: string;
  /** Small PNG/SVG data URL (kept under ~300 KB so it fits in Firestore, no Cloud Storage needed). */
  logoDataUrl?: string;
  primaryColor: string;
  accentColor: string;
  receiptHeaderLines: string[];
  receiptFooterLines: string[];
  /** Product name of the software itself ("Powered by …"). */
  poweredBy: string;
  /** Picture at the top of the mobile sign-in screen (resized, kept in Firestore). */
  heroImageDataUrl?: string;
  /** Which elements the printed bills show (empty = the standard layout). */
  bill?: Partial<BillLayout>;
}

/**
 * What a guest check / invoice prints, set by the administrator (Bill designer). Elements the
 * Inland Revenue requires on a tax invoice (VAT-registered sellers) are always printed there,
 * whatever these switches say: the title, the seller's name, address and TIN, the invoice number,
 * invoice and supply dates, the items, the value excluding VAT, the VAT and the total, and the
 * purchaser's details when the buyer gives a TIN.
 */
export interface BillLayout {
  /**
   * Print the final bill as an IRD TAX INVOICE. Only a VAT-registered business can (Business &
   * tax); otherwise, or when switched off, the final bill is a standard Sri Lankan bill (Bill No,
   * date, items, charges, total; no TIN or tax-invoice wording). A registered seller's bill for a
   * VAT-registered buyer (purchaser TIN) is always a tax invoice.
   */
  taxInvoice: boolean;
  // Header
  showLogo: boolean;
  headerAlign: "center" | "left";
  titleSize: 1 | 2;
  /** Titles for the non-tax documents (a tax invoice is always titled TAX INVOICE). */
  guestCheckTitle: string;
  invoiceTitle: string;
  showAddress: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showWebsite: boolean;
  showTradingName: boolean;
  // Check details
  showCheckNo: boolean;
  showOrderType: boolean;
  showTable: boolean;
  showServer: boolean;
  /** What to call the employee on the bill: Server, Steward, Cashier… */
  serverLabel: string;
  showCovers: boolean;
  showPrintedTime: boolean;
  // Items
  showColumnHeader: boolean;
  qtyStyle: "before" | "after";
  showUnitPrice: boolean;
  combineSameItems: boolean;
  showModifiers: boolean;
  showModifierPrices: boolean;
  showNotes: boolean;
  showSeat: boolean;
  // Totals
  showItemCount: boolean;
  showSubtotal: boolean;
  discountDetail: "each" | "total";
  showSavings: boolean;
  totalLabel: string;
  totalSize: 1 | 2;
  // Payments
  showPayments: boolean;
  showPaymentRefs: boolean;
  showChange: boolean;
  // Guest check
  guestCheckNote: string;
  /** LankaQR pay-by-QR on guest checks (when the LankaQR module is on). */
  showPayQr: boolean;
  // Footer
  showCustomer: boolean;
  showFeedbackQr: boolean;
  /** Feedback link; {invoice} is replaced by the invoice number, {website} by the business website. */
  feedbackUrl: string;
  feedbackCaption: string;
  showPoweredBy: boolean;
  /** Blank lines before the cut. */
  extraFeed: number;
}

/** POS app styles for phones and tablets (mobile apps), besides the terminal layout. */
export type MobileStyle = "bright" | "indigo";

export interface MobileUi {
  /** "terminal" keeps the till layout on every device. */
  style: "terminal" | MobileStyle;
  /** Screens that get the app style: phones, phones and tablets, or every screen. Workstations set to the mobile hardware model always do. */
  useOn: "phones" | "phonesTablets" | "all";
  /** Accent colour (empty = the style's own colour). */
  accent?: string;
  /** Show today's sales on the home screen (only to employees allowed to see reports). */
  showSalesOnHome: boolean;
}

export type SequenceReset = "never" | "monthly" | "yearly";

export interface TaxSettings extends Entity {
  id: "tax";
  pricing: "exclusive" | "inclusive";
  serviceChargeRate: BasisPoints;
  /** Order type ids that attract service charge (empty = all). */
  serviceChargeOrderTypes: string[];
  vatRate: BasisPoints;
  ssclRate: BasisPoints;
  tdlRate: BasisPoints;
  /** Cash rounding of the amount due, in cents (0 = none, 100 = Rs 1). */
  billRoundingUnit: Cents;
  invoiceSequenceReset: SequenceReset;
}

/** POS look: one of the templates plus any overrides (colours, sizes, layout). */
export interface PosTheme {
  template: "classic" | "modern" | "midnight";
  /** CSS colours; empty = the template's value. */
  colors: Partial<Record<"brand" | "accent" | "bg" | "surface" | "text" | "muted" | "line" | "button" | "buttonText" | "checkBg" | "danger", string>>;
  fontScale: number;
  buttonSize: "compact" | "regular" | "large";
  radius: number;
  /** Where the check is: left or right of the menu. */
  checkSide: "left" | "right";
  /** Category navigation as a top bar or a left rail. */
  categoryStyle: "tabs" | "rail";
  /** Menu grid columns on a wide screen (0 = automatic). */
  columns: number;
  showImages: boolean;
  /** Colour each item button with its category colour. */
  colorByCategory: boolean;
}

export interface PosSettings extends Entity {
  id: "pos";
  /** How employees sign in: employee ID + PIN, tap a name then PIN, or card swipe/ID. */
  signInMode?: "idPin" | "tapName" | "card";
  /** Wrong PINs before the employee is locked out (a manager unlocks). */
  maxFailedSignIns?: number;
  /** Sign the employee out after this many seconds without a touch (0 = never). */
  autoSignOutSeconds?: number;
  /** Employees must clock in before they can start checks. */
  requireClockIn?: boolean;
  pinMinLength?: number;
  theme?: PosTheme;
  /** Phone and tablet app style. */
  mobile?: MobileUi;
  /** Local hour at which the business day rolls over. */
  businessDayRolloverHour: number;
  requireCoversForDineIn: boolean;
  autoPrintBillOnClose: boolean;
  printKotOnSend: boolean;
  /** Loyalty: points earned per Rs 100 spent (CRM module). */
  loyaltyPointsPer100: number;
  defaultPropertyId: string;
}

export interface AccountingSettings extends Entity {
  id: "accounting";
  /** Account code for each role in the daily journal. */
  accounts: {
    salesByMajorGroup: Record<string, string>;
    serviceCharge: string;
    vatOutput: string;
    vatInput: string;
    ssclPayable: string;
    tdlPayable: string;
    discounts: string;
    rounding: string;
    inventory: string;
    cogsByMajorGroup: Record<string, string>;
    wastage: string;
    stockAdjustment: string;
    accountsPayable: string;
    complimentary: string;
    /** Opening stock is posted against this account (default 3900 Opening balances). */
    openingBalances?: string;
    /** Goods received, not yet invoiced (ERPNext "Stock Received But Not Billed"). When set, goods
     * receipts credit this account and the supplier invoice moves it to trade creditors with VAT. */
    stockReceivedNotBilled?: string;
  };
}

export type IntegrationMode = "mock" | "sandbox" | "live";

export interface IntegrationSettings extends Entity {
  id: "integrations";
  payhere: { mode: IntegrationMode; merchantId: string; currency: "LKR" };
  lankaqr: { mode: IntegrationMode; merchantName: string; merchantCity: string; merchantId: string; mcc: string };
  whatsapp: { mode: IntegrationMode; phoneNumberId: string; eodRecipients: { name: string; phone: string }[]; eodTime: string };
  accountingExport: { target: "excel" | "erpnext" | "akaunting"; baseUrl?: string };
}

// ───────────────────────────── Organisation & devices ─────────────────────────────

export interface Property extends Entity {
  code: string;
  name: string;
  addressLines: string[];
  phone?: string;
  active: boolean;
}

export interface RevenueCenter extends Entity {
  propertyId: string;
  code: string;
  name: string;
  serviceMode: "table" | "quick";
  defaultOrderTypeId: string;
  active: boolean;
}

/** `dedicated`: Windows PC / POS terminal. `mobile`: tablet or phone (iPad / Android). */
export type DeviceProfile = "dedicated" | "mobile";

export interface Workstation extends Entity {
  propertyId: string;
  /** Default revenue centre. */
  rvcId: string;
  /** Revenue centres employees may choose at sign-in on this device (empty = only `rvcId`). */
  allowedRvcIds?: string[];
  /** Overrides the property-wide automatic sign-out (seconds, 0 = never). */
  autoSignOutSeconds?: number;
  /** Also the IRD invoice classification code (1–15 uppercase letters/digits), e.g. W01. */
  code: string;
  name: string;
  deviceProfile: DeviceProfile;
  receiptPrinterId: string;
  /**
   * How this device prints: through the Print Agent (shop PCs and network printers), directly
   * from the POS Shell (USB on this PC), to a Bluetooth printer next to this phone or tablet
   * (no Print Agent needed), or on screen only.
   */
  printMode: "agent" | "direct" | "bluetooth" | "preview";
  /**
   * Bluetooth printing: from the browser (Chrome on Android, Bluetooth Low Energy printers) or
   * through the RawBT app on Android (any Bluetooth printer, including classic Bluetooth).
   */
  bluetoothVia?: "browser" | "rawbt";
  /** Paper width of the Bluetooth printer (default 80 mm). */
  paperWidthMm?: 80 | 58;
  /** Kitchen and bar tickets also print on the Bluetooth printer (default yes: one printer for everything). */
  kitchenOnBluetooth?: boolean;
  /** Screen style on this device: the business setting, the terminal layout, or one of the app styles. */
  uiStyle?: "default" | "terminal" | MobileStyle;
  active: boolean;
}

export type PrinterRole = "receipt" | "kitchen" | "bar" | "report";

export interface Printer extends Entity {
  propertyId: string;
  name: string;
  role: PrinterRole;
  model: string;
  connection: "network" | "usb" | "bluetooth";
  /** Network printers: IP/hostname and port (9100). USB: Windows printer name. */
  address: string;
  port: number;
  paperWidthMm: 80 | 58;
  /** Print Agent that owns this printer. */
  agentId: string;
  /** Fallback printer when this one fails. */
  backupPrinterId?: string;
  active: boolean;
}

export interface Table extends Entity {
  propertyId: string;
  name: string;
  area: string;
  seats: number;
  sortOrder: number;
}

export interface OrderType extends Entity {
  name: string;
  requiresTable: boolean;
  sortOrder: number;
  active: boolean;
}

// ───────────────────────────── Menu ─────────────────────────────

export type MajorGroup = "Food" | "Beverage" | "Liquor" | "Other";

export interface MenuCategory extends Entity {
  name: string;
  majorGroup: MajorGroup;
  color: string;
  sortOrder: number;
  active: boolean;
}

export interface MenuItem extends Entity {
  /** PLU / item code; equals `id`. */
  code: string;
  name: string;
  nameSi?: string;
  nameTa?: string;
  categoryId: string;
  price: Cents;
  /** "standard" (VAT-able) or a custom class such as "exempt". */
  taxClass: string;
  /** Kitchen order ticket routing. */
  kotRoute: "kitchen" | "bar" | "none";
  modifierGroupIds: string[];
  allergens: string[];
  description?: string;
  /** Out of stock / 86'd. */
  available: boolean;
  active: boolean;
  sortOrder: number;
  /** Cached recipe cost per portion (cents), refreshed by costing. */
  cost?: Cents;
  /** A photo is stored in `menuImages/{id}` (kept out of the item so menus load fast). */
  hasImage?: boolean;
  /** Button colour on the POS (CSS colour). */
  buttonColor?: string;
  /** Price is entered at the POS (needs the open-price privilege). */
  openPrice?: boolean;
}

/** Menu item photo, resized in the browser (≤ 400 px, ~30 KB) and stored in Firestore. */
export interface MenuImage extends Entity {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  updatedAt: string;
}

export interface ModifierOption {
  id: string;
  name: string;
  price: Cents;
  /** Optional stock effect of the option (e.g. extra cheese 40 g). */
  inventoryItemId?: string;
  qty?: number;
}

export interface ModifierGroup extends Entity {
  name: string;
  min: number;
  max: number;
  options: ModifierOption[];
}

export interface Discount extends Entity {
  name: string;
  type: "percent" | "amount";
  /** Basis points for percent, cents for amount. */
  value: number;
  scope: "item" | "check";
  requiresManager: boolean;
  active: boolean;
}

export interface ReasonCode extends Entity {
  type: "void" | "refund" | "discount" | "comp" | "waste" | "paidOut";
  name: string;
}

export type TenderType = "cash" | "card" | "lankaqr" | "payhere" | "foreignCash" | "voucher" | "house" | "comp";

export interface TenderMedia extends Entity {
  name: string;
  type: TenderType;
  allowChange: boolean;
  /** ISO code for foreign cash, e.g. USD. */
  currency?: string;
  /** LKR per unit × 1,000,000 for foreign currency. */
  exchangeRateMicros?: number;
  requiresReference: boolean;
  opensDrawer: boolean;
  /** Ledger account debited when this tender is used. */
  accountCode: string;
  sortOrder: number;
  active: boolean;
}

// ───────────────────────────── People Management ─────────────────────────────

export interface RoleLimits {
  /** Largest discount the role may give, basis points of the line or check. */
  maxDiscountBp?: number;
  /** Largest single void (value of the voided line). */
  maxVoidAmount?: Cents;
  /** Largest price change, basis points of the menu price. */
  maxPriceOverrideBp?: number;
  maxRefundAmount?: Cents;
  maxPaidOut?: Cents;
}

export interface Role extends Entity {
  name: string;
  /** 1 = most senior. People may authorise or manage only roles at their level or below. */
  level: number;
  privileges: string[];
  limits?: RoleLimits;
  /** Privileges the role has but that still need a second person's authorisation. */
  requireAuth?: string[];
  description?: string;
}

/** A POS operator (signs in with employee number + PIN). */
export interface Staff extends Entity {
  /** Employee number, also the sign-in ID on the POS. */
  employeeNo: string;
  name: string;
  /** Default role (used at every property without its own entry in `propertyRoles`). */
  roleId: string;
  /** Role per property for groups where a person works in several hotels. */
  propertyRoles?: Record<string, string>;
  propertyIds: string[];
  /** Revenue centres this employee may sign in to (Simphony operator records; empty = all). */
  rvcIds?: string[];
  jobTitle?: string;
  department?: string;
  /** A PIN is set (the hash itself is in staffSecrets, which clients can't read). */
  pinSet?: boolean;
  /** A card is registered (the number is in staffSecrets). */
  hasCard?: boolean;
  /** Old-style records only: moved to staffSecrets on first use. */
  pinHash?: string;
  pinSalt?: string;
  /** Old-style records only (magnetic/RFID card number); moved to staffSecrets. */
  cardId?: string;
  phone?: string;
  email?: string;
  status: "active" | "suspended" | "terminated";
  hireDate?: string;
  terminationDate?: string;
  /** Sign-in control. */
  failedSignIns?: number;
  lockedAt?: string;
  lastSignInAt?: string;
  pinChangedAt?: string;
  /** Time and attendance: set while clocked in. */
  clockedInAt?: string;
  /** Linked back-office login (Firebase uid), if the person also uses the back office. */
  backOfficeUid?: string;
}

/** Time and attendance record (one per shift). */
export interface TimeCard extends Entity {
  staffId: string;
  propertyId: string;
  rvcId: string;
  businessDate: string;
  clockIn: string;
  clockOut?: string;
  workstationId: string;
  /** Minutes worked (set at clock-out). */
  minutes?: number;
}

/** Back-office login (Firebase Auth user) and its access level for this tenant. */
export type MemberRole = "owner" | "admin" | "manager" | "accountant" | "storekeeper" | "auditor" | "viewer" | "terminal";

export interface Member extends Entity {
  /** Firebase Auth uid (= id). */
  uid: string;
  email: string;
  name: string;
  role: MemberRole;
  tenantId: string;
  staffId?: string;
  createdAt: string;
}

// ───────────────────────────── Inventory & purchasing (ERP) ─────────────────────────────

export type StockUnit = "g" | "ml" | "pcs";

export interface InventoryItem extends Entity {
  code: string;
  name: string;
  category: string;
  majorGroup: MajorGroup;
  stockUnit: StockUnit;
  /** e.g. "kg", "bottle 750ml", "tray 30". */
  purchaseUnit: string;
  /** Stock units per purchase unit (kg → 1000 g). */
  purchaseFactor: number;
  /** Latest cost per purchase unit (cents). */
  purchaseCost: Cents;
  vendorId?: string;
  /** Minimum stock to hold, in purchase units (0 = no reorder alert). */
  parLevel: number;
  /** Minimum order quantity, in purchase units. */
  reorderQty: number;
  /** Produced in-house from a prep recipe (sauces, curries…). */
  isPrep: boolean;
  trackStock: boolean;
  active: boolean;
}

export interface Location extends Entity {
  name: string;
  isDefault: boolean;
}

export interface RecipeLine {
  inventoryItemId: string;
  /** Quantity in the item's stock unit (g / ml / pcs). */
  qty: number;
}

/** Recipe of a menu item (`kind: "menu"`, id = menu item code) or a prep item (`kind: "prep"`, id = inventory code). */
export interface Recipe extends Entity {
  kind: "menu" | "prep";
  /** Portions (menu) or stock units (prep) produced by the lines below. */
  yieldQty: number;
  lines: RecipeLine[];
  method?: string;
}

export interface Vendor extends Entity {
  code: string;
  name: string;
  contactName?: string;
  phone: string;
  email?: string;
  address?: string;
  vatNumber?: string;
  paymentTermsDays: number;
  active: boolean;
}

export interface PurchaseLine {
  inventoryItemId: string;
  /** In purchase units. */
  qty: number;
  /** Per purchase unit, cents. */
  unitCost: Cents;
}

export interface PurchaseOrder extends Entity {
  number: string;
  vendorId: string;
  locationId: string;
  status: "draft" | "approved" | "sent" | "received" | "cancelled";
  orderDate: string;
  expectedDate?: string;
  lines: PurchaseLine[];
  notes?: string;
}

export interface GoodsReceipt extends Entity {
  number: string;
  vendorId: string;
  locationId: string;
  purchaseOrderId?: string;
  supplierInvoiceNo?: string;
  date: string;
  lines: PurchaseLine[];
  /** Input VAT on the supplier invoice, cents. */
  inputVat: Cents;
  status: "draft" | "posted";
  postedAt?: string;
}

export interface StockLot {
  lotId: string;
  receivedAt: string;
  /** Remaining quantity in stock units. */
  qty: number;
  /** Cost per stock unit in cents (may be fractional, e.g. 0.28 c/g). */
  unitCost: number;
  source: string;
}

/** Stock of one item at one location, with its FIFO lots (oldest first). Id = `${locationId}__${itemId}`. */
export interface StockLevel extends Entity {
  itemId: string;
  locationId: string;
  qty: number;
  /** Value of the remaining lots, cents. */
  value: Cents;
  lots: StockLot[];
  updatedAt: string;
}

/** `usage`: stock used in the kitchen, found by counting (periodic inventory, no POS sales); posted to cost of sales.
 * `opening`: stock on hand when the business starts using the system; posted against opening balances. */
export type MovementType = "receive" | "sale" | "waste" | "adjust" | "transferIn" | "transferOut" | "production" | "consumption" | "usage" | "opening";

export interface StockMovementLine {
  itemId: string;
  /** Signed quantity in stock units. */
  qty: number;
  /** Signed FIFO cost, cents. */
  cost: Cents;
}

export interface StockMovement extends Entity {
  type: MovementType;
  locationId: string;
  businessDate: string;
  at: string;
  ref: string;
  lines: StockMovementLine[];
  reason?: string;
  /** Major group → cost of sales, for the accounting journal. */
  costByMajorGroup?: Record<string, Cents>;
  /** Items consumed beyond what was on hand (stock went negative / uncosted). */
  shortages?: { itemId: string; qty: number }[];
}

export interface StockCount extends Entity {
  locationId: string;
  date: string;
  status: "draft" | "posted";
  /**
   * What the differences mean: `count` (default) — errors and losses, posted to stock count
   * differences; `usage` — what the kitchen used since the last count (businesses without POS
   * sales), posted to cost of sales; `opening` — the first count, posted against opening balances.
   */
  kind?: "count" | "usage" | "opening";
  lines: { itemId: string; counted: number; expected?: number }[];
}

// ───────────────────────────── CRM ─────────────────────────────

export interface Customer extends Entity {
  name: string;
  phone: string;
  email?: string;
  birthday?: string;
  tags: string[];
  notes?: string;
  marketingConsent: boolean;
  visits: number;
  totalSpend: Cents;
  points: number;
  lastVisit?: string;
  createdAt: string;
  /** Business customers: printed on tax invoices when VAT-registered. */
  vatTin?: string;
  address?: string;
}

// ───────────────────────────── Checks, invoices, payments ─────────────────────────────

export interface CheckModifier {
  groupId: string;
  optionId: string;
  name: string;
  price: Cents;
}

export interface CheckLine {
  id: string;
  menuItemId: string;
  name: string;
  qty: number;
  unitPrice: Cents;
  modifiers: CheckModifier[];
  note?: string;
  seat?: number;
  taxClass: string;
  kotRoute: MenuItem["kotRoute"];
  categoryId: string;
  /** Item-level discount ids. */
  discountIds: string[];
  /** Kitchen round the line was sent in (undefined = not yet sent). */
  sentRound?: number;
  voided?: { reasonId: string; by: string; at: string };
}

export interface CheckPayment {
  id: string;
  tenderId: string;
  /** Amount in the tender's own currency (cents). */
  amount: Cents;
  /** Value applied to the bill, LKR cents. */
  applied: Cents;
  /** Value tendered in LKR cents (applied + change). */
  tendered: Cents;
  reference?: string;
  at: string;
  by: string;
}

export interface Check extends Entity {
  propertyId: string;
  rvcId: string;
  workstationId: string;
  /** Human-friendly check number for the day (KOTs, call-outs). */
  checkNo: number;
  orderTypeId: string;
  tableId?: string;
  covers: number;
  staffId: string;
  customerId?: string;
  /** Buyer details for a VAT tax invoice to a registered business. */
  buyer?: { name: string; tin: string; address: string };
  /** Guest allergies: adding an item that contains one asks for confirmation (X14). */
  allergies?: string[];
  status: "open" | "closed" | "voided";
  lines: CheckLine[];
  checkDiscountIds: string[];
  payments: CheckPayment[];
  sentRounds: number;
  totals?: CheckTotals;
  change?: Cents;
  businessDate: string;
  openedAt: string;
  closedAt?: string;
  invoiceNo?: string;
  /** Inventory depletion state (inventory module). */
  depletion?: "pending" | "done" | "skipped";
  channel: "pos" | "qr" | "online";
}

/** Immutable fiscal record of an issued bill. Id = invoice number. */
export interface Invoice extends Entity {
  checkId: string;
  workstationId: string;
  issuedAt: string;
  supplyDate: string;
  businessDate: string;
  vatRegistered: boolean;
  seller: { legalName: string; tin: string; addressLines: string[] };
  buyer?: { name: string; tin: string; address: string };
  totals: CheckTotals;
  /** SHA-256 hex of the previous invoice of this workstation + this record (tamper evidence). */
  prevHash: string;
  hash: string;
}

export interface WorkstationSequence extends Entity {
  /** Invoice sequence. */
  year: number;
  month: number;
  invoiceSeq: number;
  /** Check number counter for the business date. */
  checkDate: string;
  checkSeq: number;
  lastInvoiceHash: string;
}

// ───────────────────────────── Aggregates, reports, accounting ─────────────────────────────

export interface MoneyQty {
  qty: number;
  /** Net amount (after discounts, before service charge and taxes). */
  amount: Cents;
  /** Amount at menu price before discounts (kept for major groups). */
  gross?: Cents;
}

/** Pre-aggregated totals for one property and business date (id = `${propertyId}__${date}`). */
export interface DailyStats extends Entity {
  propertyId: string;
  businessDate: string;
  checks: number;
  covers: number;
  /** Items at menu price (gross). */
  itemsTotal: Cents;
  discounts: Cents;
  netSales: Cents;
  serviceCharge: Cents;
  sscl: Cents;
  tdl: Cents;
  vat: Cents;
  total: Cents;
  rounding: Cents;
  /** Net sales (ex charges) by menu item / category / major group / order type / hour. */
  items: Record<string, MoneyQty>;
  categories: Record<string, MoneyQty>;
  majorGroups: Record<string, MoneyQty>;
  orderTypes: Record<string, MoneyQty & { covers: number }>;
  hours: Record<string, MoneyQty>;
  tenders: Record<string, MoneyQty>;
  voids: MoneyQty;
}

export type AccountType =
  | "Bank"
  | "Cash"
  | "Receivable"
  | "Payable"
  | "Stock"
  | "StockReceivedNotBilled"
  | "Tax"
  | "FixedAsset"
  | "AccumulatedDepreciation"
  | "Depreciation"
  | "CostOfGoodsSold"
  | "Equity"
  | "RetainedEarnings"
  | "Income"
  | "Expense"
  | "RoundOff"
  | "ExchangeGainLoss";

/** Chart of accounts node (ERPNext-style tree: groups contain ledgers; only ledgers take postings). */
export interface Account extends Entity {
  code: string;
  name: string;
  /** Root type (balance-sheet or P&L section). */
  type: "asset" | "liability" | "equity" | "income" | "expense";
  parentId?: string;
  isGroup?: boolean;
  accountType?: AccountType;
  /** Frozen accounts accept no new postings. */
  frozen?: boolean;
  /** Account currency when it is not the company currency (e.g. a USD bank account). */
  currency?: string;
  /** SLFRS/IFRS financial statement line, for statement mapping and audit files. */
  statementLine?: string;
}

export interface JournalLine {
  accountCode: string;
  debit: Cents;
  credit: Cents;
  memo?: string;
}

export interface JournalEntry extends Entity {
  date: string;
  source: "eod" | "manual";
  propertyId?: string;
  memo: string;
  lines: JournalLine[];
  createdAt: string;
}

export interface Budget extends Entity {
  /** `YYYY-MM`. */
  month: string;
  propertyId: string;
  salesTarget: Cents;
  foodCostTargetBp: BasisPoints;
}

export interface PrintJob extends Entity {
  printerId: string;
  workstationId: string;
  kind: "kot" | "bill" | "receipt" | "report" | "test";
  /** Receipt document (see @pos/printing). */
  doc: unknown;
  status: "queued" | "printed" | "failed";
  error?: string;
  createdAt: string;
  /** Firestore TTL field: queued jobs are deleted automatically after a day. */
  expireAt: string;
}

export interface MessageLog extends Entity {
  channel: "whatsapp" | "email" | "sms";
  to: string;
  template: string;
  body: string;
  mode: IntegrationMode;
  status: "simulated" | "sent" | "failed";
  at: string;
}

export interface AuditEntry extends Entity {
  at: string;
  by: string;
  action: string;
  entity: string;
  entityId: string;
  detail?: string;
}

/**
 * A photo or scan of a paper document (supplier bill, receipt, handwritten sales bills), kept as
 * evidence. The file itself is stored in `attachmentChunks` (base64 parts of at most 700,000
 * characters) and fingerprinted with SHA-256, so any change to it is detected. Files are never
 * edited; only the description and the link to a document can change.
 */
export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  /** Stored size in bytes (after the photo is resized). */
  size: number;
  sha256: string;
  chunks: number;
  /** Small preview (data URL, images only). */
  thumbnail?: string;
  /** The document it belongs to, e.g. { col: "vouchers", id: "PI-…" }. Empty = still in the inbox. */
  linkedTo?: { col: string; id: string; label?: string };
  status: "inbox" | "linked";
  /** What the paper says, typed in by the person who filed it (optional). */
  documentDate?: string;
  supplierName?: string;
  amount?: Cents;
  note?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface AttachmentChunk {
  id: string;
  attachmentId: string;
  index: number;
  data: string;
}
