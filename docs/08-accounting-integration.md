# 08 — Accounting Integration (X27)

## Short answer
1. **Built in, available from day 1: an Excel accounting workbook** generated automatically every day. It is enough for a small restaurant and its accountant.
2. When the client wants full books (ledgers, AP/AR, bank reconciliation, financial statements), connect an **open-source accounting system**. **ERPNext** is recommended, with **Akaunting** as the lighter option.

The POS is **not** the general ledger. It produces a clean, balanced **daily GL journal**, and any accounting tool can consume it.

## 1. Built-in Excel accounting workbook
Generated at End of Day and on demand (EMC → Accounting → Export), and stored in Cloud Storage. It can optionally be emailed or sent on WhatsApp to the accountant.

| Sheet | Contents |
|-------|----------|
| `Journal` | Balanced double-entry daily journal (debits = credits) using the client's **chart-of-accounts mapping** |
| `Sales Summary` | By revenue category (Food, Beverage, Liquor, Other), RVC and order type |
| `Taxes` | VAT output, SSCL and service charge per day, ready for the VAT/SSCL returns |
| `Tenders` | Cash, card clearing, LankaQR clearing, PayHere clearing, vouchers, house accounts, with expected vs declared amounts |
| `Purchases` *(inventory module)* | GRNs by vendor, with input VAT where applicable |
| `COGS & Stock` *(inventory module)* | FIFO cost of sales by category, waste, closing stock value |
| `Month` | Month-to-date pivot: a P&L-style view (sales − COGS − discounts) |

Example journal for one day:
```
Dr Cash on hand              120,000.00
Dr Card clearing – Bank A     95,000.00
Dr LankaQR clearing           42,841.21
Dr Discounts allowed           6,200.00
    Cr Sales – Food                 160,000.00
    Cr Sales – Beverage              40,000.00
    Cr Service charge income         19,380.00   (10% × 193,800 net)
    Cr SSCL payable                   5,329.50   (2.5% × 213,180)
    Cr VAT output payable            39,331.71   (18% × 218,509.50)
                             ----------    ----------
                             264,041.21    264,041.21
```
Account codes are mapped in EMC (Accounting → Account mapping), so the export matches the client's chart of accounts.

## 2. Open-source options (for full accounting)

| Option | Type | Pros | Cons | Fit |
|--------|------|------|------|-----|
| **ERPNext** (Frappe, GPL v3) | Web ERP, self-host or managed hosting | Full double-entry accounting, AP/AR, bank reconciliation, fixed assets, multi-company. **Robust REST API** (we push the daily Journal Entry automatically). Large community | Heavier; needs a small server or managed hosting (monthly fee) | ★★★ **Recommended** for growing restaurants and multi-outlet clients. Also a good standard to offer every client of your product |
| **Akaunting** (open source, Laravel) | Web, self-host or cloud | Simple, clean UI, invoices, bills, banking, REST API | Some features are paid apps; less depth than ERPNext | ★★ Small single-outlet clients |
| **Frappe Books** | Free desktop app | Very simple, no hosting cost | Single-user; CSV import only (no live push) | ★ Very small clients |
| **GnuCash** | Free desktop app | Mature double-entry | Desktop-only, accountant-oriented, CSV import | ★ |

**Plan:** ship the Excel workbook first. Then add an **ERPNext connector** (push the daily Journal Entry, purchase invoices from GRNs and supplier master data) as a paid add-on module. The export layer uses a common interface, so an Akaunting or Xero/QuickBooks connector can be added later.
