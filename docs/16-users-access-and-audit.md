# 16 — Users, access control, audit and quality assurance

## 1. Hierarchy (built for medium to large hotels)

The model follows Oracle Simphony's enterprise structure, combined with SAP-style business roles in the back office:

```
Enterprise (the business / hotel group)
 └─ Property (each hotel or outlet)            → properties
     └─ Revenue centre (restaurant, bar, room service, banquets) → revenueCenters
         └─ Workstation (terminal or tablet)   → workstations
```

There are **two kinds of user**, as in Simphony:

| | POS employees | Back-office users |
|---|---|---|
| Who | Cashiers, stewards, bartenders, captains, managers | Owners, administrators, managers, accountants, storekeepers, auditors |
| Sign-in | Employee number, card or name, then PIN, at a workstation | Email and password (Firebase Auth), on any browser |
| Rights | **Role per property** with privileges, limits and a level | **Member role** (owner, admin, manager, accountant, storekeeper, auditor, viewer, terminal) enforced by the security rules |
| Where | Properties and **revenue centres** they are set up for (operator records) | The whole business; an auditor is read-only |

One person can be both (linked by `backOfficeUid`).

## 2. POS roles, levels and limits

- **Privileges** are grouped as in Simphony: sign-in and time, checks, items and prices, discounts, payments, cash, reports and manager. Each role holds a set.
- **"Needs approval"**: a role can hold a privilege that still requires a second person every time. An example is a cashier's reprint or paid-out.
- **Limits**, per role: maximum discount %, maximum single void, maximum price change %, maximum paid-out and maximum refund.
- **Levels**: 1 is the most senior.

**Manager approval** works like this. When someone lacks a privilege, lacks the limit, or holds a privilege that needs approval, a second employee swipes a card or enters a PIN. That person must:
- hold the privilege and "manager override";
- have a role at the same level or more senior;
- have a limit that covers the amount;
- be a different person from the one asking.

Both names are written to the journal.

**Default roles:**

| Role | Level |
|---|---|
| Owner / GM | 1 |
| Outlet manager | 10 |
| Supervisor / captain | 20 |
| Cashier | 40 |
| Server, bartender | 50 |
| Kitchen | 70 |
| Trainee | 90 |

Change them under **People & Security → Roles & privileges**.

## 3. Sign-in control

- **Method:** employee number + PIN, card swipe, or tap-name, set in People & Security → Sign-in policy.
- **Who can sign in:** only active employees within their employment dates, set up for the property, with a role that may sign in.
- **Revenue centre:** chosen from the workstation's allowed revenue centres that the employee works in.
- **PINs:**
  - salted hashes only;
  - easy PINs are refused (1111, 1234, …);
  - wrong PINs are counted;
  - at the limit (default 5) the employee is **locked** until a manager unlocks them.
- **Sessions:** automatic sign-out after inactivity (default 300 s, set per property or per workstation).
- **Clock in:** optional "must clock in before working". Time cards record each shift.

## 4. Two audit trails

| | System audit trail | Transaction journal (POS) |
|---|---|---|
| What | Every create, update and delete of every business record (menu, prices, staff, roles, settings, stock, vouchers…), with before and after values | Every operator action at a workstation: sign-ins and failed PINs, lockouts, checks begun, sent, printed, paid and closed, voids, discounts, price overrides, transfers, splits, no-sales, paid in/out, reprints, 86, approvals, reports, End of Day |
| Captured by | A Cloud Functions trigger (server-side; clients can't skip it) | The POS, append-only (rules forbid edits and deletes) |
| Tamper evidence | Events sealed hourly in a hash chain | Each workstation's events form a hash chain |
| Where to look | Audit Center → System audit trail | Audit Center → POS transaction journal and Exceptions; on the POS: Functions → Transaction journal |

The **integrity check** (Audit Center → Integrity) verifies both chains as well as the invoice chains and the ledger.

## 5. Quality assurance and data validation

| Layer | What it does | Where |
|---|---|---|
| Schemas | Types, ranges and formats for every master-data collection (menu, modifiers, discounts, tenders, organisation, devices, people, roles, stock, recipes, vendors, purchasing, customers, accounts). Every full save is validated before it is written. | `packages/core/src/validation.ts`, `withValidation` |
| Data health | Cross-module checks: broken references, duplicate codes, cards and employee numbers, circular prep recipes, workstations in another property's revenue centre, unmapped ledger accounts | Audit Center → Data quality; also in the test suite |
| Security rules | Who may write what; licence fields server-only; journals append-only; closed checks and invoices immutable | `firebase/firestore.rules` (17 tests) |
| Unit and integration tests | Tax engine, POS, inventory, ledger, audit, licensing, access control, journal, validation, sample data | `pnpm test` |
| Server tests | Ledger, audit sealing and tamper detection, licence activation, on the Firebase emulators | `pnpm test:functions` |
| Browser end-to-end | Launchpad and workspaces, trial balance, POS sign-in with wrong PIN, revenue centres, void needing approval, self-approval refused, split check, exception report, integrity check, data quality, licence activation, screens fitting every size, app styles, bill layout, accounting workbook and bill photos, Bluetooth printing with Send KOT and REPRINT on one printer, the PC and tablet app layout, no browser errors | `pnpm test:e2e` |
| Phones over the internet | Connecting a phone with a one-time code, code reuse refused, device list, removing a phone locks it out (against the emulators) | `pnpm test:pairing` |
| Colour and visibility | Every visible text on the POS (Bright and Indigo; phone, tablet portrait and landscape, PC) and the back office (light and dark; PC and phone) against its real background: WCAG AA 4.5:1, 3:1 for large text | `pnpm test:contrast` |
| Go-live rehearsal | A new business from empty, as on the day: modules, not VAT/SSCL registered, menu, staff with PIN, a phone with a Bluetooth printer, Send KOT, reprint, standard bill and drawer, X report, POS day posting, finance settings, accounting workbook import, trial balance amounts, audit and data quality | `pnpm test:golive` |

The demo data passes every schema and cross-module check with **zero findings**. Real client data is checked the same way once imported.
