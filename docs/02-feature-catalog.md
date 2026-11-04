# 02 — Core Feature Catalogue (Simphony / EMC parity + Inventory)

> This is the **baseline scope**. It matches the functional capabilities of Oracle MICROS Simphony, EMC, Simphony People Management and MICROS Inventory, rebuilt with our own design, naming and code.
> Optional extras for you to choose from are in [03-proposed-features.md](03-proposed-features.md).
>
> Release key (revised 2026-10-30, online-first): **P1** = Core product (first restaurant go-live) · **P2** = Extended release · **P3** = Website & growth. See [04-roadmap.md](04-roadmap.md).
> Scope note: **People Management = user accounts, roles, privileges and access control** (as in Simphony). HR features such as payroll, scheduling and leave are **out of scope**.

---

## A. Enterprise and configuration (EMC)

| Feature | Phase |
|---------|-------|
| Enterprise hierarchy: Enterprise → Zone → Property → Revenue Center (RVC) → Workstation | P1 |
| Inheritance and override of any record down the hierarchy | P1 |
| Property parameters (business date rules, currency, rounding, receipt headers and trailers, logo) | P1 |
| RVC parameters (table service or fast transaction, default order type, auto service charge, check-close rules) | P1 |
| Workstation configuration (devices, default RVC, invoice classification code, customer display) | P1 |
| **Touchscreen designer**: drag-and-drop pages, keys, colours, images, per RVC, order type or role | P1 |
| Effective dates and scheduled changes (for example a price change starting Monday 06:00) | P1 |
| Change sets with publish, preview, rollback and version history | P1 |
| Bulk edit, copy record, import and export (Excel/CSV) | P1 |
| Full audit log (who, what, when, before, after) with search | P1 |
| Multi-language record names (receipt, kitchen and online names) | P1 |
| Multi-property / multi-tenant management, Platform Admin (licences, modules) | P2 |

## B. Menu management

| Feature | Phase |
|---------|-------|
| Menu item **master / definition / price** records (one item, many definitions per RVC) | P1 |
| Price levels (main and sub levels), time-based prices and happy hour through effectivity groups | P1 |
| Serving periods (breakfast, lunch, dinner) controlling pages, prices and availability | P1 |
| Menu item classes (behaviour templates: tax class, print class, condiment rules, discount/service-charge itemisers, open price, weighed item, allow void, etc.) | P1 |
| **Family groups, major groups and report groups** | P1 |
| SLUs / NLUs (screen and number look-ups), search and favourites | P1 |
| **Condiments / modifiers**: groups, required or allowed, min/max, prefixes (No / Extra / Light / On side), priced condiments, nested condiments | P1 |
| **Combo meals**: combo groups, side and size choices, upcharges, auto-combo recognition | P1 |
| Open-price items, weighed items (scale), barcode items | P1 |
| **86 / availability**: out of stock and countdown quantities, synced to all terminals | P1 |
| Allergens, dietary tags, nutrition, images and descriptions | P1 |
| Channel-specific fields (POS / online / delivery price and availability) | P1 data model · P3 use |
| Bulk price update (% or amount, by group) | P1 |

## C. Front of house (POS)

| Feature | Phase |
|---------|-------|
| Sign in with PIN, employee card (mag/NFC) or optional biometric; auto sign-out | P1 |
| Clock in/out, breaks, job-code selection at clock-in | P1 |
| **Order types**: dine-in, takeaway, delivery, pick-up, staff meal (configurable) | P1 |
| Begin check by table, by number or by name; guest count; customer info | P1 |
| Seats, courses, **hold & fire**, auto-fire timers, "send" vs "service total" | P1 |
| Pick up check, add or transfer checks, **merge** checks | P1 |
| **Split check**: by seat, by item, evenly, or by amount; split one item across checks | P1 |
| Transfer a check to another employee, table or RVC | P1 |
| **Void** (current round), **error correct**, **void previous round**, **return/refund**, all with reason codes | P1 |
| Reopen closed check, adjust closed check (privileged) | P1 |
| Reprint check or receipt, print guest check (bill) before payment | P1 |
| **Table management**: floor-plan designer, live table status and colours, seat timers, join and unjoin tables, server sections | P1 |
| **Discounts**: open/preset, % or amount, item or subtotal, automatic and combo discounts, coupon codes, employee meal discount, thresholds that require a manager | P1 |
| **Service charges**: automatic by RVC, order type or guest count; % or amount; taxable or non-taxable | P1 |
| **Taxes**: multiple rates, inclusive/exclusive, compound, tax on service charge, exemptions | P1 |
| Tips and gratuity (on card and cash), auto-gratuity for large parties | P1 |
| Manager override and authorisation prompts | P1 |
| Fast transaction (quick service) mode and table service mode per RVC | P1 |
| Customer display (order lines, totals, promo images, payment QR) | P1 |
| **Printed bill per IRD format (always)** + optional digital receipt via WhatsApp/email (X06) | P1 print · P2 digital |
| Training mode (sandbox, excluded from totals) | P1 |
| Resilience to short internet drops (Firestore offline cache, queued sync, local invoice sequence) | P1 |
| Check info lines, memo items, kitchen notes (free-text special requests) | P1 |

