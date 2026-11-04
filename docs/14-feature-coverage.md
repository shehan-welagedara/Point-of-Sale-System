# 14 — Feature coverage: Oracle Simphony / EMC / People Management and SAP S/4HANA

The benchmarks are Oracle MICROS Simphony (POS, EMC, Simphony People Management) and SAP S/4HANA. This page shows where this product stands against them, feature by feature. It doubles as the roadmap.

> **Scope, honestly.** Simphony and S/4HANA are the result of decades of development; S/4HANA alone has thousands of transactions across every industry. No single build reaches "all of their features". This product covers what restaurants and medium-to-large hotels use day to day, with the same concepts (enterprise → property → revenue centre, roles and privileges, journals, universal journal, document principle). It then adds what modern cloud POS systems offer: a browser and tablet UI, themes, photos, licence keys, and live audit and integrity checks. The rows marked *Planned* are the gaps.
>
> Status: ✅ built and tested · ◐ partly built · ⏳ planned · ✖ out of scope by decision.

## 1. POS (Simphony workstation functions)

| Area | Feature | Status |
|---|---|---|
| Devices | Workstations bound to a property and revenue centre; dedicated terminals and tablets; per-workstation invoice series | ✅ |
| | Printing to receipt, kitchen and bar printers with backup printers; tablets through the Print Agent | ✅ |
| | Offline operation (Simphony CAPS) | ✖ online-first (D1); the Firestore cache rides out short drops |
| | Kitchen display screens | ⏳ (kitchen tickets on printers today) |
| Sign-in | Employee number + PIN, magnetic/RFID card, or tap-name; lockout after wrong PINs; manager unlock | ✅ |
| | Automatic sign-out on inactivity, per property and per workstation | ✅ |
| | Revenue-centre list at sign-in (operator records per revenue centre) | ✅ |
| | Clock in / clock out (time and attendance) | ✅ |
| Access | Roles with privileges, levels and limits (discount %, void value, price change %, paid-out, refund) | ✅ |
| | "Needs approval" per privilege; manager override by card or PIN, only by a more senior role within their limit | ✅ |
| | Per-property roles for people working in several hotels | ✅ |
| Checks | Tables, covers, order types, open-checks list, pick up (with privilege for others' checks) | ✅ |
| | Modifiers with min/max, notes, allergy alerts | ✅ |
| | Send / hold-and-fire by round, KOT routing (kitchen/bar), guest check with LankaQR | ✅ |
| | Transfer check to another employee or table; split items to a new check | ✅ |
| | Merge checks; split by seat or evenly | ⏳ |
| | Reopen a closed check / refund with a credit note | ⏳ (privilege exists; IRD credit-note format to be added) |
| Items | Search, categories as tabs or side rail, photos on buttons, button colours, 86 (out of stock) | ✅ |
| | Open-price items; price override with limit | ✅ |
| | Combo/set meals; price levels per revenue centre or time (happy hour) | ⏳ |
| | Sinhala/Tamil item names | ◐ (stored and imported; display switch to come) |
| Discounts | Item and check discounts, percentage or amount, manager-only discounts, limit by role | ✅ |
| Payments | Cash with change, card (terminal reference), LankaQR, PayHere, foreign cash, vouchers, house account, complimentary; split tenders | ✅ (PayHere/LankaQR in mock mode until live keys) |
| | Tips; bar tabs with card pre-authorisation | ⏳ |
| | Room charge to the hotel PMS (Oracle OPERA etc.) | ⏳ high priority for hotels |
| Cash | No sale, paid in, paid out (journaled, limits) | ✅ |
| | Till assignment per cashier, blind cash declaration, over/short | ⏳ (expected cash shown on reports today) |
| Reports on the POS | Daily sales (system / revenue centre / own), employee financial, menu item sales, open checks, exceptions, X and Z | ✅ |
| Journal | Electronic journal of every operator action, hash-chained per workstation, append-only | ✅ |
| Look | Three templates (Classic, Modern, Midnight) with every colour, size and layout customisable | ✅ |
| End of day | Z report, stock depletion, ledger posting, WhatsApp report to managers | ✅ |

## 2. EMC (enterprise configuration)

| Feature | Status |
|---|---|
| Hierarchy: enterprise (business) → properties → revenue centres → workstations | ✅ |
| Menu items, categories, modifiers, tenders, discounts, reason codes, order types, tables, printers | ✅ |
| Excel import/export of master data (data feeders) with validation | ✅ |
| Field-level audit trail of every configuration change, sealed in a hash chain | ✅ |
| Validation of every record on save; data-quality check across modules | ✅ |
| Separate workspaces per module with a launchpad | ✅ |
| Licence keys, editions, modules per client | ✅ |
| Zones (sharing configuration between groups of properties); effective-dated records | ⏳ |
| Drag-and-drop touchscreen designer | ⏳ (themes and layout options instead) |

## 3. Simphony People Management (and hotel user hierarchy)

| Feature | Status |
|---|---|
| Employee records: number, card, job title, department, properties, revenue centres, employment dates, status | ✅ |
| Role per property; role levels; privileges with limits; "needs approval" | ✅ |
| PIN policy (length, no easy PINs), lockout, unlock, last sign-in | ✅ |
| Time cards (clock in/out, hours per employee) | ✅ |
| Back-office logins with roles (owner, admin, manager, accountant, storekeeper, auditor, viewer, terminal), invitations | ✅ |
| Access review export for sign-off | ✅ |
| Scheduling, labour forecasting, payroll export | ⏳ (payroll excluded by D8; export file planned) |
| Single sign-on (Microsoft/Google Workspace) for back office | ⏳ |

## 4. SAP S/4HANA (finance and logistics relevant to hospitality)

| S/4HANA area | Feature | Status |
|---|---|---|
| Finance (FI) | Universal journal, document principle, gap-free numbering, reversal only | ✅ |
| | Payables with 3-way match, GR/IR, receivables, open items, aging | ✅ |
| | Bank reconciliation, foreign currency with realised FX | ✅ |
| | Asset accounting (SL/WDV, disposal) | ✅ |
| | Period close, year-end close, SLFRS statements, cash flow | ✅ |
| | Maker–checker workflow, SoD, audit trail, SAF-T | ✅ |
| | Multi-company consolidation, intercompany, IFRS 16 leases, deferred tax, dunning, cash forecasting | ⏳ |
| Controlling (CO) | Cost centres on every line, budgets vs actual | ✅ |
| | Profit centres, internal orders, allocation cycles | ⏳ |
| Materials management (MM) | Stock items, locations, FIFO valuation, purchase orders, goods receipts, transfers, counts, waste, production (prep recipes) | ✅ |
| | Purchase requisitions with approval, vendor evaluation, batch/expiry tracking, MRP | ⏳ |
| Sales (SD) | Customer invoices, receipts | ✅ |
| | Banquet/event orders and quotations | ⏳ |
| GRC | Segregation of duties rules, access review, integrity verification | ✅ |
| HR / Payroll | — | ✖ excluded (D8) |
| Analytics | Dashboards, item sales, covers, menu engineering, budget vs actual | ✅ |
| | Self-service BI / BigQuery export | ⏳ (BigQuery costs money; Excel exports today) |

## 5. Modern POS features beyond the benchmarks

| Feature | Status |
|---|---|
| Runs in any browser and on tablets; no server to install | ✅ |
| Themes and photos per client, no developer needed | ✅ |
| Licence keys and module entitlements, as SaaS products use | ✅ |
| Live integrity check of invoices, ledger, audit trail and POS journal | ✅ |
| WhatsApp end-of-day report | ✅ (simulated until Meta approval) |
| QR table ordering and payment; website ordering | ⏳ |

## 6. Suggested next steps for hotels (in priority order)

1. **Room charge interface** to the property management system (posting checks to guest folios).
2. Till assignment and blind cash declaration.
3. Reopen/refund with IRD credit notes.
4. Price levels and happy hours.
5. Merge checks and split by seat.
6. Kitchen display screens.
7. Zones and effective-dated configuration for hotel groups.
8. Purchase requisitions with approval.
