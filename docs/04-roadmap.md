# 04 — Delivery Roadmap

Durations are left out on purpose. They depend on the answers in [05-open-questions.md](05-open-questions.md) and on the features you choose in [03-proposed-features.md](03-proposed-features.md). Once those are settled, each milestone will get an estimate.

---

## Phase 0: Discovery and design
- Confirm the requirements (open questions) and the feature selection.
- Finalise the hardware list and order test devices: printer, cash drawer, card terminal.
- Get sandbox access from the card terminal provider and the IPG provider.
- Design clickable UX prototypes for the POS order screen, payment, floor plan, KDS, the main EMC screens and the Insights dashboard.
- Record architecture decisions (ADRs) for the open choices, such as Electron vs Tauri and the costing method.
- **Exit:** signed-off scope, prototypes and hardware.

## Phase 1: Offline go-live (Store Hub + single POS)

**M1. Foundation**
- Set up the monorepo, CI, design system (`@pos/ui`), domain schemas and the calculation engine with full unit tests.
- Build the Store Hub: SQLite document store, local API, WebSocket push, audit log and backups.

**M2. EMC (local) for configuration and People Management**
- Hierarchy, property, RVC and workstation setup.
- Menu, condiments, combos, prices, taxes, discounts, service charges and tender media.
- Roles with the privilege matrix, employees, job codes.
- Touchscreen designer and device and printer setup.

**M3. POS core**
- Sign-in, clock in/out, order types, checks, seats, courses, hold & fire.
- Split, merge, transfer, void and refund with reason codes.
- Table management and floor plan.
- Cash and card tenders, foreign currency, vouchers, house accounts.
- Receipt and kitchen printing, cash drawer, customer display.

**M4. Kitchen, cash management and End of Day**
- KDS, routing and backup devices.
- Tills, pickups, paid-in/out, blind declaration.
- EOD autosequence with X/Z reports.

**M5. Inventory**
- Items, units of measure, locations, vendors.
- Requisition → PO → GRN; recipes and real-time depletion.
- Counts, waste, transfers, variance and costing.

**M6. Reports and Insights (LAN)**
- Core sales, financial, control, labour and inventory reports with PDF and Excel export.
- Live dashboard.

**M7. Hardening and go-live**
- Failure drills: pull the network cable, kill the Hub, cut power.
- Performance tests, a dry run with real menu data, staff training material.
- Install on site, run a supervised first service, keep a hyper-care period.

**Go-live checklist (excerpt):** menu loaded and verified, tax and service charge checked against manual calculations, printers routed, card terminal certified, backups tested by a real restore, UPS installed, manager accounts created, EOD time set.

## Stabilisation month (restaurant runs on Phase 1)
- Collect feedback and ship fixes and small improvements through OTA updates.
- Prepare the Firebase project in parallel: rules, functions, indexes and BigQuery.

## Phase 2: Online (Cloud Link)
- Run the **Cloud Link cutover** described in [01-architecture.md §8](01-architecture.md#8-phase-1--phase-2-cutover-cloud-link): upload the whole existing database, verify it and switch configuration authority to the cloud. Selling never stops.
- Cloud EMC and centralised People Management; Insights available anywhere.
- WhatsApp scheduled reports and alerts.
- IPG online flows: payment links, QR, pay-at-table.
- BigQuery analytics, accounting and payroll exports.
- The P2 extras you select (for example X01, X06, X18, X23).

## Phase 3: Website and growth
- Public Ordering API and the website integration (online ordering, real-time menu and 86, IPG checkout).
- Reservations, loyalty and CRM, delivery platforms.
- AI forecasting and anomaly detection.
- Multi-property expansion, plus multi-tenant SaaS if wanted (Q1).
