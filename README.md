# Point-of-Sale-System (POS Suite)

A restaurant platform for the Sri Lankan market. It combines **POS + back office (EMC) + recipes and costing + inventory and purchasing (ERP) + customers (CRM) + a full general ledger + revenue reports**, with a system-wide audit trail,, all sharing one Firebase/Firestore database. Each client gets **only the modules they buy**.

> **Status:** working product foundation with full demo data. Runs locally with no setup, or on Firebase within the free tier. Integrations (PayHere, LankaQR, WhatsApp) run as templates in mock mode until client accounts are approved.

## Try it in one minute
```bash
pnpm install
pnpm dev                 # open http://localhost:5173 → "Load the demo restaurant"
```
- POS: **Open POS** → pick a workstation → *Kasun Perera* → PIN **1111**.
- Finance: **Finance → Overview**. Switch **Acting as** (bottom of the sidebar) between Owner, Accountant and External auditor to see maker–checker approvals and read-only audit access.
- All demo data is fictional sample data: "Spice Lagoon", Colombo. VAT-registered, SSCL not liable.

## What's in the box
| Area | Highlights |
|------|-----------|
| **POS** (terminals and tablets) | PIN sign-in with roles and manager override; tables and covers; dine-in, takeaway and delivery; modifiers; **allergy alerts**; send to kitchen (KOT routing kitchen/bar, backup printers); guest check with **LankaQR**; split payments (cash with change, card approval code, LankaQR, PayHere, USD cash, vouchers, house account, comp); voids with reason codes; discounts; 86 items; X/Z reports; **End of Day** (stock deduction, journal, WhatsApp report) |
| **Sri Lanka compliance** | Service charge → SSCL → VAT order, inclusive or exclusive pricing, **IRD tax invoice format** (Gazette 2481/22) with `YYMMM_W01_n` numbers per workstation, hash-chained immutable invoices, plain invoices for non-VAT businesses |
| **Back office (EMC)** | Menu, categories, modifiers, tenders, discounts, order types, reason codes, tables, outlets and revenue centres, devices and printers, **branding per client** (logo, colours, bill text), **modules on/off per client** |
| **People Management** | POS staff (PIN, card, status), roles with a privilege matrix, back-office logins with access levels and email invitations |
| **Recipes & costing** | Recipes and prep sub-recipes, portion cost, food cost %, gross profit, price at target cost % |
| **Inventory & purchasing** | Stock items with purchase/stock units, locations, **FIFO** lots, recipe-based depletion of every sale, purchase orders (suggested from par levels), goods receipts with input VAT, waste, transfers, production batches, blind stock counts, movements, valuation |
| **Accounting (general ledger)** | ERPNext design on Firestore with an S/4HANA-style universal journal: POS days post automatically; supplier invoices with **3-way match**; customer invoices; payments with open items and FX; **bank reconciliation**; **fixed assets** (SL/WDV); budgets; **period close** and year-end; SLFRS **P&L, balance sheet, cash flow**, TB, GL, VAT/SSCL/WHT; **maker–checker approvals**; gap-free numbering and hash-chained postings, all on the server (Cloud Functions). [Details](docs/13-accounting-and-audit.md) |
| **Audit Center** | Field-level **audit trail of every record** (who, when, before → after) captured server-side and **sealed hourly in a hash chain**; one-click **integrity verification**; numbering gaps; segregation-of-duties review; access review; **SAF-T 2.0** and an auditor Excel package; read-only **Auditor** role |
| **Reports & revenue** | Dashboard, **Daily Revenue, Item-wise, Covers, Sales** (category, hour, order type, payments), checks list, **menu engineering**, monthly target, Excel export, **WhatsApp end-of-day report** (simulated until Meta approval) |
| **CRM** | Customers, visits and spend, loyalty points, tags, business buyers printed on VAT invoices |
| **Excel data feeders** | One workbook for menu, prices, modifiers, stock items, recipes, vendors and customers, with row-level validation on import |
| **Printing** | Print Agent for USB/network ESC/POS printers and the cash drawer. Tablets print physical bills and KOTs through it |

## Documentation
| # | Document |
|---|----------|
| 01 | [Architecture](docs/01-architecture.md) |
| 02 | [Feature catalogue](docs/02-feature-catalog.md) |
| 03 | [Extra features & selections](docs/03-proposed-features.md) |
| 04 | [Roadmap & status](docs/04-roadmap.md) |
| 05 | [Decisions log](docs/05-open-questions.md) |
| 06 | [Sri Lanka tax & bill compliance](docs/06-sri-lanka-compliance.md) |
| 07 | [Payments & hardware options](docs/07-payments-and-hardware.md) |
| 08 | [Accounting](docs/08-accounting-integration.md) |
| 09 | [Running-cost plan & proposal](docs/09-costing-proposal.md) |
| 10 | [**Firebase setup that stays inside the free tier**](docs/10-firebase-free-tier.md) |
| 11 | [**Hardware models (dedicated vs tablets) & printing**](docs/11-hardware-and-printing.md) |
| 12 | [**Getting started, demos & client deployments**](docs/12-getting-started.md) |
| 13 | [**Accounting (general ledger) & audit**](docs/13-accounting-and-audit.md) |

## Commands
```bash
pnpm dev               # web app (local demo mode unless apps/web/.env.local has a Firebase config)
pnpm test              # unit tests (engine, core, ledger, printing, sample data, Excel, print agent, functions)
pnpm test:rules        # Firestore security rules on the emulator (needs Java)
pnpm test:functions    # Cloud Functions end to end on the emulators (needs Java)
pnpm emulators         # local Firebase Auth + Firestore + Functions
pnpm build             # production build of the web app
pnpm firebase:deploy   # deploy hosting, Firestore rules/indexes and functions (see docs/10 first)
pnpm templates         # regenerate templates/*.xlsx
pnpm agent             # run the Print Agent (apps/print-agent/.env)
```

## Repository layout
`apps/web` (back office + POS) · `apps/functions` (ledger + audit) · `apps/print-agent` · `packages/{engine,core,ledger,printing,sample-data,excel}` · `firebase/` (rules, indexes, rules tests) · `templates/` (Excel feeders) · `docs/`
