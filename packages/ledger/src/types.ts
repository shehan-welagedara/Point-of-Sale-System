import type { Cents } from "@pos/engine";

/**
 * Accounting model, following ERPNext's design (vouchers posting to a general ledger, fiscal years,
 * cost centres, open items) and S/4HANA's universal journal (one line table carrying every
 * dimension). All amounts are integer cents. "Base" = company currency (LKR).
 */

export const LEDGER = {
  vouchers: "vouchers",
  ledger: "ledger",
  balances: "accountBalances",
  numberSeries: "numberSeries",
  fiscalYears: "fiscalYears",
  costCenters: "costCenters",
  assets: "assets",
  exchangeRates: "exchangeRates",
  glBudgets: "glBudgets",
  bankStatements: "bankStatements",
  bankRecons: "bankRecons",
  ledgerHead: "ledgerHead",
  auditEvents: "auditEvents",
  auditSeals: "auditSeals",
} as const;

export interface LedgerSettings {
  baseCurrency: string;
  /** Month (1–12) the fiscal year starts; Sri Lanka's tax year starts in April. */
  fiscalYearStartMonth: number;
  accounts: {
    receivable: string;
    payable: string;
    stockReceivedNotBilled: string;
    inventory: string;
    vatInput: string;
    vatOutput: string;
    whtPayable: string;
    roundOff: string;
    fxGainLoss: string;
    retainedEarnings: string;
    bankCharges: string;
    priceVariance: string;
    disposalGainLoss: string;
  };
  defaultCostCenter: string;
  /** Manual journals of this total or more need approval by a second person (0 = all). */
  journalApprovalThreshold: Cents;
  /** Payments of this amount or more need approval by a second person. */
  paymentApprovalThreshold: Cents;
  /** Three-way match tolerances (basis points of quantity and price). */
  matchTolerance: { qtyBp: number; priceBp: number };
}

export type PeriodStatus = "open" | "closed";

export interface FiscalPeriod {
  /** `YYYY-MM`. */
  id: string;
  start: string;
  end: string;
  status: PeriodStatus;
  closedBy?: string;
  closedAt?: string;
}

export interface FiscalYear {
  /** e.g. `2026-27`. */
  id: string;
  start: string;
  end: string;
  status: "open" | "closed";
  periods: FiscalPeriod[];
  closedBy?: string;
  closedAt?: string;
}

export interface CostCenter {
  id: string;
  name: string;
  parentId?: string;
  isGroup: boolean;
  propertyId?: string;
  disabled?: boolean;
}

export type PartyType = "customer" | "supplier";

export type VoucherType =
  | "journal"
  | "purchaseInvoice"
  | "salesInvoice"
  | "payment"
  | "posDay"
  | "depreciation"
  | "assetDisposal"
  | "periodClose"
  | "reversal";

export type VoucherStatus = "draft" | "submitted" | "posted" | "cancelled";

/** A posting line in voucher currency (converted to base when posted). */
export interface LineInput {
  account: string;
  debit: Cents;
  credit: Cents;
  costCenter?: string;
  partyType?: PartyType;
  partyId?: string;
  /** Invoice this line settles (open-item clearing). */
  againstVoucherId?: string;
  memo?: string;
}

export interface VoucherBase {
  id: string;
  type: VoucherType;
  status: VoucherStatus;
  /** Gap-free number, assigned only when posted (e.g. JV-2627-00001). */
  number?: string;
  postingDate: string;
  remarks: string;
  currency: string;
  /** Base currency per 1 unit of `currency` × 1,000,000. */
  exchangeRateMicros: number;
  propertyId?: string;
  costCenter?: string;
  createdBy: string;
  createdAt: string;
  submittedBy?: string;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  postedBy?: string;
  postedAt?: string;
  lastRejection?: { by: string; at: string; reason: string };
  fiscalYear?: string;
  period?: string;
  /** Sum of debits in base currency once posted. */
  totalBase?: Cents;
  /** Posting lines in voucher currency, frozen at posting (derived server-side for system vouchers). */
  lines?: LineInput[];
  reversedBy?: string;
  reversalOf?: string;
  cancelReason?: string;
  /** Tamper-evidence chain over every posted voucher of the company. */
  prevHash?: string;
  hash?: string;
}

export interface JournalVoucher extends VoucherBase {
  type: "journal";
  lines: LineInput[];
}

export interface PurchaseInvoiceItem {
  description: string;
  /** Stock items must reference a goods receipt (their value clears "received not billed"). */
  inventoryItemId?: string;
  /** Expense or asset account for non-stock lines. */
  account?: string;
  qty: number;
  /** Price per unit in invoice currency. */
  rate: Cents;
  costCenter?: string;
}

export interface MatchResult {
  status: "matched" | "withinTolerance" | "exception" | "notApplicable";
  issues: string[];
}

