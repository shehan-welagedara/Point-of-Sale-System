# 04 — Delivery Roadmap (revised 2026-10-30: online-first)

## Status (2026-11-03)
Built and demo-ready:
- **R1 core POS:**
  - POS for dedicated terminals and tablets, with IRD tax invoices, tenders, KOT routing, X/Z reports and End of Day.
  - EMC configuration, People Management and branding.
  - Reports and WhatsApp EOD (simulated).
- **R2 extended:**
  - Inventory with FIFO, recipe depletion, purchasing, counts, waste, transfers and production; recipes and costing.
  - Accounting journals, P&L and Excel export; menu engineering; CRM and loyalty.
- **R3 platform:**
  - Multi-tenant businesses with modules per client, security rules (tested on the emulator), invitations, Excel data feeders and the Print Agent.

Still to do:
- Live PayHere and WhatsApp (needs Cloud Functions and approved accounts).
- Refunds of closed checks (credit notes), cash declaration per till, KDS screen, drag-and-drop screen designer, QR ordering (X01).
- Accounting connectors (ERPNext/Akaunting), the POS Shell desktop wrapper.
- Website (R4).


## ⚠️ The restaurant opens next week, but the system won't be ready by then
A production POS that prints legally compliant bills, handles money and has been tested on real hardware **cannot responsibly go live in one week**. Rushing it risks wrong bills, lost sales data and staff losing trust in the system on day one.

**Recommended interim plan for the first weeks:**
- Use a numbered bill book or a simple free POS app (for example on a tablet) for the opening weeks, plus cash, LankaQR and the bank's card terminal.
- If the business is **not VAT-registered at opening** (likely for a new business below the threshold; confirm with the accountant), simple bills are sufficient during this period.
- Meanwhile we build and test Release 1, and the client completes the set-up checklist in [09 §7](09-costing-proposal.md): Google account, Meta/WhatsApp verification, PayHere, bank and hardware. **Several of those approvals take days, so they should start now.**
- Sales from the interim period can be imported as opening history if wanted.

Estimates assume steady development and timely access to the client's hardware and accounts.

---

## Release 1: Core POS go-live (target ≈ 4–6 weeks)

**R1.1 Foundation**
- Monorepo, CI, design system.
- **`@pos/engine`**: pricing, Sri Lanka taxes, discounts, service charge, rounding, invoice numbers. ✅ started.
- Firebase project, Auth, multi-tenant Firestore model, Security Rules with tests.

**R1.2 EMC essentials**
- Tenant, property, RVC and workstation setup.
- **Branding**: logo, colours, bill header and footer.
- Legal entity, TIN and invoice settings.
- Menu items, modifiers/condiments, combos, prices, serving periods.
- Tax rules, service charge, discounts, tender media, reason codes.
- **People Management**: users, roles, privilege matrix, PIN/card.
- Printer setup and touchscreen pages (template-based first; the drag-and-drop designer follows in R2).

**R1.3 POS**
- Sign-in, order types, tables and floor plan, checks, seats and courses.
- Send to kitchen (printer routing).
- Split, merge, transfer, void and refund with reasons; discounts; manager override; allergen alerts (X14).
- **Tenders**: cash (with foreign currency), card (standalone terminal), LankaQR, vouchers, house account, comp.
- **IRD-format bill printing** (VAT and non-VAT modes), cash drawer kick.
- Resilience to internet drops.

**R1.4 POS Shell**
- Electron wrapper with ESC/POS printing over USB, Ethernet or serial (tested on the Epson TM-T82III and one budget printer), cash drawer, kiosk mode, auto-update.

**R1.5 End of Day and reports**
- Business day, cash declaration, EOD autosequence.
- **Daily Revenue, Item-wise, Covers and Sales reports**, plus Tenders, Discounts and Voids.
- Insights dashboard.
- **EOD WhatsApp PDF to managers** (as soon as Meta approves the number and templates).

**R1.6 Go-live**
- Load the client's menu, verify bills with the accountant, train staff, run a supervised first service, then a hyper-care week.

## Release 2: Extended (≈ 4–6 weeks after R1)
- **Inventory module** (optional per tenant):
  - Items, units of measure, locations, vendors.
  - Recipes and sub-recipes with **real-time depletion**, **FIFO** lots and costing.
  - Requisitions → POs → GRN; transfers, waste, production.
  - Stock counts and the **mobile stock count app (X34)**.
  - Variance, valuation, par levels and reorder suggestions, low-stock alerts.
- **X18 real-time exception alerts** (WhatsApp and EMC).
- **X21 menu engineering**.
- **X27 Excel accounting workbook** (with an ERPNext connector as a follow-up).
- **X06 digital receipts** (WhatsApp/email) in addition to the printed bill.
- **X38 remote device monitoring**, staged OTA rollout.
- Touchscreen drag-and-drop designer; KDS (optional); attendance clock in/out (optional).

## Release 3: Product-ready for selling
- **Platform Admin**: tenant onboarding wizard, licences and module flags, usage dashboard.
- Menu and recipe Excel import templates, demo tenant, documentation and training videos.
- **X01 QR table ordering & PayHere pay-at-table** (optional module).
- Hardening: load tests, security review, backups and export, status page.

## Release 4: Website (optional, last)
- Firebase-hosted restaurant website with **online ordering (pickup or delivery)**, real-time menu and stock, PayHere checkout, and orders flowing straight into the POS and kitchen.
