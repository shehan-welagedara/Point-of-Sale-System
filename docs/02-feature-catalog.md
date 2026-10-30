# 02 — Core Feature Catalogue (Simphony / EMC parity + Inventory)

> This is the **baseline scope**. It matches the functional capabilities of Oracle MICROS Simphony, EMC, Simphony People Management and MICROS Inventory, rebuilt with our own design, naming and code.
> Optional extras for you to choose from are in [03-proposed-features.md](03-proposed-features.md).
>
> Phase key: **P1** = Offline go-live · **P2** = Online · **P3** = Website and growth

---

## A. Enterprise and configuration (EMC)

| Feature | Phase |
|---------|-------|
| Enterprise hierarchy: Enterprise → Zone → Property → Revenue Center (RVC) → Workstation | P1 |
| Inheritance and override of any record down the hierarchy | P1 |
| Property parameters (business date rules, currency, rounding, receipt headers and trailers, logo) | P1 |
| RVC parameters (table service or fast transaction, default order type, auto service charge, check-close rules) | P1 |
| Workstation configuration (devices, default RVC, check-number range, offline behaviour, customer display) | P1 |
| **Touchscreen designer**: drag-and-drop pages, keys, colours, images, per RVC, order type or role | P1 |
| Effective dates and scheduled changes (for example a price change starting Monday 06:00) | P1 |
| Change sets with publish, preview, rollback and version history | P1 |
| Bulk edit, copy record, import and export (Excel/CSV) | P1 |
| Full audit log (who, what, when, before, after) with search | P1 |
| Multi-language record names (receipt, kitchen and online names) | P1 |
| Cloud EMC with multi-property management | P2 |

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
| Receipt options: print, email, WhatsApp, or no receipt | P1 print · P2 digital |
| Training mode (sandbox, excluded from totals) | P1 |
| Workstation offline (standalone) mode with automatic reconciliation | P1 |
| Check info lines, memo items, kitchen notes (free-text special requests) | P1 |

## D. Tender media and payment settlement

| Feature | Phase |
|---------|-------|
| Configurable **tender media** with options: open drawer, require amount, allow change/over-tender, max amount, require reference, privilege needed, tips allowed, post to till, report group | P1 |
| Cash (local and **foreign currency** with exchange rates, change in local currency, denomination buttons, cash rounding) | P1 |
| **Integrated card terminal** (semi-integrated: amount pushed, approval returned) | P1 (provider per Q6) |
| Manual/standalone card (approval code entry) | P1 |
| **IPG**: payment link, QR on bill or customer display, pay-at-table, online orders; webhook confirmation | P2 (P1 if internet) |
| Mobile wallets / local QR payment schemes | P2 (Q6) |
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

## H. People Management (Simphony People Management equivalent)

| Feature | Phase |
|---------|-------|
| **Employee records**: personal, contact, emergency contact, photo, ID numbers, documents (upload) | P1 |
| **Employment details**: hire date, status (active, on leave, terminated), department, location(s), job codes, pay rates (hourly or salary), overtime rules, probation, notes | P1 |
| **Roles / employee classes** with a granular **privilege matrix** (hundreds of options: void, discount, refund, reopen, no-sale, transfer, reports, EMC areas…) | P1 |
| Per-location and per-RVC access (operator records) | P1 |
| **EMC users vs POS employees**: one person record can have both, with separate permissions | P1 |
| PIN / card assignment and reset; auto-disable on termination | P1 |
| **Time and attendance**: punches, breaks, edits with reason and audit, approval | P1 |
| Labour reports: hours, overtime, labour cost %, by job code/department | P1 |
| Tip declaration and tip reports | P1 |
| Payroll export | P2 |
| **Centralised cloud management** of all employees across all restaurants | P2 |

## I. Inventory and stock management

| Feature | Phase |
|---------|-------|
| **Stock item master**: categories, SKU/barcode, storage conditions, shelf life | P1 |
| **Units of measure with conversions** (purchase unit → stock unit → recipe unit, e.g. case of 12 × 1 L → ml) | P1 |
| **Multiple storage locations** (main store, kitchen, bar, cold room) with **transfers / requisitions** between them | P1 |
| **Vendors** and vendor items (pack sizes, prices, lead times, minimum order) | P1 |
| **Purchasing workflow**: requisition → purchase order → approval → send to vendor | P1 |
| **Receiving / GRN**: partial receipts, price variance flags, credit notes, returns to vendor | P1 |
| **Recipes / bills of materials** with sub-recipes (sauces, prep items), yield % and waste % | P1 |
| **Real-time depletion** from POS sales, including condiments and combos | P1 |
| **Production / batch prep** (convert raw items into prep items) | P1 |
| **Waste / spoilage** recording with reasons | P1 |
| **Stock counts**: full and cycle counts, count sheets by location/shelf order, blind counts, mobile counting | P1 |
| **Variance**: actual vs theoretical usage, with cost impact | P1 |
| **Costing**: weighted average (default), FIFO or last price (configurable) | P1 |
| **Par levels, reorder points**, automatic order suggestions | P1 |
| **Recipe costing and food cost %** per menu item; margin analysis | P1 |
| Batch/lot and expiry tracking | P1 (optional) |
| Low-stock alerts (POS, EMC, WhatsApp) | P1 / P2 |
| Stock valuation, movement history, period close | P1 |
| Link to **86**: stock running out can auto-86 a menu item | P1 |

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
| **Inventory** | Stock on hand, valuation, variance, usage, waste, purchases, vendor performance, food cost | P1 |
| **Enterprise** | Multi-property roll-ups, rankings | P2 |
| Formats: on-screen, PDF, Excel, CSV; **scheduled delivery** (email, **WhatsApp**) | | P1 / P2 |
| **Live dashboard** (today's sales, covers, avg check, top items, open checks, labour %), mobile-friendly | | P1 (LAN) / P2 (anywhere) |

## K. WhatsApp for management

| Feature | Phase |
|---------|-------|
| Scheduled reports (e.g. End-of-Day summary + PDF at 23:30, weekly report on Monday 08:00) to configurable recipient lists | P2 |
| Real-time alerts (see [03-proposed-features.md](03-proposed-features.md) X18) | P2 |
| Manager self-service bot ("today sales", "top items", "stock of X") | P2 (optional X17) |

## L. System administration

| Feature | Phase |
|---------|-------|
| Device registry and health (terminals, printers, KDS, card terminals) | P1 |
| Auto-update with staged rollout and rollback | P1 |
| Backups (local hourly, external nightly; cloud in P2) and restore tool | P1 |
| Logs, diagnostics, remote support access (with consent) | P1 / P2 |
| Licensing / subscription management (if sold as a product, Q1) | P2 |
