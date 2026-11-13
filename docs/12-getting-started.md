# 12 — Getting started, demos and client deployments

## 1. Run it locally (no cloud, zero cost)
```bash
pnpm install
pnpm dev          # http://localhost:5173
```
With no Firebase config, the app runs in **local demo mode**: data is kept in this browser.
- Open **Try a demo business** and choose **Load Spice Lagoon** to get "Spice Lagoon", a fictional Colombo restaurant. Everything in it is sample data.
- The demo is **VAT-registered and not SSCL-liable**.
- POS staff PINs:

| Staff | Role | PIN |
|-------|------|-----|
| Kasun Perera | Manager | 1111 |
| Nimali Fernando | Cashier | 2222 |
| Tharindu Silva | Server | 3333 |
| Fathima Rizwan | Server | 4444 |
| Suresh Kumar | Kitchen | 5555 |
| Owner (demo) | Owner | 9999 |

Other run modes:
- `pnpm emulators` starts the Firebase Emulator Suite (Auth + Firestore with the real security rules).
- Then set `VITE_USE_EMULATORS=true` plus any demo config in `apps/web/.env.local`, and the app runs against the emulators.

## 2. Your demo environment (your Firebase project)
Your own Firebase project for demonstrations and for testing each release before clients get it (the **staging** project in [20](20-release-and-updates.md)).

1. Create it like a client's project: [deployment manual](18-deployment-manual.md) B to D (Blaze plan with a budget alert, Firestore in asia-south1, Email/Password, web app registered).
2. Put its project ID in `release/clients.json` under `staging`.
3. Deploy, with the same tool as for clients (it builds the app first):
   ```bash
   pnpm exec firebase login
   pnpm release:deploy --target staging
   ```
4. Open `https://PROJECT-ID.web.app`, create your account, and open **Try a demo business** and choose **Load Spice Lagoon** (or **Load Noura Kitchen**).

The web app reads the project's Firebase settings from Hosting at run time, so the same build works in every project: don't put a Firebase config in `apps/web/.env.local` for a build you deploy (the release tool refuses one). `.env.local` is only for running `pnpm dev` against a cloud project.

Each business you create is a separate **tenant** with its own data, logins and modules. The business switcher (sidebar) appears when your login belongs to several.

## 3. Feeding a real restaurant's data (Excel)
1. Back office → *Setup → Excel import & export* → **Download blank template**. Or use `templates/data-feeder-sample.xlsx` as a worked example.
2. Fill in these sheets:
   - **Categories**, **Menu Items** (code, price, KOT route, modifier groups, allergens, Sinhala/Tamil names)
   - **Modifier Groups / Options**
   - **Stock Items** (units, purchase unit and conversion, cost, vendor, par level)
   - **Recipes** (one row per ingredient; prep sub-recipes too)
   - **Vendors**, **Customers**
3. **Import**. The system checks every row and lists errors and warnings with row numbers before anything is saved. Re-importing updates by code.
4. Check costs under *Menu → Recipes & costing* (food cost %, gross profit, price at target cost %), then *Save costs to menu items*.
5. Opening stock: post a **goods receipt** per supplier (or one "opening stock" receipt), or use a **stock count**.

## 4. Before a client goes live
- [ ] *Setup → Business & tax*:
  - Registered name, address, 9-digit **TIN**, VAT-registered and SSCL-liable switches, service charge % and order types.
  - Inclusive or exclusive pricing.
  - Confirm everything with the client's accountant ([06](06-sri-lanka-compliance.md)).
- [ ] *Setup → Branding*: logo, colours, bill header and footer.
- [ ] *Administration → Licence & modules*: activate the client's licence key (see [15](15-licensing-and-modules.md)), then switch on what they bought.
- [ ] *People & Security*: sign-in policy (method, lockout, auto sign-out, clock in), roles with levels and limits, employees with properties and revenue centres.
- [ ] *POS Configuration → POS themes*: choose Classic, Modern or Midnight and adjust colours; add item photos under Menu Management if wanted.
- [ ] *Setup → Devices & printers*:
  - One workstation per POS device. Its code appears in invoice numbers.
  - Printers, with a Print Agent installed ([11](11-hardware-and-printing.md)).
