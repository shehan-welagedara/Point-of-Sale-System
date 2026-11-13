# 13 — Accounting (general ledger) and audit

The Accounting module is a full general ledger. It is built **natively on Firestore** and follows **ERPNext's accounting design**: vouchers post to a general ledger, with fiscal years, cost centres and open items. Its ledger table follows the idea of **SAP S/4HANA's universal journal**: one line table that carries every dimension. It shares the database with the POS, inventory and CRM. There is no second system to sync.

> **Why not run ERPNext itself?** ERPNext runs on the Frappe framework with MariaDB and needs its own server. The requirement was for *the whole database to be in Firebase*. So this module re-implements ERPNext's proven data model and posting rules in TypeScript on Firestore. No ERPNext code is copied (ERPNext is GPL-licensed).

## 1. What's included, compared with S/4HANA Finance

| S/4HANA Finance capability | This system | Where |
|---|---|---|
| Universal journal (ACDOCA): one line table with every dimension | `ledger` collection: account, cost centre, outlet, party, document, period, currency and FX amounts, preparer and time on every line | Finance → Financial statements → General ledger |
| Document principle, gap-free numbering per type and year | Number given **at posting** inside the same transaction (`JV-202627-00001`, `PINV-…`, `SINV-…`, `PAY-…`, `POS-…`, `DEP-…`, `ADS-…`, `REV-…`, `PCV-…`) | All documents |
| No deletion: reversal with reason | Posted documents can't be edited or deleted; **Reverse** posts a mirror document with a mandatory reason | Document drawer |
| Workflow / maker–checker | Draft → Submit → Approve/Return. Approver ≠ preparer, enforced on the server. Owner-set thresholds per document type | Finance → Approvals |
| Accounts payable with 3-way match (MIRO) | Supplier invoice from goods receipts, matched to PO and GRN with qty/price tolerances; exceptions go to approval; price variance posted | Finance → Payables |
| GR/IR clearing | **Stock received but not billed** (2010): GRN credits it, the invoice clears it | Payables, Overview |
| Accounts receivable | Customer invoices (corporate, catering, house accounts) with VAT; receipts with allocation; advances | Finance → Receivables |
| Open-item management, aging | Outstanding per invoice maintained at posting; aging buckets; overdue on the cockpit | Payables/Receivables → Aging |
| Foreign currency, realised FX | Documents in any currency with rate; FX gain/loss posted automatically on settlement | Journals, Payments, Settings → Exchange rates |
| Bank accounting / reconciliation | CSV statement import (Sri Lankan bank formats), auto-match suggestions (amount, date, reference), manual match, reconciliation statement export | Finance → Bank reconciliation |
| Asset accounting | Asset register, straight-line or WDV (LKAS 16), monthly run with catch-up, schedule, disposal with gain/loss | Finance → Fixed assets |
| Cost centre accounting | Cost centre on every line; statements filter by cost centre; outlets map to cost centres | Statements, Settings |
| Budgeting / plan vs actual | Monthly GL budgets by account and cost centre; variance and % used | Finance → Budgets |
| Period-end close, posting periods | Monthly periods open/closed (no posting into closed months); closing checklist; owner-only reopen with reason; year-end closing to retained earnings | Finance → Period close |
| Financial statements | Trial balance (opening/movement/closing, tree roll-up), **SLFRS** P&L by function, statement of financial position, indirect cash flow (self-reconciling), GL, VAT/SSCL/WHT working | Finance → Financial statements |
| Integration with logistics | POS days (sales, tenders, taxes, FIFO cost of sales, waste, receipts) post automatically at End of Day; late sales post as deltas | POS → End of Day, Finance → Overview |
| Audit trail & GRC | Field-level change log of the whole system, sealed hash chains, integrity verification, SoD rules, access review | Assurance → Audit Center |
| Audit data export | **SAF-T (OECD 2.0) XML** and an auditor Excel package | Audit Center → Auditor exports |

