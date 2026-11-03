# Point-of-Sale-System (POS Suite)

A restaurant platform for the Sri Lankan market. It combines **POS + back office (EMC) + recipes and costing + inventory and purchasing (ERP) + customers (CRM) + accounting + revenue reports**, all sharing one Firebase/Firestore database. Each client gets **only the modules they buy**.

> **Status:** working product foundation with full demo data. Runs locally with no setup, or on Firebase within the free tier. Integrations (PayHere, LankaQR, WhatsApp) run as templates in mock mode until client accounts are approved.

## Try it in one minute
```bash
pnpm install
pnpm dev                 # open http://localhost:5173 → "Load the demo restaurant"
```
- POS: **Open POS** → pick a workstation → *Kasun Perera* → PIN **1111**.
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
| **Accounting** | Chart of accounts, account mapping, automatic **balanced daily journals** (sales, discounts, SC, SSCL, VAT, tenders, FIFO cost of sales, waste, supplier receipts), P&L, trial balance, VAT/SSCL summary, Excel export |
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
| 08 | [Accounting integration](docs/08-accounting-integration.md) |
| 09 | [Running-cost plan & proposal](docs/09-costing-proposal.md) |
| 10 | [**Firebase setup that stays inside the free tier**](docs/10-firebase-free-tier.md) |
| 11 | [**Hardware models (dedicated vs tablets) & printing**](docs/11-hardware-and-printing.md) |
| 12 | [**Getting started, demos & client deployments**](docs/12-getting-started.md) |

## Commands
```bash
pnpm dev               # web app (local demo mode unless apps/web/.env.local has a Firebase config)
pnpm test              # unit tests (engine, core, printing, sample data, Excel, print agent)
pnpm test:rules        # Firestore security rules on the emulator (needs Java)
pnpm emulators         # local Firebase Auth + Firestore
pnpm build             # production build of the web app
pnpm firebase:deploy   # deploy hosting + Firestore rules/indexes to the selected Firebase project
pnpm templates         # regenerate templates/*.xlsx
pnpm agent             # run the Print Agent (apps/print-agent/.env)
```

## Repository layout
`apps/web` (back office + POS) · `apps/print-agent` · `packages/{engine,core,printing,sample-data,excel}` · `firebase/` (rules, indexes, rules tests) · `templates/` (Excel feeders) · `docs/`
