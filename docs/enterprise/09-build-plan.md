# 09 — Build plan

## 1. Branches

| Branch | Edition | Rule |
|---|---|---|
| `claude/vigilant-allen-7sp0m4` → `main` once PR #1 is merged | Model 1: Cloud Restaurant Edition | Shared packages (`packages/*`) are changed here first |
| `enterprise/hotel-suite` (this branch) | Model 2: Enterprise Hotel Edition | Started from Model 1. **Merges Model 1 regularly** (at least every release) to receive shared fixes. Enterprise-only folders are never merged back. |

Keeping the shared packages identical in both branches is what makes two editions affordable to maintain. If they drift, every tax change or bug fix must be done twice. A later option is to bring both editions into `main` behind an edition setting. The folder layout below is designed to allow that.

## 2. Repository layout on this branch

```
apps/
  web/                    console + POS screens (shared with Model 1; new workspaces for guest system, HR, ERP)
  front-office/           front desk, housekeeping and cashiering screens (new, console style)
  functions/              Firebase functions (Model 1) + config distribution, ERP mirror, alerts
  print-agent/            (Model 1)
services/
  property-pos/           hotel POS service (Node.js, MariaDB)
  property-pms/           hotel guest service (Node.js, MariaDB)
  sync-agent/             Firestore ⇄ MariaDB configuration and live figures
  integration-hub/        cloud workers: Pub/Sub, central reservations, BigQuery feed
packages/
  engine, core, printing, excel, ledger, sample-data   (shared with Model 1)
  db/                     MariaDB access layer, DocStore implementation, migrations runner
  sync-map/               Firestore collection ↔ MariaDB table mappings
  pms-core/               guest-system domain rules (rates, availability, folios, night audit)
erpnext-apps/
  hotel_suite_connector/  Frappe app (Python)
db/migrations/{pos,pms}/  versioned SQL migrations
deploy/
  property/               containers for the hotel servers (compose / k3s), install scripts
  gcp/                    Terraform for client projects
  dev/                    one-command local stack: MariaDB, ERPNext, services, Firebase emulators
docs/enterprise/          this documentation
```

## 3. Phases

| Phase | Deliverables | Done when |
|---|---|---|
| **0. Foundations** | Layout above; `deploy/dev` local stack (MariaDB, ERPNext + Frappe HR, Firebase emulators); CI for TypeScript and Python; `packages/db` with migrations; MariaDB security baseline in the dev stack; sync-agent skeleton; change-package format | A config change in the local console appears in local MariaDB with an acknowledgement |
| **1. POS on MariaDB** | `property-pos` service with all Model 1 POS functions; `pos` schema; POS screens on `PosApiStore`; offline (no-internet) operation; journal and invoice chains in SQL; live figures to Firestore; cloud replica | Model 1 browser end-to-end tests pass against the hotel service, with the internet cut mid-test |
| **2. Guest system core** | `property-pms` + `apps/front-office`: profiles, rates and inventory, reservations, front desk, rooms and housekeeping, cashiering, night audit; room charge from the POS; IRD invoices | A full stay (book → check in → room charge → check out → night audit) passes end-to-end, offline included |
| **3. ERPNext, HR and payroll** | `hotel_suite_connector`; USALI chart of accounts template; POS, night audit and city ledger postings; stock consumption; Sri Lanka payroll with service charge distribution; time cards → attendance; console HR/Finance workspaces; option 1 and option 2 deployments | A month of demo hotel data closes in ERPNext, reconciled to POS and guest-system totals; payroll run matches a hand calculation |
| **4. Enterprise operations** | Hotel HA pair with failover; backups to Cloud Storage with locks and drills; monitoring; security hardening; Terraform for client projects; staged releases | Failover, restore and disaster-recovery drills pass; external penetration test with no high findings |
| **5. Interfaces and pilot** | Integrated card terminals (bank partner), door locks, PBX, channel manager and booking engine, kitchen display; banquets; pilot hotel | Pilot hotel runs live for 30 days with agreed service levels |

Phases 1 and 2 can overlap once phase 0 is done. Phase 3 can start after the posting formats are fixed in phase 1.

## 4. Testing

The same layers as Model 1 (see [16](../16-users-access-and-audit.md)), plus:
- **SQL integration tests** against a real MariaDB in CI (containers), including the privilege grants: the application account must fail to update or delete journal rows.
- **Sync tests:** every validated console collection has a mapping; apply, version-conflict and replay tests.
- **Resilience tests:** cut the internet, stop the primary server, kill the sync agent mid-change, restore from backup; checks and folios must balance afterwards.
- **Load tests:** 10,000 checks and 1,000 room nights per day per hotel, peak of 200 transactions per minute.
- **ERP reconciliation tests:** POS + guest system totals = ledger, per day and department.

## 5. Partners and outside work

| Need | Who |
|---|---|
| Card terminals integrated with the POS | Sri Lankan acquiring bank (SDK and certification) |
| Door locks / key encoders | Lock vendor used by the hotel (ASSA ABLOY Vingcard, dormakaba, Salto…) |
| Channel manager / booking engine | A channel manager with a Sri Lankan presence, or direct OTA connections later |
| Security | External penetration test; PCI DSS self-assessment with the bank |
| Payroll rules | Sri Lankan payroll specialist to verify EPF/ETF/APIT and service charge distribution |
| Legal | ERPNext licence position; client data-processing agreement (PDPA) |