**Not in this release:**
- Multi-company consolidation and intercompany. Each client company is its own tenant; groups consolidate in Excel.
- IFRS 16 lease accounting, deferred tax and cost allocation cycles.
- Dunning letters, cash forecasting and payroll. Payroll is posted as a journal.
- Attaching scanned documents to vouchers (needs Cloud Storage).

These can be added on the same ledger.

## 2. Data model

| Collection (under `tenants/{id}/`) | Contents | Who writes |
|---|---|---|
| `accounts` | Chart of accounts tree (groups and ledgers, root type, account type, statement line, frozen) | Books roles (no delete) |
| `vouchers` | All documents: journal, purchaseInvoice, salesInvoice, payment, posDay, depreciation, assetDisposal, periodClose, reversal | Preparer can edit **only own drafts**; everything after that happens on the server |
| `ledger` | Universal journal lines (immutable) | **Server only** |
| `accountBalances` | Movement per period × account × cost centre (makes reports cheap) | **Server only** |
| `numberSeries`, `ledgerHead` | Counters and the hash-chain head | **Server only** |
| `fiscalYears` | Years and monthly periods with status | **Server only** |
| `costCenters`, `glBudgets`, `exchangeRates`, `assets`, `bankStatements`, `bankRecons` | Master and supporting data | Books roles (asset depreciation fields: server only) |
| `auditLog/{tenantId}/events`, `…/seals` | Audit trail, outside the tenant tree | **Server only**; readable by owner, admin and auditor |

A posted document stores:
- the posting lines it was posted with;
- its period and number;
- who prepared, submitted, approved and posted it, and when;
- `prevHash` and `hash`. These chain every posted document of the company.

## 3. How a document posts

1. **Draft.** The preparer creates it in the browser. Security rules allow only their own drafts, and no number or hash.
2. **Submit.** This calls the `ledgerApi` Cloud Function, which runs in a Firestore transaction:
   - validates accounts (exist, not group, not frozen) and that the period is open;
   - builds the lines;
   - runs the 3-way match;
   - decides whether approval is needed, using the thresholds or match exceptions.
3. **Approve.** A different person approves. The server refuses if the approver is the preparer or submitter.
4. **Post.** In the same transaction the server:
   - takes the next number;
   - writes the ledger lines;
   - increments the balances;
   - updates open items, asset values and so on;
   - computes `hash = SHA-256(prevHash + number, type, date, lines and total)`;
   - moves the chain head.

   Debits must equal credits to the cent, in base currency.

Local demo mode runs **the same code** against an in-browser store, so the demo behaves exactly like production.

## 4. Controls built in

| Control | Implementation |
|---|---|
| Server-side posting | Only the Cloud Function writes ledger, balances, numbers and periods. Rules deny clients. |
| Maker–checker | Manual journals (default: all of them) and payments of Rs 50,000 or more need a second person. The thresholds can be changed only by the owner or an admin, which the rules enforce. |
| Segregation of duties | Approver ≠ preparer/submitter. SoD rule set SOD-01…04 with a conflict report. The `auditor` role is read-only. |
| 3-way match | Quantity and price against GRN and PO, with tolerances (default: qty 0%, price 2%). Exceptions need approval. |
| Period locking | Postings into closed periods are refused. Reopening needs owner/admin and a reason, which is audited. |
| Immutability | No edit or delete of posted documents. Reversal only, with a reason. |
| Completeness | Gap-free numbers for documents and IRD invoices. A gap report covers both. |
| Accuracy | Each document balances. The ledger re-sums to the stored balances during the integrity check. |

## 5. Audit trail and integrity

