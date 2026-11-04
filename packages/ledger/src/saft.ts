/**
 * SAF-T (OECD Standard Audit File for Tax, version 2.0 structure): the internationally used format
 * for handing books to auditors and tax authorities. Contains the header, master files (accounts
 * with opening/closing balances, customers, suppliers, tax table) and every general ledger
 * transaction of the period.
 */
import type { Account, BusinessSettings, Customer, Vendor } from "@pos/core";
import type { Cents } from "@pos/engine";
import type { AccountBalance, LedgerEntry, Voucher } from "./types.js";

const esc = (s: unknown) => String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const amt = (c: Cents) => (c / 100).toFixed(2);
const el = (tag: string, value: unknown) => (value === undefined || value === null || value === "" ? "" : `<${tag}>${esc(value)}</${tag}>`);

export interface SaftInput {
  business: BusinessSettings;
  software: { name: string; version: string };
  currency: string;
  fromDate: string;
  toDate: string;
  accounts: readonly Account[];
  balances: readonly AccountBalance[];
  entries: readonly LedgerEntry[];
  vouchers: readonly Voucher[];
  customers: readonly Customer[];
  suppliers: readonly Vendor[];
  taxes: { code: string; description: string; rateBp: number }[];
  createdAt: string;
}

export function generateSaft(i: SaftInput): string {
  const fromP = i.fromDate.slice(0, 7);
  const toP = i.toDate.slice(0, 7);
  const bal = (account: string, pred: (b: AccountBalance) => boolean) =>
    i.balances.filter((b) => b.account === account && pred(b)).reduce((a, b) => a + b.debit - b.credit, 0);
  const accountsXml = i.accounts
    .filter((a) => !a.isGroup)
    .map((a) => {
      const opening = bal(a.id, (b) => b.period < fromP);
      const closing = bal(a.id, (b) => b.period <= toP);
      return `<Account>${el("AccountID", a.code)}${el("AccountDescription", a.name)}${el("StandardAccountID", a.statementLine ?? a.parentId ?? "")}${el("AccountType", a.type)}${opening >= 0 ? el("OpeningDebitBalance", amt(opening)) : el("OpeningCreditBalance", amt(-opening))}${closing >= 0 ? el("ClosingDebitBalance", amt(closing)) : el("ClosingCreditBalance", amt(-closing))}</Account>`;
    })
    .join("");
  const party = (tag: string, idTag: string, id: string, name: string, tin?: string, phone?: string, address?: string) =>
    `<${tag}>${el(idTag, id)}${el("Name", name)}${tin ? `<TaxRegistration>${el("TaxRegistrationNumber", tin)}</TaxRegistration>` : ""}${address ? `<Address>${el("StreetName", address)}${el("Country", "LK")}</Address>` : ""}${phone ? `<Contact>${el("Telephone", phone)}</Contact>` : ""}</${tag}>`;
  const customers = i.customers.map((c) => party("Customer", "CustomerID", c.id, c.name, c.vatTin, c.phone, c.address)).join("");
  const suppliers = i.suppliers.map((s) => party("Supplier", "SupplierID", s.id, s.name, s.vatNumber, s.phone, s.address)).join("");
  const taxes = i.taxes.map((t) => `<TaxTableEntry>${el("TaxType", t.code)}${el("Description", t.description)}<TaxCodeDetails>${el("TaxCode", t.code)}${el("TaxPercentage", (t.rateBp / 100).toFixed(2))}${el("Country", "LK")}</TaxCodeDetails></TaxTableEntry>`).join("");

  const inRange = i.entries.filter((e) => e.postingDate >= i.fromDate && e.postingDate <= i.toDate);
  const byVoucher = new Map<string, LedgerEntry[]>();
  for (const e of inRange) byVoucher.set(e.voucherId, [...(byVoucher.get(e.voucherId) ?? []), e]);
  const vMap = new Map(i.vouchers.map((v) => [v.id, v]));
  const journals = new Map<string, string[]>();
  for (const [vid, lines] of byVoucher) {
    const v = vMap.get(vid);
    const first = lines[0]!;
    const tx = `<Transaction>${el("TransactionID", first.voucherNo)}${el("Period", Number(first.period.slice(5, 7)))}${el("PeriodYear", first.period.slice(0, 4))}${el("TransactionDate", first.postingDate)}${el("SourceID", v?.postedBy ?? first.createdBy)}${el("TransactionType", first.voucherType)}${el("Description", v?.remarks ?? "")}${el("SystemEntryDate", (v?.postedAt ?? first.createdAt).slice(0, 10))}${el("GLPostingDate", first.postingDate)}${lines
      .sort((a, b) => a.lineNo - b.lineNo)
      .map(
        (l) =>
          `<Line>${el("RecordID", l.id)}${el("AccountID", l.account)}${l.partyType === "customer" ? el("CustomerID", l.partyId) : ""}${l.partyType === "supplier" ? el("SupplierID", l.partyId) : ""}${el("Description", l.memo ?? "")}${l.debit ? `<DebitAmount>${el("Amount", amt(l.debit))}${l.currency !== i.currency ? `${el("CurrencyCode", l.currency)}${el("CurrencyAmount", amt(l.debitFc))}${el("ExchangeRate", (l.exchangeRateMicros / 1_000_000).toFixed(6))}` : ""}</DebitAmount>` : `<CreditAmount>${el("Amount", amt(l.credit))}${l.currency !== i.currency ? `${el("CurrencyCode", l.currency)}${el("CurrencyAmount", amt(l.creditFc))}${el("ExchangeRate", (l.exchangeRateMicros / 1_000_000).toFixed(6))}` : ""}</CreditAmount>`}${el("CostCenter", l.costCenter)}</Line>`,
      )
      .join("")}</Transaction>`;
    journals.set(first.voucherType, [...(journals.get(first.voucherType) ?? []), tx]);
  }
  const td = inRange.reduce((a, e) => a + e.debit, 0);
  const tc = inRange.reduce((a, e) => a + e.credit, 0);
  const b = i.business;
  return `<?xml version="1.0" encoding="UTF-8"?>
<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:2.00">
<Header>${el("AuditFileVersion", "2.00")}${el("AuditFileCountry", "LK")}${el("AuditFileDateCreated", i.createdAt.slice(0, 10))}${el("SoftwareCompanyName", i.software.name)}${el("SoftwareID", i.software.name)}${el("SoftwareVersion", i.software.version)}<Company>${el("RegistrationNumber", b.tin)}${el("Name", b.legalName)}<Address>${el("StreetName", b.addressLines.join(", "))}${el("Country", "LK")}</Address><Contact>${el("Telephone", b.phone)}${el("Email", b.email)}</Contact><TaxRegistration>${el("TaxRegistrationNumber", b.tin)}${el("TaxType", b.vatRegistered ? "VAT" : "")}</TaxRegistration></Company>${el("DefaultCurrencyCode", i.currency)}<SelectionCriteria>${el("SelectionStartDate", i.fromDate)}${el("SelectionEndDate", i.toDate)}</SelectionCriteria>${el("HeaderComment", b.isSample ? "SAMPLE DATA" : "")}${el("TaxAccountingBasis", "A")}</Header>
<MasterFiles><GeneralLedgerAccounts>${accountsXml}</GeneralLedgerAccounts><Customers>${customers}</Customers><Suppliers>${suppliers}</Suppliers><TaxTable>${taxes}</TaxTable></MasterFiles>
<GeneralLedgerEntries>${el("NumberOfEntries", byVoucher.size)}${el("TotalDebit", amt(td))}${el("TotalCredit", amt(tc))}${[...journals]
    .map(([type, txs]) => `<Journal>${el("JournalID", type)}${el("Description", type)}${el("Type", type)}${txs.join("")}</Journal>`)
    .join("")}</GeneralLedgerEntries>
</AuditFile>
`;
}
