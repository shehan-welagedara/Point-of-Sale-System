# 05 — ERPNext, HR and payroll

## 1. Stack

- **ERPNext** (accounting, buying, stock, assets) and **Frappe HR** (HR and payroll), on the Frappe framework, with **MariaDB**.
- Use the current ERPNext major version with the MariaDB version it supports (ERPNext v15 requires MariaDB 10.6 or later). Upgrade once a year after testing.
- Deployed with the official Frappe Docker images (`frappe_docker`), so the same build runs in the hotel and in Google Cloud.
- **ERPNext itself is not modified.** All hotel-specific behaviour lives in our own Frappe app, `hotel_suite_connector`. This keeps upgrades simple and avoids licence questions: ERPNext is GPL v3, and changes to ERPNext itself would have to be shared under the same licence if distributed. Confirm the licensing position with a lawyer before selling.

## 2. Hosting options (client's choice)

| | **Option 1: in the hotel** | **Option 2: Google Cloud** |
|---|---|---|
| Where ERPNext runs | On the hotel server pair (containers) | Compute Engine VM (or GKE for groups) in the Mumbai region |
| Primary `erp` database | Hotel MariaDB | Cloud MariaDB (self-managed: Cloud SQL doesn't offer MariaDB) |
| Replica | Cloud MariaDB (async replication over the VPN) | Optional replica in the hotel for local reporting |
| Works without internet | Yes, for staff in the hotel | No (finance and HR work is rarely urgent; POS and front desk are unaffected either way) |
| Access for head office and accountants | Through the VPN or a published, protected URL | Directly, protected by Identity-Aware Proxy / SSO |
| Hardware | Larger hotel servers (more RAM and disk) | Smaller hotel servers; monthly cloud cost instead |
| Upgrades and maintenance | On site or remote through the VPN | Central; easier for groups |
| Best for | Single hotels with weak connectivity or a policy of keeping data on site | Groups, head-office accounting, clients who prefer operating cost over hardware |

Both options use the same connector app, configuration and backups ([07](07-backup-dr.md)).

## 3. Modules used

| Area | ERPNext / Frappe HR features | Hotel use |
|---|---|---|
| Accounting | Multi-company, chart of accounts, cost centres, accounting dimensions, journal entries, payment entries, bank reconciliation, budgets, period closing, financial statements | **USALI** chart of accounts and departments (Rooms, F&B, Other operated departments, Undistributed expenses…) for 5-star reporting; one company per hotel, consolidated for groups |
| Receivables | Sales invoices, customers, payment terms, dunning | City ledger handover from the guest system, banquet deposits |
| Buying | Material requests, supplier quotations, purchase orders with approvals, purchase receipts, purchase invoices | Central purchasing, approval matrix by value and department |
| Stock | Multi-warehouse (main stores, kitchen, bars, minibar, housekeeping, engineering), stock entries, transfers, reconciliations, valuation | Outlet requisitions, transfers, recipe-based consumption from the POS, beverage control |
| Assets | Asset register, depreciation, maintenance | FF&E, kitchen equipment, vehicles |
| HR | Employee lifecycle, onboarding, shift types and assignments, attendance, leave, appraisals, expense claims | From POS time cards and biometric devices |
| Payroll | Salary components and structures, payroll entries, payslips, bank file | Sri Lanka payroll (§5) |

## 4. Connector app `hotel_suite_connector` (Python, Frappe app)

| Part | Purpose |
|---|---|
| Doctypes | `Hotel Property` (maps to a company and cost centres), `Transaction Code Map` (POS and guest-system codes → account, cost centre, tax template), `Integration Log` (every message with status and payload hash), `Sync Origin` (loop prevention) |
| API endpoints | `post_pos_day`, `post_night_audit`, `post_city_ledger`, `post_stock_consumption`, `post_time_cards`: idempotent by message id, validated, in one database transaction each |
| Webhooks out | Supplier, item, employee and account changes → cloud function → Firestore mirror (console view) |
| Reports | Revenue reconciliation (POS and guest system totals vs ledger per day), interface exceptions |

**Postings from the hotel systems:**

| Source | ERPNext document | When |
|---|---|---|
| POS End of Day (per outlet) | Sales Invoice (summary per outlet, tax lines), Payment Entries per tender, or a Journal Entry where preferred | Nightly, with delta postings for late checks |
| Recipe consumption | Stock Entry (Material Issue) from the outlet's warehouse | Nightly |
| Guest system night audit | Journal Entry of revenue by transaction code and department, taxes, guest-ledger and deposit movements | Nightly |
| City ledger transfers | Sales Invoice to the company or travel agent customer | At check-out |
| Time cards | Attendance / Employee Checkin | Daily |

## 5. Sri Lanka payroll (to configure and verify with a payroll specialist)

- EPF: employee 8%, employer 12%. ETF: employer 3%.
- APIT (advance personal income tax) using the current tax tables.
- **Service charge distribution** to staff. Hotels distribute collected service charge to employees. Configure the statutory minimum share and the hotel's allocation rules, by points or by days worked. The POS and guest system provide the collected amount per month.
- Overtime, night shift and holiday pay from shift types and attendance; bank transfer file for the hotel's bank; payslips.

## 6. How managers configure ERP and HR

As described in [02 §3](02-firebase-control-plane.md):
- **Day-to-day masters** are configured in the console HR and Finance workspaces, through the ERPNext API. These are items, suppliers, warehouses, departments, employees, leave and holidays.
- **Specialist setup** opens in ERPNext's own screens with single sign-on. This covers the chart of accounts, tax templates, salary structures and workflows.

Either way the console shows the current values and the audit trail.