## D. Tender media and payment settlement

| Feature | Phase |
|---------|-------|
| Configurable **tender media** with options: open drawer, require amount, allow change/over-tender, max amount, require reference, privilege needed, tips allowed, post to till, report group | P1 |
| Cash (local and **foreign currency** with exchange rates, change in local currency, denomination buttons, cash rounding) | P1 |
| Card via standalone bank terminal (approval code captured); semi-integration if the bank offers an ECR protocol | P1 |
| Manual/standalone card (approval code entry) | P1 |
| **PayHere IPG**: payment links, QR pay-at-table (X01), online orders; webhook confirmation | P2 |
| **LankaQR** (bank merchant QR) with reference capture | P1 |
| **Split tender**, partial payment, **deposits and advances**, refunds to original tender | P1 |
| **Gift vouchers / gift cards** (serials, balances, expiry, redemption, partial redemption) | P1 |
| **House accounts / city ledger** (credit customers, limits, statements, payments received) | P1 |
| Complimentary, officer check, staff meal (non-revenue tenders with authorisation) | P1 |
| Room charge (hotel PMS interface) | If needed (Q3) |
| **Card batch settlement** at end of day; **IPG reconciliation** against gateway reports | P1 / P2 |
| Tender reconciliation report (expected vs declared vs settled) | P1 |

## E. Cash management

| Feature | Phase |
|---------|-------|
| Tills and cash drawers, assignment to employee/workstation; server banking model (servers hold their own cash) | P1 |
| Opening float, loans, **pickups (cash pulls)**, **paid-in / paid-out** with reasons | P1 |
| No-sale drawer opens (privileged, logged and reported) | P1 |
| **Blind cash count / declaration** by denomination, over/short | P1 |
| Safe management, bank deposits | P1 |
| Cash-up / shift report per till and per employee | P1 |

## F. Kitchen (printers and KDS)

| Feature | Phase |
|---------|-------|
| Order devices: kitchen printers and KDS stations | P1 |
| Routing by menu item, print class, RVC, order type, workstation | P1 |
| **Backup/redirect devices** when a printer fails | P1 |
| Chit formatting (large fonts, modifiers indented, seat/course, colour for allergies) | P1 |
| KDS: prep and expo stations, bump/recall, item vs order view, colour timers, "all-day" counts | P1 |
| Course firing from KDS/POS, "order ready" notification back to POS | P1 |
| Speed-of-service and prep-time reports | P1 |

## G. Business day and End of Day

| Feature | Phase |
|---------|-------|
| Start-of-day / business-date management | P1 |
| **End-of-day autosequence** (configurable): open-check policy, auto clock-out, card batch close, cash declaration check, totals posting, report generation and distribution, backup, sync | P1 |
| X report (mid-day) and Z report (closing) | P1 |
| Scheduled autosequences (for example 03:00 daily) | P1 |

## H. People Management (user accounts and access control, as in Simphony)

| Feature | Phase |
|---------|-------|
| **User records**: name, employee no., photo, contact, status (active, suspended, terminated), properties they may work at | P1 |
| **One identity, two access types**: POS sign-in (ID + PIN / NFC card) and EMC/Insights sign-in (email + password + MFA) | P1 |
| **Roles / employee classes** with a granular **privilege matrix** (void, discount, refund, reopen, no-sale, price override, transfer, reports, each EMC area…) | P1 |
| Per-property / per-RVC role assignment (operator records) | P1 |
| Manager override rules (which privileges a manager may authorise for others; thresholds) | P1 |
| PIN / card assignment and reset; instant disable on termination (all sessions revoked) | P1 |
| Clock in/out at the POS (attendance only; optional) and simple hours report | P2 |
| Login history and privileged-action audit per user | P1 |
| Centralised management of users across all outlets / tenants | P2 |

