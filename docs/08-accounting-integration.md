# 08 — Accounting (X27)

## Short answer
The **Accounting module is a built-in general ledger** in the same Firebase database as the POS. It follows ERPNext's design, with S/4HANA-style capabilities. The POS, inventory and purchasing post into it automatically, so there is nothing to export and re-key. The design, controls and audit features are described in **[13-accounting-and-audit.md](13-accounting-and-audit.md)**.

This replaces the earlier plan of an Excel workbook followed by an ERPNext connector (decision D9, superseded by D24).

## What posts automatically
| Source | Document | Ledger effect |
|---|---|---|
| POS End of Day | POS day (`POS-…`) | Sales by major group, discounts, service charge, SSCL, VAT output, tenders (cash, card, LankaQR and PayHere clearing, vouchers, house accounts), FIFO cost of sales, waste, stock count differences. Late sales post as an adjustment. |
| Goods receipt | (inside the POS day) | Dr Inventory, Cr Stock received but not billed |
| Supplier invoice | `PINV-…` | Clears stock received but not billed. Input VAT, WHT and price variance; Cr Trade creditors (by supplier) |
| Payments and receipts | `PAY-…` | Bank vs party, bank charges, realised FX gain/loss, open-item allocation |
| Depreciation run | `DEP-…` | Depreciation expense vs accumulated depreciation, per asset |
| Year-end close | `PCV-…` | Income and expenses to retained earnings |

Example POS day (VAT-registered, SSCL not liable):
```
Dr Cash on hand              120,000.00
Dr Card settlements           95,000.00
Dr LankaQR settlements        36,552.40
Dr Discounts allowed           6,200.00
    Cr Sales – Food                 160,000.00
    Cr Sales – Beverage              40,000.00
    Cr Service charge                19,380.00   (10% × 193,800 net)
    Cr VAT output payable            38,372.40   (18% × 213,180)
                             ----------    ----------
                             257,752.40    257,752.40
```
Accounts for each part are set in **Finance → Finance settings**. The account for each tender is set on the tender.

## Exports for accountants, auditors and group reporting
- Excel from every finance screen: statements, GL, aging, asset register, budgets, bank reconciliation.
- Audit Center → **Auditor exports**: an Excel audit package (journal entries, documents, trial balance, audit trail, users) and **SAF-T 2.0 XML**.

## External systems (optional)
A client group that already runs ERPNext, Akaunting, Xero or QuickBooks for consolidation can import the journal-entry export or SAF-T file. Direct API connectors remain possible add-ons (Setup → Integrations → Accounting export), but they are no longer needed to keep the books.