export interface PurchaseInvoice extends VoucherBase {
  type: "purchaseInvoice";
  supplierId: string;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  dueDate: string;
  purchaseOrderId?: string;
  grnIds: string[];
  items: PurchaseInvoiceItem[];
  vatAmount: Cents;
  whtAmount: Cents;
  /** Open amount in invoice currency (maintained when payments are posted). */
  outstanding?: Cents;
  match?: MatchResult;
}

export interface SalesInvoiceItem {
  description: string;
  account: string;
  qty: number;
  rate: Cents;
  costCenter?: string;
}

export interface SalesInvoice extends VoucherBase {
  type: "salesInvoice";
  customerId: string;
  dueDate: string;
  items: SalesInvoiceItem[];
  /** VAT rate in basis points (0 when not VAT-registered). */
  vatRateBp: number;
  outstanding?: Cents;
}

export interface PaymentAllocation {
  voucherId: string;
  /** In payment currency (must equal the invoice currency). */
  amount: Cents;
}

export interface PaymentVoucher extends VoucherBase {
  type: "payment";
  direction: "pay" | "receive";
  partyType: PartyType;
  partyId: string;
  /** Bank or cash ledger the money moves through. */
  bankAccount: string;
  amount: Cents;
  allocations: PaymentAllocation[];
  /** Bank charges in base currency. */
  bankCharges: Cents;
  reference?: string;
}

export interface PosDayVoucher extends VoucherBase {
  type: "posDay";
  businessDate: string;
  sequence: number;
}

export interface DepreciationVoucher extends VoucherBase {
  type: "depreciation";
  depreciationPeriod: string;
  items: { assetId: string; amount: Cents }[];
}

export interface AssetDisposalVoucher extends VoucherBase {
  type: "assetDisposal";
  assetId: string;
  proceeds: Cents;
  proceedsAccount: string;
}

export interface PeriodCloseVoucher extends VoucherBase {
  type: "periodClose";
  closingFiscalYear: string;
}

export interface ReversalVoucher extends VoucherBase {
  type: "reversal";
  reversalOf: string;
}

export type Voucher =
  | JournalVoucher
  | PurchaseInvoice
  | SalesInvoice
  | PaymentVoucher
  | PosDayVoucher
  | DepreciationVoucher
  | AssetDisposalVoucher
  | PeriodCloseVoucher
  | ReversalVoucher;

/** One line of the universal journal (immutable). */
export interface LedgerEntry {
  id: string;
  voucherId: string;
  voucherType: VoucherType;
  voucherNo: string;
  postingDate: string;
  fiscalYear: string;
  period: string;
  account: string;
  debit: Cents;
  credit: Cents;
  currency: string;
  debitFc: Cents;
  creditFc: Cents;
  exchangeRateMicros: number;
  costCenter: string;
  propertyId?: string;
  partyType?: PartyType;
  partyId?: string;
  againstVoucherId?: string;
  memo?: string;
  isReversal: boolean;
  createdAt: string;
  createdBy: string;
  lineNo: number;
}

/** Pre-aggregated movement per period, account and cost centre (id `${period}__${account}__${cc}`). */
export interface AccountBalance {
  id: string;
  period: string;
  fiscalYear: string;
  account: string;
  costCenter: string;
  debit: Cents;
  credit: Cents;
}

export interface Asset {
  id: string;
  code: string;
  name: string;
  category: string;
  assetAccount: string;
  accumulatedDepAccount: string;
  depExpenseAccount: string;
  costCenter?: string;
  propertyId?: string;
  purchaseDate: string;
  /** Depreciation starts in the month the asset is available for use. */
  availableDate: string;
  cost: Cents;
  salvageValue: Cents;
  method: "SL" | "WDV";
  usefulLifeMonths: number;
  /** Annual rate for written-down value, basis points. */
  wdvRateBp?: number;
  status: "active" | "fullyDepreciated" | "disposed";
  accumulatedDep: Cents;
  lastDepPeriod?: string;
  disposalDate?: string;
  serialNo?: string;
  location?: string;
}

export interface ExchangeRate {
  id: string;
  date: string;
  currency: string;
  rateMicros: number;
}

export interface GlBudget {
  /** `${fiscalYear}__${account}__${costCenter}`. */
  id: string;
  fiscalYear: string;
  account: string;
  costCenter: string;
  /** Period id → amount (net debit for expenses, net credit for income). */
  months: Record<string, Cents>;
}

export interface BankStatementLine {
  id: string;
  date: string;
  description: string;
  reference?: string;
  /** Positive = money in, negative = money out. */
  amount: Cents;
}

export interface BankStatement {
  id: string;
  account: string;
  from: string;
  to: string;
  openingBalance: Cents;
  closingBalance: Cents;
  lines: BankStatementLine[];
  importedBy: string;
  importedAt: string;
}

export interface BankRecon {
  id: string;
  statementId: string;
  statementLineId: string;
  ledgerEntryId: string;
  account: string;
  clearedOn: string;
  createdBy: string;
  createdAt: string;
}

export interface LedgerHead {
  id: "head";
  lastHash: string;
  count: number;
  lastVoucherId?: string;
}

export interface Actor {
  uid: string;
  name: string;
  role: string;
}