- **Capture.** A Firestore trigger (`auditTrail`) records **every create, update and delete of every business record in the tenant** (menu prices, discounts, staff, roles, stock, settings, vouchers…). It runs on the server, so no client can skip it. The record is an event with:
  - the actor;
  - the time;
  - the changed fields with before and after values;
  - a SHA-256 hash.

  The actor comes from Firebase's verified auth context, or from the write's `updatedBy` stamp. The stamp is only used when that write changed `updatedAt`.
- **Sealing.** Every hour `auditSealer` puts the new events into a **seal**. The seal lists the event ids and hashes their hashes together with the previous seal. This makes an unbroken chain, and owners and auditors can also seal on demand.
- **Verification** (Audit Center → Integrity, run on the server):
  - re-hashes every event and seal;
  - walks the voucher hash chain;
  - walks each workstation's invoice chain;
  - re-sums ledger lines to balances;
  - checks every document balances;
  - looks for numbering gaps;
  - looks for self-approved documents.

  The emulator test shows that an edit made **directly in the database** (bypassing the app, as an administrator could) is detected.
- **Exports**:
  - **SAF-T 2.0** XML;
  - an Excel audit package for journal-entry testing (ISA 240) and data analytics. It contains every ledger line with preparer and timestamp, the document register with approvers and hashes, the trial balance, the audit trail with before and after values, users and roles, and numbering gaps.

### What "ready for global audits" means here

The system gives auditors the evidence they ask for under ISA 230/240/315/330 and SOX-style IT general controls:
- complete, unaltered and traceable records;
- access controls;
- segregation of duties;
- change logs;
- standard data exports.

Audit readiness also depends on how the business operates it:

1. **Keep a copy outside Firebase.** Export the audit package and SAF-T monthly and keep them where the Firebase project owner can't change them, such as the auditor's portal or a write-once archive. Hashes detect tampering; an external copy proves the original.
2. **Review access quarterly.** Use Audit Center → Access review, signed off by the owner.
3. **Close every month.** Run the checklist, then close, then run the integrity check.
4. **Protect the Google account** that owns the Firebase project: use 2-step verification and give no shared logins. Whoever owns the project can delete data. The hashes make that visible but cannot prevent it.
5. **Control software changes.** Use git history, pull-request review and tagged releases per client deployment. This is the ITGC "change management" evidence.
6. **Keep backups.** Point-in-time recovery and scheduled backups are paid Firestore features. On the free tier, the monthly exports above are the backup.

## 6. Running it

- **Local demo:**
  1. Run `pnpm dev` and choose **Try a demo business → Load Spice Lagoon**. The books are created through the ledger itself: opening balances, assets and depreciation, rent and payroll, POS days, supplier invoices (one priced 5% above its PO, so it waits for approval), payments, a corporate invoice and receipt, budgets.
  2. Use the **Acting as** switch at the bottom of the sidebar (Owner, Accountant or External auditor) to see maker–checker and read-only audit access.
- **Firebase:** deploy rules, indexes, hosting and functions with the release tool (`pnpm release:deploy --target CLIENT-ID`, see the [deployment manual](18-deployment-manual.md)). The functions run in the Firestore database's region (asia-south1). Cost settings are in [10-firebase-free-tier.md](10-firebase-free-tier.md).

## 7. Tests

| Suite | Covers |
|---|---|
| `packages/ledger` (19 tests) | posting rules, 3-way match, FX, depreciation and disposal, period locks, year-end close, reversals, numbering, hash chains, statements balancing, cash-flow reconciliation, bank matching, audit trail sealing and tamper detection, invoice chains, SoD, SAF-T |
| `packages/sample-data` | the demo books verify clean (ledger, invoice chains), the trial balance and balance sheet balance |
| `firebase/test` (`pnpm test:rules`) | clients can't write ledger, balances, numbers, periods or audit log; drafts only by their preparer; thresholds only by the owner; the auditor is read-only |
| `apps/functions` (`pnpm test:functions`) | on the emulators: maker–checker through the callable, audit capture → seal → verify, detection of a direct database edit, role refusal |
