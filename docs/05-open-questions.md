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
| D21 | One database, chosen modules | POS, recipes and costing, inventory and purchasing (ERP), accounting, CRM and revenue reports share one database; each client gets only the modules they buy (*Administration → Licence & modules*, within the licence entitlement, enforced by security rules). |
| D22 | Hardware | Two models in the same system: **dedicated** (Windows PC / POS terminal) and **mobility** (tablets). Both print physical bills and KOTs through the **Print Agent**. |
| D23 | Market | Built for the Sri Lankan client market first (LKR, IRD invoice format, VAT/SSCL/SC, LankaQR, PayHere, Sinhala/Tamil item names). |

## Decisions (2026-11-04)
| # | Topic | Decision |
|---|-------|----------|
| D24 | Accounting | A **complete accounting system following ERPNext's design, built natively on Firestore** (not ERPNext itself, which needs its own MariaDB server). The whole database stays in Firebase. Feature scope is benchmarked on SAP S/4HANA Finance. See [13](13-accounting-and-audit.md). |
| D25 | Server-side logic | **Cloud Functions** for posting, numbering, approvals, period close and the audit trail, so no client can bypass them. Settings keep them in the free tier ([10](10-firebase-free-tier.md)). Clients without Accounting can run without functions. |
| D27 | Licensing | Editions + add-ons + limits as entitlements in vendor-signed licence keys (ECDSA), bound to the client's Firebase project; modules chosen at installation within the entitlement. See [15](15-licensing-and-modules.md). |
| D28 | Navigation | Back office split into module workspaces opened from a launchpad (Fiori / EMC style). |
| D29 | Users and access | Simphony-style hierarchy (enterprise → property → revenue centre), roles per property with levels and limits, operator records per revenue centre, manager override by seniority. See [16](16-users-access-and-audit.md). |
| D30 | POS look | Three templates (Classic, Modern, Midnight) plus full customisation; item photos stored resized in Firestore (no Cloud Storage cost). |
| D31 | Quality | Schema validation on every save, cross-module data-quality check, browser end-to-end tests in CI-style scripts. |
| D32 | Editions | Two editions in one repository: this Cloud Restaurant Edition, and an Enterprise Hotel Edition (MariaDB POS + guest system + ERPNext, hotel servers + Google Cloud, Firebase console) on branch `enterprise/hotel-suite`. Shared packages change here first and are merged into the enterprise branch. |
| D26 | Audit | Field-level audit trail of every business record, captured by a server trigger, sealed hourly in a hash chain. Plus integrity verification, segregation of duties, an auditor role, and SAF-T and auditor exports. |
| D33 | Product and company | The product is **POS Suite by Polymath Tech**. The company name appears on the login, the About page, bills ("Powered by Polymath Tech", editable per client), exports and the manuals; one definition in `packages/core/src/brand.ts`. |
| D34 | Updates without gcloud | The release tool talks to Google with the Firebase CLI's sign-in (backups, data updates, permissions), so a vendor PC needs only Node.js, Git and `firebase login`. GitHub Actions uses workload identity. |
| D35 | Central management | **Polymath Console**: Polymath Tech's own Firebase project and web app for clients, licences (signing key in Secret Manager), subscriptions and renewals, health, usage, suspend/restore and updates through GitHub Actions; staff roles with an audit log. Clients check in once a day (outbound only, Google-signed identity, signed answers). See [22](22-polymath-console.md). |
| D36 | Console design and figures | The console follows the **Polymath Technologies** design (light lavender and violet, dark theme to match). Maps are drawn from Natural Earth paths generated once (`tools/console/make-map.mjs`), not a map library or a map service, so no client location leaves the console. Trend lines come from one `metrics/{date}` document a day written by the console's server, not from re-reading history. Revenue means payments recorded in the console, not invoices. |
| D37 | Updates and new businesses | Updates are pushed from the console to chosen clients (now, at a time, or in each client's maintenance window, announced at least an hour ahead); a client is done only when its own check-in reports the version. Every new business on a linked system is approved by Polymath Tech first (two-step validation: the system, then the business), with signed decisions the security rules enforce; approvals can be switched off per client for demo systems. Businesses are archived, never deleted, by their owner. Check-ins are hourly. See [22 §8–9](22-polymath-console.md). |
| D38 | Privacy | Personal data stays in each client's own project; the console holds business data only (plus the name and email of whoever asks to open a business). Retention periods, data agreements, export and erasure are in the console. Written around Sri Lanka's PDPA (No. 9 of 2022), for review by a lawyer. See [24](24-privacy-and-data-protection.md). |

## Remaining questions (as of 2026-10-30; items 1, 2, 4 and 6 are now covered by sample data or D16–D19)
1. **VAT and SSCL status at opening:** is the restaurant VAT-registered and/or SSCL-liable from day 1? I need the registered name, address and TIN for the bill header.
2. **Service charge:** confirm the % and whether it applies to takeaway and delivery. Are menu prices **inclusive or exclusive** of taxes?
3. **Opening plan:** given next week's opening, will you use an interim arrangement for the first weeks (see [04](04-roadmap.md))?
4. **Firebase ownership for future clients:** keep a separate project per client (each client pays Google directly), or run one platform project that you own and bill clients a subscription? The code supports both, but it affects pricing.
5. **Bank:** which bank will provide the card terminal and the LankaQR merchant QR?
6. ~~**Product name**~~: decided, POS Suite by Polymath Tech (D33).
