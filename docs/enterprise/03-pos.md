# 03 — POS on MariaDB (Oracle Simphony-level)

## 1. Shape (as in Simphony)

| Simphony concept | Model 2 equivalent |
|---|---|
| EMC (enterprise configuration, cloud) | Firebase console ([02](02-firebase-control-plane.md)) |
| Service host / CAPS on property (check and posting service; keeps the POS running offline) | **Property POS service** on the hotel server, with the `pos` MariaDB database |
| Workstations (Windows terminals, tablets, handhelds) | Workstation clients: the Model 1 POS screens, installed as a web app or wrapped as a desktop app, talking to the property POS service |
| KDS controller | KDS service in the property POS service; screens are browsers |
| Enterprise reporting | Cloud `pos` replica + BigQuery + Firebase live figures |

## 2. Property POS service

- Node.js/TypeScript service, packaged as a container, running on both hotel servers (active/standby).
- APIs:
  - REST for commands: begin check, add items, send, pay, close, void, transfer, split;
  - WebSocket for live updates: open checks, table status, KDS, 86 list.
- Every command runs in a MariaDB transaction. Business rules come from the shared packages:
  - tax and service charge (`@pos/engine`);
  - privileges, limits and approvals (`@pos/core/privileges`);
  - the hash-chained POS journal (`@pos/core/journal`);
  - IRD invoice numbering and hash chain.
- **Interfaces:**
  - **Printers:** the Model 1 print agent, which can run inside the service.
  - **Card terminals:** integrated, with token only and no card data stored.
  - **Guest system:** room charge, guest lookup, credit-limit check.
  - **ERP:** daily postings through the outbox.
  - **Firebase:** live figures through the sync agent.

## 3. Database `pos` (outline)

| Group | Tables |
|---|---|
| Organisation (from console) | `property`, `revenue_center`, `workstation`, `printer`, `kds_station`, `order_type`, `floor_plan`, `table_def` |
| Menu (from console) | `menu_item`, `menu_item_definition` (per revenue centre: name, screen, print class), `menu_item_price` (price levels, effective dates), `modifier_group`, `modifier`, `category`, `major_group`, `discount`, `service_charge`, `tender`, `reason_code`, `screen_layout`, `item_image` |
| People (from console + HR) | `employee`, `employee_role` (per property), `employee_rvc`, `role`, `role_privilege`, `role_limit`, `sign_in_policy` |
| Transactions (owned here) | `check`, `check_line`, `check_line_modifier`, `check_discount`, `check_payment`, `invoice` (IRD, hash chain), `credit_note`, `till`, `till_session`, `cash_declaration`, `paid_in_out`, `time_card` |
| Audit (append-only) | `pos_journal` (hash chain per workstation), `config_applied` (change id, version, hash), `audit_event` |
| Totals | `daily_total` (per property/revenue centre/date/hour), `item_total` |
| Integration | `outbox` (to ERP, guest system, cloud, Firebase), `inbox` (from guest system, cloud) |
| Sequences | `workstation_sequence` (invoice and check numbers), `posting_sequence` |

- Money is stored as integer cents (`BIGINT`), as in Model 1.
- Timestamps are UTC with the business date kept separately.
- Financial tables are **append-only**:
  - the service account has no `UPDATE`/`DELETE` grants on them;
  - corrections are new rows (voids, credit notes).

## 4. Offline and resilience

| Situation | Behaviour |
|---|---|
| No internet | Fully operational; outbox queues; replication resumes. |
| Primary hotel server fails | Standby takes over with the database replica (automatic failover). Workstations reconnect to the service address and resume. |
| Workstation loses the LAN | **Offline-capture mode:** the open check stays on screen and can be sent to a backup printer and paid in cash. Each offline transaction gets an offline sequence from the workstation's reserved block and is uploaded when the LAN returns. Card payments wait for the network. |
| Both hotel servers down | Disaster-recovery mode using the cloud POS service and cloud `pos` database over the internet. |

## 5. Features to build (Simphony parity plan)

Everything from Model 1 (sign-in, revenue centres, roles and limits, approvals, journal, reports, themes, photos, transfer, split, paid in/out), plus:

1. **Room charge** with guest lookup by room or name, signature capture and folio posting ([04 §7](04-guest-system.md)).
2. **Tills:** till per cashier, blind cash declaration, over/short.
3. Reopen and refund with **IRD credit notes**.
4. **Price levels:** per revenue centre and time (happy hour), effective-dated prices.
5. **Courses and seats:** course firing, seat numbers, split by seat, merge checks.
6. **Kitchen display:** stations, bump, timers, recall.
7. **Integrated card terminals:** tips, card holds for bar tabs, dynamic currency conversion.
8. **Banquets:** event orders from the guest system's events, deposits.
9. **Minibar, room service delivery tracking, poolside handhelds.**
10. **Simphony-style reporting:**
    - system sales, revenue centre, employee, time period, menu item, tender, exceptions;
    - plus labour cost against sales from time cards.

## 6. Moving the Model 1 POS screens to the property service

The Model 1 POS uses the `DocStore` interface (`get/list/set/merge/batch/watch`). Model 2 gives the workstation client a **`PosApiStore`** that implements the same calls as requests to the property POS service, plus WebSocket subscriptions for `watch`.

Business operations move from the client to the service (`closeCheck`, invoice numbering, journal writes) so a workstation can't bypass them. The screens themselves change very little.
