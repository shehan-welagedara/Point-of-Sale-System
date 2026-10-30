# 06 — Sri Lanka Tax & Bill Compliance

> ⚠️ **Verify with the client's tax consultant before go-live.** Tax rules changed several times in 2026 and the secondary sources disagree on some points (noted below). This is why **every rate, threshold, base rule and the bill layout is configuration** with effective dates. No tax figure is hard-coded.
> Research date: 30 Oct 2026. Sources are listed at the end.

---

## 1. Taxes and charges on a restaurant bill

| Charge | Default | Applies when | Notes |
|--------|---------|--------------|-------|
| **Service charge (SC)** | 10% (configurable) | Restaurant policy, usually dine-in only | Configurable per RVC or order type (e.g. none for takeaway). Taxable: it forms part of the VAT base. |
| **SSCL** (Social Security Contribution Levy) | **2.5%** | Business is SSCL-liable | Threshold from **1 Jul 2026**: **Rs 9 M per quarter or Rs 36 M over 4 consecutive quarters** (SSCL Amendment Act No. 10 of 2026, as reported). It is commonly shown as a separate line on bills. |
| **TDL** (Tourism Development Levy) | 1% (off by default) | Only for SLTDA-registered tourist establishments | Optional tax rule. |
| **VAT** | **18%** | Business is VAT-registered | Standard rate since 1 Jan 2024. Registration threshold is reported as **Rs 60 M per year / Rs 15 M per quarter**. A Budget 2026 proposal to cut it to Rs 36 M was reportedly withdrawn, so sources conflict here. |

### Default calculation order (exclusive pricing)
```
Subtotal (items + priced modifiers)
 − Discounts
 = Net subtotal
 + Service charge   = 10%  × Net subtotal
 + SSCL             = 2.5% × (Net subtotal + SC)
 + VAT              = 18%  × (Net subtotal + SC + SSCL)
 = Bill total  → cash rounding (optional, e.g. to Rs 1)
```
Example: Net subtotal Rs 1,000.00 → SC Rs 100.00 → SSCL Rs 27.50 → VAT Rs 202.95 → **Total Rs 1,330.45**.

Each tax rule in EMC has:
- **rate**
- **base**: which earlier lines it is calculated on (net subtotal, SC, SSCL, other taxes)
- **applies to**: tax classes, order types, RVCs
- **rounding**: per line or per bill, half-up to the cent
- **effective from / to** dates
- **show on bill**: yes or no

This handles any order the consultant confirms. It also handles a new restaurant that is **not yet VAT- or SSCL-registered**: those rules are simply switched off and the bill is printed as a plain **INVOICE/BILL**, not a "TAX INVOICE".

### Inclusive pricing mode
If menu prices already include the taxes (common for takeaway and cafés), the engine **back-calculates** SC, SSCL and VAT from the price so the bill and reports still show each component. Inclusive or exclusive is set per property, with an RVC override.

---

## 2. VAT tax invoice format (Gazette Extraordinary 2481/22, 27 Mar 2026)

Reported to be effective from **1 Jul 2026**. One source reports a postponement to **1 Oct 2026**, but either way **it applies today**. When the property is VAT-registered, the POS bill printer prints the following mandatory particulars:

| # | Requirement | How the system meets it |
|---|-------------|------------------------|
| 1 | The words **"TAX INVOICE"** shown prominently | Double-height, centred title |
| 2 | Supplier **TIN (9 digits)**, **registered name** and **registered address** exactly as on the VAT registration certificate | Property → Legal entity settings in EMC (validated, separate from the trading/brand name) |
| 3 | Purchaser **TIN, name and address** when the purchaser is VAT-registered | POS **"Business customer (VAT)"** button: enter or look up the buyer's TIN, name and address, which then print on the invoice |
| 4 | **Invoice date** and **date of supply**, shown as two separate fields | Both printed. Date of supply = business date / time of service |
| 5 | **Serial number** in the format `YYMMM_QQQQ_XXXXX` | `YY` year, `MMM` month (JAN…DEC), `QQQQ` classification code (1–15 chars; we use the workstation or outlet code), `XXXXX` digits only. No spaces, ≤ 40 characters, sequential continuity, with restart allowed at a new month or year (IRD Circular SEC/2026/E/03, 20 May 2026). Example: `26OCT_W01_1234` |
| 6 | **Net value, VAT amount and total shown separately** | Printed in the totals block |
| 7 | Description, quantity and value of the supply | Item lines |
| 8 | Only VAT-able supplies on a tax invoice | Exempt or out-of-scope items (if any) print on a separate invoice. Configurable per tax class |

