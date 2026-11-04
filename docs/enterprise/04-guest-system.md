# 04 — Guest system (property management) with OPERA Cloud-level functions

The guest system gives hotels the functions they know from Oracle OPERA Cloud. It is **our own implementation**: industry-standard hotel concepts with our own design, code and naming. It doesn't use Oracle's software, screens or trademarks, the same approach as the POS and Simphony.

## 1. Functional areas

| Area | Functions |
|---|---|
| **Profiles (guest relations)** | Guest, company, travel agent, source and group profiles; preferences, special requests, memberships, VIP levels, stay history, merge duplicates, consent and privacy flags (Sri Lanka PDPA) |
| **Reservations** | Individual, group and block reservations, allotments, waitlist, shares, multi-room, deposits, guarantees, cancellation and no-show policies, packages, routing, traces, confirmation letters, availability calendar |
| **Rates and inventory** | Room types and classes, rooms and features, rate codes, seasons, rate restrictions (min/max stay, closed to arrival), packages, overbooking levels, house availability, out-of-order inventory |
| **Front desk** | Arrivals, room assignment and upgrades, check-in with registration card, ID capture, key encoding, walk-ins, in-house list, room moves, check-out, express check-out, late check-out |
| **Rooms management** | Room status (vacant/occupied × clean/dirty/inspected), out of order/out of service, housekeeping sections and attendant task sheets, discrepancies (sleep/skip), lost and found, maintenance requests |
| **Cashiering** | Folios with windows, transaction codes, postings, adjustments with reasons, routing instructions, payments, deposits, folio transfer, tax invoices (IRD format), cashier shifts and closure |
| **Accounts receivable** | City ledger, direct-bill accounts, transfer at check-out, invoices, statements, aging, payments and allocation, credit limits |
| **Night audit (end of day)** | Pre-checks, post room and tax, no-show handling, roll the business date, back-up reports, manager flash, revenue and statistics, handover to ERP |
| **Groups and events** | Group blocks and pick-up, rooming lists; event bookings, function rooms and banquet event orders (BEO) feeding the POS banquet revenue centre |
| **Reports** | Arrivals, departures, in-house, occupancy and forecast, ADR, RevPAR, revenue by transaction code, market and source analysis, housekeeping, AR aging, guest ledger, police/immigration guest report (confirm current Sri Lanka requirements) |
| **Interfaces** | POS (room charge), door locks (key encoding), PBX/call accounting, payment gateway and card terminals, channel manager and booking engine, ERP |

## 2. Service and database

- **Property guest service**: Node.js/TypeScript, a container on the hotel servers (active/standby), with REST and WebSocket APIs. It serves the front-desk and housekeeping screens, which are new console-style screens running at the hotel.
- **Database `pms` (outline):**

| Group | Tables |
|---|---|
| Configuration (from console) | `room_type`, `room_class`, `room`, `room_feature`, `rate_code`, `rate_season`, `rate_amount`, `restriction`, `package`, `market_code`, `source_code`, `transaction_code`, `routing_code`, `payment_method`, `hk_section`, `policy` |
| Profiles | `profile`, `profile_address`, `profile_contact`, `profile_preference`, `profile_membership`, `profile_consent`, `profile_document` (ID numbers field-encrypted) |
| Reservations and inventory | `reservation`, `reservation_room`, `reservation_rate` (per night), `reservation_guest`, `block`, `block_inventory`, `allotment`, `availability` (per room type per date), `deposit_schedule` |
| Front desk and rooms | `stay`, `room_status`, `room_status_history`, `ooo_period`, `hk_task`, `key_issue` |
| Cashiering (append-only) | `folio`, `folio_window`, `posting` (transaction code, amount, tax, source: POS/manual/night audit), `payment`, `routing_instruction`, `invoice` (IRD, hash chain), `cashier_shift` |
| Accounts receivable | `ar_account`, `ar_invoice`, `ar_payment`, `ar_allocation` |
| Night audit | `business_date`, `night_audit_run`, `statistics_daily` |
| Audit and integration | `pms_journal` (hash chain), `config_applied`, `audit_event`, `outbox`, `inbox` |

## 3. Taxes and charges (Sri Lanka)

Room and outlet charges use the Model 1 tax engine:
- service charge;
- SSCL;
- VAT;
- TDL (Tourism Development Levy) where the property is liable.

Rates and liabilities are configured per property, as in [06-sri-lanka-compliance](../06-sri-lanka-compliance.md). Invoices follow the IRD tax invoice format with per-workstation/per-cashier numbering and a hash chain.

## 4. Night audit

A guided run on the hotel server:
1. Checks: unbalanced folios, pending arrivals and departures, open POS checks, cashiers not closed.
2. Posts room and tax for in-house guests.
3. Processes no-shows per policy.
4. Produces the day's statistics.
5. Rolls the business date.
6. Emits one **revenue handover** (by transaction code, department and tax) to the ERP connector, plus city-ledger movements for accounts receivable.

## 5. Group and central functions in the cloud

The cloud guest service (on the cloud `pms` replica) gives:
- a cross-hotel guest profile search;
- group reports;
- the central reservations office;
- the web booking engine and channel manager connection.

## 6. Bookings while a hotel is offline

- Online channels (website, OTAs, central reservations) book against **allotments** that each hotel releases to the cloud. This is standard channel-manager practice.
- New bookings are confirmed to the guest against the allotment and **delivered to the hotel through the queue**.
- If the hotel is offline, delivery waits.
- If the hotel sold the last room locally in the meantime, the conflict is flagged at once on reconnect for the reservations team. A small allotment buffer makes this rare.

## 7. Room charge from the POS

1. The POS asks the guest service (local, on the same hotel server) for in-house guests by room number or name.
2. The service checks the posting is allowed:
   - not a "no post" or cash-only guest;
   - within the credit limit;
   - the routing to a company account, if set.
3. The POS posts the check total with its detail (outlet, check number, items, service charge and taxes) as a posting on the guest folio. It works without internet because both services are on the hotel server.
4. The posting is reflected in the POS journal and the guest system journal, with the same reference in both.
