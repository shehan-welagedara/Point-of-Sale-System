# POS Suite by Polymath Tech

> **This is the `enterprise/hotel-suite` branch: Enterprise Hotel Edition (Model 2).** It is for medium to large hotels and runs POS, guest system and ERPNext on MariaDB, in each hotel and in Google Cloud, all configured from the Firebase console. **Status: design and build documentation; the build has not started.** Start with [docs/enterprise](docs/enterprise/README.md). The rest of this README describes the Cloud Restaurant Edition (Model 1) that this branch starts from and reuses.


**POS Suite** is a restaurant platform for the Sri Lankan market, made by **Polymath Tech**. It combines **POS + back office (EMC) + recipes and costing + inventory and purchasing (ERP) + customers (CRM) + a full general ledger + revenue reports**, with a system-wide audit trail, all sharing one Firebase/Firestore database. Each client gets **only the modules they buy**.

> **Status:** in production (first client: Noura Kitchen, November 2026). Runs locally with no setup for demos, and in each client's own Firebase project within the free tier. Integrations (PayHere, LankaQR, WhatsApp) run as templates in mock mode until client accounts are approved.

## Editions

| Edition | For | Stack | Branch |
|---|---|---|---|
| **Cloud Restaurant Edition** (Model 1) | Small to medium restaurants and cafés | Fully on Firebase, within the free tier | [`main`](https://github.com/shehan-welagedara/Point-of-Sale-System/tree/main) |
| **Enterprise Hotel Edition** (Model 2, this branch) | Medium to large hotels, up to 5-star | POS, guest system (OPERA Cloud-level functions) and ERPNext with HR on MariaDB, in each hotel and in Google Cloud; configured from the same Firebase console | [`enterprise/hotel-suite`](https://github.com/shehan-welagedara/Point-of-Sale-System/tree/enterprise/hotel-suite) (design and build documentation) |

Shared code (`packages/*`) is changed on the Model 1 branch first and merged into this branch regularly.

**Branches**

| Branch | What it is | Deploy from it? |
|---|---|---|
| `main` | The Cloud Restaurant Edition: released and tested. Every release is merged here. | **Yes**: always deploy clients from `main`. |
| `develop` | Work in progress for the next release. It is merged into `main` (through a pull request, after the tests pass) and then matches `main` again. | No |
| `enterprise/hotel-suite` | The Enterprise Hotel Edition: `main` plus the hotel design and build documentation. | Hotel projects only |

## Try it in one minute
```bash
pnpm install
pnpm dev                 # open http://localhost:5173 → "Load the demo restaurant"
```
- The back office opens on a **launchpad**: each module (POS Configuration, Menu, Inventory, Finance, Audit Center, People & Security, Administration…) opens as its own workspace.
- On a phone or tablet: run `pnpm demo` on your PC and open `http://<your-PC-IP>:5173` on the same Wi-Fi.
- POS: **Point of Sale** → pick a workstation → employee number **1001**, PIN **1111** (manager). Others: 1002/2222 cashier, 1006/6666 supervisor, 1007/7777 bartender.
- Finance: **Finance → Overview**. Switch **Acting as** (bottom of the sidebar) between Owner, Accountant and External auditor to see maker–checker approvals and read-only audit access.
- All demo data is fictional sample data: "Spice Lagoon", Colombo. VAT-registered, SSCL not liable.

## What's in the box
| Area | Highlights |
|------|-----------|
| **Licensing & modules** | Editions (Starter, Professional, Enterprise) with add-ons and limits; vendor-signed licence keys bound to the client's Firebase project; modules chosen at installation; launchpad with a separate workspace per module. [Details](docs/15-licensing-and-modules.md) |
| **POS** (terminals and tablets) | PIN sign-in with roles and manager override; tables and covers; dine-in, takeaway and delivery; modifiers; **allergy alerts**; send to kitchen (KOT routing kitchen/bar, backup printers); guest check with **LankaQR**; split payments (cash with change, card approval code, LankaQR, PayHere, USD cash, vouchers, house account, comp); voids with reason codes; discounts; 86 items; X/Z reports; **End of Day** (stock deduction, journal, WhatsApp report) |
| **Sri Lanka compliance** | Service charge → SSCL → VAT order, inclusive or exclusive pricing, **IRD tax invoice format** (Gazette 2481/22) with `YYMMM_W01_n` numbers per workstation, hash-chained immutable invoices, plain invoices for non-VAT businesses |
| **Back office (EMC)** | Menu, categories, modifiers, tenders, discounts, order types, reason codes, tables, outlets and revenue centres, devices and printers, **branding per client** (logo, colours, bill text), **modules on/off per client** |
| **People & Security** | Hotel hierarchy (enterprise → property → revenue centre); employees with property roles, revenue-centre access, cards and employment dates; roles with **levels, limits and "needs approval"**; sign-in by number/card/name + PIN with **lockout**, auto sign-out, **clock in/out**; manager override by a senior employee only; back-office logins. [Details](docs/16-users-access-and-audit.md) |
| **POS look** | Terminal layout with **three themes** (Classic, Modern, Midnight), every colour, size and layout customisable with live preview; **item photos** on buttons |
| **Mobile POS app** | Two phone/tablet app styles, **Bright** and **Indigo**: sign-in with the restaurant's picture, home dashboard, tables, photo menu, cart with steppers, full-screen payment and "payment successful", orders, reports. The administrator picks the style and where it applies (phones, phones and tablets, every screen); each workstation can override. Same privileges, approvals, journal and printing as the terminal |
| **Bill designer** | Administrators choose every element of guest checks and invoices (titles, header, check details, items, totals, payments, QR codes, footer, 80/58 mm) with a live preview; IRD tax invoice particulars stay locked for VAT-registered businesses |
| **Transaction journal** | Every operator action (voids, discounts, overrides, transfers, splits, no-sales, paid in/out, approvals, sign-ins) hash-chained per workstation; on-POS **reports** (daily sales, employee financial, items, open checks, exceptions) |
| **Security and operations** | PINs and cards checked on the server with lockout (also for approvals); secrets unreadable to clients; business creation locked to the deployment owner; verified email for invitations; strict CSP and security headers; offline-tolerant POS writes and offline sign-in; error reporting; device status; one build for every client with update notices and a minimum version; release pipeline with staging, approved waves, backups and data migrations. [Review](docs/21-security-review.md) · [Releases](docs/20-release-and-updates.md) |
| **Quality assurance** | Every save validated against schemas; cross-module **data quality** check; integrity check of invoices, ledger, audit trail and POS journal; unit, rules, server and browser end-to-end tests |
| **Recipes & costing** | Recipes and prep sub-recipes, portion cost, food cost %, gross profit, price at target cost % |
| **Inventory & purchasing** | Stock items with purchase/stock units, locations, **FIFO** lots, recipe-based depletion of every sale, purchase orders (suggested from par levels), goods receipts with input VAT, waste, transfers, production batches, blind stock counts, movements, valuation |
| **Accounting (general ledger)** | ERPNext design on Firestore with an S/4HANA-style universal journal: POS days post automatically; supplier invoices with **3-way match**; customer invoices; payments with open items and FX; **bank reconciliation**; **fixed assets** (SL/WDV); budgets; **period close** and year-end; SLFRS **P&L, balance sheet, cash flow**, TB, GL, VAT/SSCL/WHT; **maker–checker approvals**; gap-free numbering and hash-chained postings, all on the server (Cloud Functions). [Details](docs/13-accounting-and-audit.md) |
| **Audit Center** | Field-level **audit trail of every record** (who, when, before → after) captured server-side and **sealed hourly in a hash chain**; one-click **integrity verification**; numbering gaps; segregation-of-duties review; access review; **SAF-T 2.0** and an auditor Excel package; read-only **Auditor** role |
| **Reports & revenue** | Dashboard, **Daily Revenue, Item-wise, Covers, Sales** (category, hour, order type, payments), checks list, **menu engineering**, monthly target, Excel export, **WhatsApp end-of-day report** (simulated until Meta approval) |
| **CRM** | Customers, visits and spend, loyalty points, tags, business buyers printed on VAT invoices |
| **Excel data feeders** | One workbook for menu, prices, modifiers, stock items, recipes, vendors and customers, with row-level validation on import |
| **Printing** | Print Agent for USB/network ESC/POS printers and the cash drawer; or a phone printing straight to a **Bluetooth** receipt printer (no PC). Bills and kitchen tickets (KOTs) can share one printer |

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
| 14 | [**Feature coverage vs Simphony and S/4HANA**](docs/14-feature-coverage.md) |
| 15 | [**Licensing and modules**](docs/15-licensing-and-modules.md) |
| 16 | [**Users, access control, audit and QA**](docs/16-users-access-and-audit.md) |
| 18 | [**Client deployment manual (A to Z)**](docs/18-deployment-manual.md) (Cloud Restaurant Edition) · client plans: [Noura Kitchen](docs/clients/noura-kitchen.md) |
| 19 | [**User manual and role-based training manuals for clients**](docs/manual/README.md) (Cloud Restaurant Edition; PDFs: `pnpm manual:pdf`) |
| 20 | [**Releases and updates**](docs/20-release-and-updates.md): versions, waves, approvals, backups, migrations, rollback, support levels |
| 21 | [**Security and reliability review**](docs/21-security-review.md) and the go-live security checklist |
| E | [**Enterprise Hotel Edition (this branch)**](docs/enterprise/README.md) |

## Commands
```bash
pnpm dev               # web app (local demo mode unless apps/web/.env.local has a Firebase config)
pnpm demo              # production build served to phones and tablets on your network (http://<your-PC-IP>:5173)
pnpm test              # unit tests (engine, core, ledger, printing, sample data, Excel, print agent, functions)
pnpm test:rules        # Firestore security rules on the emulator (needs Java)
pnpm test:functions    # Cloud Functions end to end on the emulators (needs Java)
pnpm test:e2e          # browser end-to-end in local demo mode (needs Playwright + Chromium)
pnpm test:pairing      # connecting phones with codes, in a browser against the Firebase emulators
pnpm test:contrast     # text colour contrast (WCAG AA) on every POS and back-office screen, all sizes and styles
pnpm test:golive       # go-live rehearsal: a new restaurant from empty to its first day in the books
pnpm test:migrations   # data migrations on the Firestore emulator (needs Java)
pnpm deploy:setup      # vendor PC: check tools and sign-in, licence key, register a client (deployment manual F)
pnpm deploy:check      # vendor PC: can Node.js reach Google and Firebase? (antivirus, proxy, firewall)
pnpm deploy:access --project ID  # check and fix a client project's permissions for the server functions
pnpm release:version 1.1.0       # start a release: version + CHANGELOG entry (then tag vX.Y.Z and push)
pnpm release:deploy --target …   # deploy: staging, wave:N or client ids (backup → indexes → migrations → rules/functions → hosting); needs only `firebase login`
pnpm manual:screenshots  # refresh the manual screenshots from the demo restaurant
pnpm manual:pdf -- --client "Name"  # user and training manuals as A4 PDFs in manual-pdf/
pnpm licence keygen    # vendor: create your licence signing key (once)
pnpm licence issue …   # vendor: issue a client licence key (see docs/15)
pnpm emulators         # local Firebase Auth + Firestore + Functions
pnpm build             # production build of the web app
pnpm build:functions   # build the Cloud Functions bundle
pnpm templates         # regenerate templates/*.xlsx
pnpm agent             # run the Print Agent (apps/print-agent/.env)
```

## Repository layout
`apps/web` (back office + POS) · `apps/functions` (ledger, licence, PIN checks, phone pairing, audit) · `apps/print-agent` · `packages/{engine,core,ledger,printing,sample-data,excel}` · `firebase/` (rules, indexes, rules tests) · `tools/` (release, licence, manuals) · `release/` (clients and policy) · `templates/` (Excel feeders) · `docs/`

---

POS Suite © 2026 Polymath Tech. All rights reserved.
