# 10 — Decisions and open questions

## Decisions (2026-11-04)

| # | Topic | Decision |
|---|---|---|
| E1 | Editions | Two editions in one repository on two branches: Cloud Restaurant Edition (Model 1, Firebase) for small to medium restaurants; Enterprise Hotel Edition (Model 2, this branch) for medium to large hotels. Clients choose by requirements and price plan. |
| E2 | Guest system | Our own guest system with Oracle OPERA Cloud-level functions (our own implementation and naming). |
| E3 | Topology | As Oracle Simphony + OPERA Cloud: a server in every hotel holding the POS, guest-system and ERP databases, with the same databases in Google Cloud. |
| E4 | Database | MariaDB for every system, with the security baseline in [06](06-mariadb-security.md). |
| E5 | ERP | ERPNext with Frappe HR (HR and payroll in scope), unmodified, plus our connector app. |
| E6 | ERP hosting | Client's choice: option 1 on the hotel server, or option 2 in Google Cloud. |
| E7 | Configuration | All configuration of POS, guest system and ERP done in the Firebase console, as in Model 1, and distributed to MariaDB ([02](02-firebase-control-plane.md)). |
| E8 | Firebase role | Control plane and live figures only; no transactions in Firestore. |
| E9 | Backups | Encrypted, retention-locked backups in Google Cloud Storage in two regions, with monthly restore drills. |
| E10 | Ownership | One owner per record. Configuration: console. POS and guest transactions: hotel database. Books, HR and payroll: ERPNext. Employee master data: Frappe HR. |
| E11 | ERP configuration | Day-to-day masters in the console; specialist ERP setup in ERPNext's own screens through single sign-on, mirrored back to the console. |
| E12 | Hotel availability | High-availability server pair in every hotel; workstation offline-capture as the last resort. |

## Open questions

| # | Question | Why it matters | Proposed default |
|---|---|---|---|
| Q1 | Target hotels for the first sale: rooms, outlets, workstations, number of properties? | Server sizing, licence limits, phase 2 scope | 150–300 rooms, 4–8 outlets, one property |
| Q2 | Is the high-availability **pair** mandatory, or may a small hotel start with one server plus the cloud as backup? | Hardware cost | Pair for 4- and 5-star; single server allowed below that |
| Q3 | Which card-terminal bank and which door-lock and PBX vendors are common among target hotels? | Phase 5 integrations and partner agreements | Ask the pilot hotel |
| Q4 | Channel manager: integrate an existing one, or build our own booking engine first? | Phase 5 scope | Integrate an existing channel manager; our own booking engine later |
| Q5 | ERPNext: one company per hotel or one company with hotel cost centres? | Group consolidation and tax filing | One company per hotel (each is usually a separate legal entity) |
| Q6 | Service charge distribution rules (share to staff, allocation method) | Payroll design | Configurable: statutory minimum share; points or days worked |
| Q7 | Should managers see full transaction detail (every check) in the console, or summaries plus drill-down to the hotel? | Firestore cost and data exposure | Summaries in Firestore; drill-down served from MariaDB through the cloud service |
| Q8 | Do target hotels already use an accounting or HR system that must keep running in parallel at first? | Migration plan | Import opening balances and employees into ERPNext at go-live |
| Q9 | Pricing of the enterprise edition (licence per property, per room, per workstation; hardware supply) | Licence editions in `licensing.ts` | Enterprise Hotel edition priced per property plus per workstation |
| Q10 | Branch name and future: keep two long-lived branches, or merge into `main` with an edition switch later? | Maintenance cost | Two branches now (as decided), with regular merges from Model 1 |
