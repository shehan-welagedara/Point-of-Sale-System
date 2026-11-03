# 05 — Decisions Log & Remaining Questions

## Decisions (2026-10-30)
| # | Topic | Decision |
|---|-------|----------|
| D1 | Deployment | **Fully online / cloud** (Firebase). No offline phase. The POS stays resilient to short internet drops. |
| D2 | Product | First build for one restaurant, designed as a **multi-tenant product** to sell to other restaurants. |
| D3 | Country | **Sri Lanka**: VAT, SSCL, service charge, IRD tax-invoice format. See [06](06-sri-lanka-compliance.md). |
| D4 | Restaurant type | Generic: configurable for any restaurant type; client-specific tailoring later. |
| D5 | Hardware | Any Windows 10/11 PC or Windows touch POS; Epson TM-T82III or any ESC/POS printer; RJ11 cash drawer. See [07](07-payments-and-hardware.md). |
| D6 | Payments | **PayHere** for IPG. Cheapest mix recommended: cash + LankaQR + bank card terminal in-store, PayHere for online. |
| D7 | Inventory | Optional module; **every sale deducts stock through recipes**; **FIFO** costing; complete feature set. |
| D8 | People Management | User accounts, roles, privileges and access control only. **No HR/payroll.** |
| D9 | Accounting | ~~Excel workbook, then an ERPNext connector.~~ Superseded by D24. |
| D10 | Reports | Daily Revenue, Item-wise, Covers and Sales reports, sent to **managers only at End of Day** via WhatsApp. |
| D11 | Website | Firebase-based, online ordering (pickup/delivery). **Last, optional phase.** |
| D12 | Cloud ownership | The manager's Google account owns the Firebase project and billing. Costing in [09](09-costing-proposal.md). |
| D13 | Branding | Software brand is TBD. **Each restaurant's logo, colours and theme are configurable in EMC.** |
| D14 | Repository | This repo. **One `main` product with configuration, feature flags and extension packages per client** (instead of long-lived client branches; reasoning in [01 §4](01-architecture.md)). |
| D15 | Selected extras | X01 (optional), X06, X14, X18, X21, X27, X34, X38. Not X11. |

## Decisions (2026-11-03)
| # | Topic | Decision |
|---|-------|----------|
| D16 | Environments | The code base and your demo environment live in **your** Firebase project (Blaze, kept within the free tier, see [10](10-firebase-free-tier.md)). Each client is deployed to **their own** Firebase project. |
| D17 | Demo tax profile | Sample restaurant is **VAT-registered, not SSCL-liable**. Real details are entered per client at deployment. |
| D18 | Payments & integrations | PayHere and LankaQR (and WhatsApp, accounting connectors) built as **templates with sample data in mock mode**; live integration later. |
| D19 | Branding | No confirmed assets yet: sample brand; logo, colours and bill text configurable per client in EMC → Branding. |
| D20 | Data feeding | Menu, prices, modifiers, stock items and recipes are maintained in **Excel data feeders** and imported. |
| D21 | One database, chosen modules | POS, recipes and costing, inventory and purchasing (ERP), accounting, CRM and revenue reports share one database; each client gets only the modules they buy (*Setup → Modules*, enforced by security rules). |
| D22 | Hardware | Two models in the same system: **dedicated** (Windows PC / POS terminal) and **mobility** (tablets). Both print physical bills and KOTs through the **Print Agent**. |
| D23 | Market | Built for the Sri Lankan client market first (LKR, IRD invoice format, VAT/SSCL/SC, LankaQR, PayHere, Sinhala/Tamil item names). |

## Decisions (2026-11-04)
| # | Topic | Decision |
|---|-------|----------|
| D24 | Accounting | A **complete accounting system following ERPNext's design, built natively on Firestore** (not ERPNext itself, which needs its own MariaDB server). The whole database stays in Firebase. Feature scope is benchmarked on SAP S/4HANA Finance. See [13](13-accounting-and-audit.md). |
| D25 | Server-side logic | **Cloud Functions** for posting, numbering, approvals, period close and the audit trail, so no client can bypass them. Settings keep them in the free tier ([10](10-firebase-free-tier.md)). Clients without Accounting can run without functions. |
| D26 | Audit | Field-level audit trail of every business record, captured by a server trigger, sealed hourly in a hash chain. Plus integrity verification, segregation of duties, an auditor role, and SAF-T and auditor exports. |

## Remaining questions (as of 2026-10-30; items 1, 2, 4 and 6 are now covered by sample data or D16–D19)
1. **VAT and SSCL status at opening:** is the restaurant VAT-registered and/or SSCL-liable from day 1? I need the registered name, address and TIN for the bill header.
2. **Service charge:** confirm the % and whether it applies to takeaway and delivery. Are menu prices **inclusive or exclusive** of taxes?
3. **Opening plan:** given next week's opening, will you use an interim arrangement for the first weeks (see [04](04-roadmap.md))?
4. **Firebase ownership for future clients:** keep a separate project per client (each client pays Google directly), or run one platform project that you own and bill clients a subscription? The code supports both, but it affects pricing.
5. **Bank:** which bank will provide the card terminal and the LankaQR merchant QR?
6. **Product name:** do you have a name for the software product? It is used in the installer, the EMC login page and the receipt footer ("Powered by …").