Other rules built in:
- **Reprints** are marked "COPY" / "DUPLICATE". The original invoice number is never reused.
- **Voiding an issued invoice** requires a manager reason and creates a linked credit note; it is never deleted.
- **Non-VAT-registered mode** uses a simple invoice layout with no VAT line and no "TAX INVOICE" title.
- **E-invoicing / RAMIS:** reports mention future IRD system integration (RAMIS Web API). The immutable `invoices/` collection and the hash-chained records are designed so that a future e-invoicing connector can be added without changing the data model.

### 80 mm bill layout (VAT-registered example)
```
            [ LOGO ]
          TAX INVOICE
   <Registered name as per VAT cert.>
   <Registered address>
   TIN: 123456789   Tel: 0xx xxx xxxx
   Trading as: <Restaurant brand>
--------------------------------------
Invoice No : 26OCT_W01_1234
Invoice Dt : 30-10-2026 20:41
Supply Dt  : 30-10-2026
Table 12   Covers 4   Server: Nimal
--------------------------------------
Qty Item                       Amount
 2  Chicken Kottu              2,400.00
 1  Lime Juice                   450.00
    - No sugar
--------------------------------------
Subtotal                       2,850.00
Discount (Staff 10%)            -285.00
Service Charge 10%               256.50
SSCL 2.5%                         70.54
Value excl. VAT                2,892.04
VAT 18%                          520.57
======================================
TOTAL (LKR)                    3,412.61
--------------------------------------
Cash                           4,000.00
Change                           587.39
--------------------------------------
Purchaser (if VAT-registered):
 <Name>  TIN: <9 digits>  <Address>
--------------------------------------
     Thank you! [QR: feedback/e-bill]
```
*(Layout, fonts, languages (Sinhala/Tamil/English), logo, header and footer are all configurable in EMC. Item lines and figures are illustrative.)*

---

## 3. Points for the client's accountant to confirm
1. Is the business **VAT-registered** from opening (voluntarily or because it expects to exceed the threshold)? Is it **SSCL-liable**?
2. Is the **service charge %** right, and is SC applied to takeaway?
3. Should the **SSCL base** include the service charge? (Our default is yes.)
4. Are menu prices **inclusive or exclusive**?
5. What **classification code** should go in the invoice number (per terminal, e.g. `W01`, or per outlet)?
6. Does **TDL** apply (only for SLTDA-registered establishments)?

## Sources
- [VAT/SSCL changes from 1 April 2026 – BPC](https://bpc.lk/whats-changing-under-vat-sscl-from-1-april-2026/)
- [VAT Registration Sri Lanka 2026 – lankantax.com](https://lankantax.com/vat-registration-sri-lanka/)
- [SSCL Sri Lanka 2026 – lankantax.com](https://lankantax.com/sscl-sri-lanka/)
- [SSCL Amendment 2026 – taxable.lk](https://taxable.lk/blog/sscl-amendment-2026-sri-lanka)
- [Sri Lanka expands VAT, lowers threshold proposal – VATupdate](https://www.vatupdate.com/2026/05/04/sri-lanka-expands-vat-to-digital-services-raises-financial-services-rate-lowers-registration-threshold/)
- [Revised Tax Invoice Format – KPMG Sri Lanka, Apr 2026](https://assets.kpmg.com/content/dam/kpmgsites/lk/pdf/kpmg-tax-news/2026/april/Revised_Tax_Invoice_Format.pdf)
- [Gazette 2481/22 – IRD](https://www.ird.gov.lk/en/publications/Gazette_Documents/2026_2481-22_E.pdf)
- [IRD Circular SEC/2026/E/03](https://www.ird.gov.lk/en/publications/Circulars_Circulars/SEC_2026_E_03_E.pdf)
- [Sri Lanka postpones revised VAT invoice format – Comarch](https://www.comarch.com/trade-and-services/data-management/legal-regulation-changes/sri-lanka-postpones-revised-vat-invoice-format-amid-wider-vat-reforms/)
- [Sri Lanka Tax Invoice Format 2481/22 field mapping – Capricon](https://capricon.biz/blog/sri-lanka-tax-invoice-format-2481-22-fields-erp-mapping)
- [Hotel bill tax calculator (SC, TDL, SSCL, VAT order) – induwara.lk](https://induwara.lk/tools/sri-lanka-hotel-bill-tax-calculator)