- [ ] *People*: POS staff with PINs, roles and privileges, back-office logins (owner, managers, accountant, storekeeper).
- [ ] *Setup → Integrations*: PayHere merchant ID, LankaQR merchant ID from the bank, and WhatsApp numbers. Keep them in **mock** until the accounts are approved.
- [ ] *Finance* (if the Accounting module is on):
  - *Finance settings*: account mapping, approval limits (owner), cost centres.
  - Opening balances as a journal on the go-live date.
  - Register fixed assets.
  - Invite the accountant (role **Accountant**) and the external auditor (role **Auditor**, read-only).
- [ ] Do a test day: sell, void, discount, split payment, End of Day. Check the Z report, the stock, and the POS day in *Finance → All documents*. Then run *Audit Center → Integrity check*.

## 5. Deploying to a client's own Firebase project
Each client gets their own Firebase project, owned and billed by them, built from the **same `main` branch**. The [deployment manual](18-deployment-manual.md) takes you through it; in short:
```bash
pnpm exec firebase login                       # once per PC
pnpm deploy:setup                              # registers the client in release/clients.json, licence public key
pnpm release:deploy --target CLIENT-ID --dry-run
pnpm release:deploy --target CLIENT-ID         # first deploy: permissions, web address, functions, hosting
```
- Create the owner's account on the deployed site and create the business: empty, or import their Excel data feeder.
- Configuration that differs per client lives in **their data**: settings, modules, branding and menus. Do not keep a separate code branch per client. Client-specific code (rare) goes behind a module flag or into an extension package on `main`, so every client keeps receiving fixes ([01 §4](01-architecture.md)).
- Updates: [20 — Releases and updates](20-release-and-updates.md).

## 6. Repository map
| Path | What |
|------|------|
| `apps/web` | Back office (EMC), POS (terminals and tablets), dashboards and reports |
| `apps/print-agent` | Print Agent for USB/network printers and the cash drawer |
| `packages/engine` | Money, Sri Lanka service charge/SSCL/VAT, tenders, IRD invoice numbers |
| `packages/core` | Domain model, modules, privileges, costing, FIFO inventory, checks, reports, POS day journal, integration templates |
| `packages/ledger` | General ledger: posting, approvals, assets, bank matching, statements, audit trail, integrity checks, SAF-T |
| `apps/functions` | Cloud Functions: ledger API, licence activation, PIN checks, phone pairing, audit trail triggers, hourly sealing |
| `apps/console`, `apps/console-functions` | Polymath Console: Polymath Tech's central management of clients, licences, subscriptions, health and updates ([22](22-polymath-console.md)) |
| `tools/console` | Console setup, deploy and tests |
| `tools/release` | Release tools: client setup, deploy, permissions check, backups, data migrations, network check |
| `tools/licence` | Vendor licence keys (`pnpm licence`) |
| `tools/manual` | User and training manuals as PDFs |
| `packages/printing` | Bill, KOT and report layouts; ESC/POS and text renderers |
| `packages/sample-data` | The Sri Lankan demo restaurant |
| `packages/excel` | Excel data feeder (template, validated import, export) and report exports |
| `firebase/` | Firestore security rules, indexes, rules tests |
| `templates/` | Ready-made Excel data feeders (sample and blank) |

## 7. Checks
```bash
pnpm test         # unit tests for every package
pnpm test:rules   # security rules on the Firestore emulator (needs Java)
pnpm test:functions  # Cloud Functions end to end on the emulators (needs Java)
pnpm test:e2e        # browser end-to-end (needs Playwright + Chromium)
pnpm test:pairing    # connecting phones with codes, against the Firebase emulators
pnpm test:contrast   # text colour contrast (WCAG AA) on every screen, all sizes and styles
pnpm test:golive     # go-live rehearsal from an empty business (phone, Bluetooth printer, books)
pnpm test:migrations # data migrations on the Firestore emulator (needs Java)
pnpm test:console    # Polymath Console and a client's check-in on the emulators, and every console screen
pnpm typecheck
pnpm build
```