## I. Inventory and stock management (optional licensable module)

> Switched on or off per tenant. When it is off, the POS and EMC hide every inventory screen and no depletion runs. Inventory follows the core go-live as release **P2**.

| Feature | Phase |
|---------|-------|
| **Stock item master**: categories, SKU/barcode, storage conditions, shelf life | P2 |
| **Units of measure with conversions** (purchase unit → stock unit → recipe unit, e.g. case of 12 × 1 L → ml) | P2 |
| **Multiple storage locations** (main store, kitchen, bar, cold room) with **transfers / requisitions** between them | P2 |
| **Vendors** and vendor items (pack sizes, prices, lead times, minimum order) | P2 |
| **Purchasing workflow**: requisition → purchase order → approval → send to vendor | P2 |
| **Receiving / GRN**: partial receipts, price variance flags, credit notes, returns to vendor | P2 |
| **Recipes / bills of materials** with sub-recipes (sauces, prep items), yield % and waste % | P2 |
| **Real-time depletion** from POS sales, including condiments and combos | P2 |
| **Production / batch prep** (convert raw items into prep items) | P2 |
| **Waste / spoilage** recording with reasons | P2 |
| **Stock counts**: full and cycle counts, count sheets by location/shelf order, blind counts, mobile counting | P2 |
| **Variance**: actual vs theoretical usage, with cost impact | P2 |
| **Costing: FIFO** (lot-based; client decision), with weighted average available as an option | P2 |
| **Par levels, reorder points**, automatic order suggestions | P2 |
| **Recipe costing and food cost %** per menu item; margin analysis | P2 |
| Batch/lot and expiry tracking | P1 (optional) |
| Low-stock alerts (POS, EMC, WhatsApp) | P2 |
| Stock valuation, movement history, period close | P2 |
| Link to **86**: stock running out can auto-86 a menu item | P2 |

## J. Reporting and analytics (Insights web portal)

| Report family | Examples | Phase |
|---------------|----------|-------|
| **Sales** | Daily/period system sales, by RVC, order type, serving period, **hourly / daypart**, comparisons (vs last week / year / budget) | P1 |
| **Menu** | Item, family and major group sales, mix %, **menu engineering**, condiment usage | P1 |
| **Financial** | Taxes, service charges, discounts, **tender media**, gross-to-net, deposits, house-account ledger | P1 |
| **Control / exceptions** | Voids, error corrects, returns, reopened checks, no-sales, price overrides, discounts by employee | P1 |
| **Operations** | Covers, average check, table turn time, speed of service, open checks | P1 |
| **Cash** | Till, cash-up, over/short, paid-in/out, pickups | P1 |
| **Employee & labour** | Sales per server, tips, hours, labour %, sales per labour hour | P1 |
| **Inventory** (module) | Stock on hand, valuation, variance, usage, waste, purchases, vendor performance, food cost | P2 |
| **Enterprise** | Multi-property roll-ups, rankings | P2 |
| Formats: on-screen, PDF, Excel, CSV; **scheduled delivery** (email, **WhatsApp**) | | P1 / P2 |
| **Live dashboard** (today's sales, covers, avg check, top items, open checks, labour %), mobile-friendly | | P1 (LAN) / P2 (anywhere) |

## K. WhatsApp for management

| Feature | Phase |
|---------|-------|
| **End-of-Day reports to managers** (Daily Revenue, Item-wise, Covers, Sales) as PDF on WhatsApp, to configurable recipient lists | P1 (once the WhatsApp number is verified) |
| Real-time exception alerts (X18 ✅ selected) | P2 |
| Manager self-service bot ("today sales", "top items", "stock of X") | P2 (optional X17) |

## L. System administration

| Feature | Phase |
|---------|-------|
| Device registry and health (terminals, printers, KDS, card terminals) | P1 |
| Auto-update with staged rollout and rollback | P1 |
| Backups (local hourly, external nightly; cloud in P2) and restore tool | P1 |
| Logs, diagnostics, remote support access (with consent) | P1 / P2 |
| Licensing / subscription management (if sold as a product, Q1) | P2 |
