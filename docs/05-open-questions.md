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
| D9 | Accounting | Built-in Excel accounting workbook, then an open-source connector (ERPNext recommended). See [08](08-accounting-integration.md). |
| D10 | Reports | Daily Revenue, Item-wise, Covers and Sales reports, sent to **managers only at End of Day** via WhatsApp. |
| D11 | Website | Firebase-based, online ordering (pickup/delivery). **Last, optional phase.** |
| D12 | Cloud ownership | The manager's Google account owns the Firebase project and billing. Costing in [09](09-costing-proposal.md). |
| D13 | Branding | Software brand is TBD. **Each restaurant's logo, colours and theme are configurable in EMC.** |
| D14 | Repository | This repo. **One `main` product with configuration, feature flags and extension packages per client** (instead of long-lived client branches; reasoning in [01 §4](01-architecture.md)). |
| D15 | Selected extras | X01 (optional), X06, X14, X18, X21, X27, X34, X38. Not X11. |

## Remaining questions
1. **VAT and SSCL status at opening:** is the restaurant VAT-registered and/or SSCL-liable from day 1? I need the registered name, address and TIN for the bill header.
2. **Service charge:** confirm the % and whether it applies to takeaway and delivery. Are menu prices **inclusive or exclusive** of taxes?
3. **Opening plan:** given next week's opening, will you use an interim arrangement for the first weeks (see [04](04-roadmap.md))?
4. **Firebase ownership for future clients:** keep a separate project per client (each client pays Google directly), or run one platform project that you own and bill clients a subscription? The code supports both, but it affects pricing.
5. **Bank:** which bank will provide the card terminal and the LankaQR merchant QR?
6. **Product name:** do you have a name for the software product? It is used in the installer, the EMC login page and the receipt footer ("Powered by …").
