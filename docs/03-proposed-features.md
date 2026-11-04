# 03 — Proposed Additional Features (for your selection)

These go **beyond** Simphony/EMC parity.

## ✅ Client selection (2026-10-30)
| ID | Decision | Notes |
|----|----------|-------|
| X01 | ✅ **Optional module** | QR table ordering & pay-at-table, sold as an add-on |
| X06 | ✅ Selected | Digital receipt **in addition to** the printed IRD-format bill, which is always printed |
| X11 | ❌ Not needed | |
| X14 | ✅ Selected | Allergen alerts (P1) |
| X18 | ✅ Selected | Real-time exception alerts via WhatsApp/EMC |
| X21 | ✅ Selected | Menu engineering matrix |
| X27 | ✅ Selected | Excel accounting workbook + open-source connector, see [08](08-accounting-integration.md) |
| X34 | ✅ Selected | Mobile stock count (inventory module) |
| X36 | ✅ Implied | Multi-tenant SaaS: the product will be sold to other restaurants |
| X38 | ✅ Selected | Remote device monitoring & OTA updates |
| X03 | ⏸ Last phase | Website online ordering (pickup/delivery) on Firebase, after the core product is deployed |
| Others | Not now | Can be revisited for later releases |

---

**My recommendation** column: ★★★ = strongly recommended · ★★ = valuable · ★ = nice to have.

---

## Guest-facing

| ID | Feature | Why it matters | Suggested phase | My rec. |
|----|---------|----------------|-----------------|---------|
| X01 | **QR table ordering & pay-at-table** | Guests scan a table QR, order and/or pay via IPG; fewer staff trips, faster table turns | P2 | ★★★ |
| X02 | Self-service kiosk | Upsell-friendly ordering for takeaway/QSR | P3 | ★ |
| X03 | **Website online ordering** (pickup/delivery) wired to POS & inventory | Your planned website: live menu, real-time 86, IPG checkout, orders straight to kitchen | P3 | ★★★ |
| X04 | **Reservations & waitlist** | Book online/phone, table assignment on floor plan, WhatsApp confirmation & "table ready" message | P3 | ★★ |
| X05 | Delivery platform integration | Orders from delivery apps injected into POS (no re-keying), menu & 86 sync | P3 | ★★ |
| X06 | **Digital receipts** (WhatsApp / email / SMS) | Paper saving, captures customer contact for CRM | P2 | ★★★ |
| X07 | **Loyalty & CRM** | Customer profiles, visit history, points/tiers, birthday offers, targeted WhatsApp campaigns (opt-in) | P2–P3 | ★★ |
| X08 | E-gift cards (sell online, redeem in store) | Extra revenue, works with website | P3 | ★ |
| X09 | **Guest feedback** | QR on receipt → quick rating; low rating instantly alerts manager on WhatsApp | P2 | ★★ |
| X10 | Rich customer-facing display | Order review, promos, tip selection, payment QR | P1 | ★★ |

## Staff productivity & service

| ID | Feature | Why it matters | Suggested phase | My rec. |
|----|---------|----------------|-----------------|---------|
| X11 | **Handheld/tablet ordering** for waiters | Order at the table, fewer errors, faster service | P1–P2 | ★★★ |
| X12 | KDS prep-time analytics & recall | Find kitchen bottlenecks | P1 | ★★ |
| X13 | Smart upsell prompts | "Add fries?" / pairing suggestions → higher average check | P2 | ★★ |
| X14 | **Allergen alerts at order time** | Safety: warns server, flags kitchen chit in red | P1 | ★★★ |
| X15 | Multi-language POS UI | Staff choose their language at sign-in | P1 | ★★ (Q13) |
| X16 | Guided onboarding & in-app help | New staff productive on day one | P1 | ★★ |

## Management & control

| ID | Feature | Why it matters | Suggested phase | My rec. |
|----|---------|----------------|-----------------|---------|
| X17 | **WhatsApp manager bot** | Ask "sales today?", "top items?", "stock of chicken?" and get instant answers | P2 | ★★ |
| X18 | **Real-time exception alerts** | Void/discount over threshold, cash variance, too many no-sales, low stock, EOD not run, terminal/printer offline, sync lag | P2 | ★★★ |
| X19 | AI anomaly / fraud detection | Learns normal patterns per employee; flags suspicious voids, refunds, discounts | P2–P3 | ★★ |
| X20 | **AI sales & demand forecasting** | Forecast covers & item demand → prep lists, purchase suggestions, staffing | P3 | ★★ |
| X21 | Menu engineering matrix | Stars / Plowhorses / Puzzles / Dogs using sales mix × margin | P1 | ★★★ |
| X22 | Budgets & targets | Daily targets on dashboard; actual vs budget in reports | P2 | ★★ |
| X23 | **Shift scheduling** | Drag-and-drop rota, labour forecast, shift swaps, publish via WhatsApp | P2 | ★★ |
| X24 | Employee self-service app | View schedule, hours, tips; request leave/swaps | P3 | ★ |
| X25 | Tip pooling & service-charge distribution | Fair, rule-based distribution with reports | P2 | ★★ (Q3) |
| X26 | **Remote approvals** | Manager approves a void/refund/PO from their phone (push notification) | P2 | ★★ |

## Back office & finance

| ID | Feature | Why it matters | Suggested phase | My rec. |
|----|---------|----------------|-----------------|---------|
| X27 | **Accounting integration** | Daily GL journal (sales, tax, tenders, COGS) to your accounting software | P2 | ★★★ (Q9) |
| X28 | Payroll export | Hours & pay data out to payroll | P2 | ★★ |
| X29 | Fiscal / e-invoicing compliance | Required in some countries | as required | (Q2) |
| X30 | Send POs to suppliers via WhatsApp/email | Faster purchasing, PDF PO | P2 | ★★ |
| X31 | Supplier invoice OCR | Photo of invoice → draft GRN | P3 | ★ |
| X32 | Central kitchen / commissary | For future multi-outlet production & distribution | P3 | ★ |
| X33 | Batch & expiry tracking (FEFO) | Food safety, less waste | P1 | ★★ |
| X34 | **Mobile stock count app** (barcode scan) | Counts in half the time | P1–P2 | ★★★ |
| X35 | Weighing-scale integration | Sell/receive by weight | P1 | (if needed) |

## Platform

| ID | Feature | Why it matters | Suggested phase | My rec. |
|----|---------|----------------|-----------------|---------|
| X36 | **Multi-tenant SaaS & white-label** | Sell the system to other restaurants with subscription billing | P2+ | (Q1) |
| X37 | Public API & webhooks | Third parties/website integrate cleanly | P3 | ★★ |
| X38 | Remote device monitoring & OTA updates | Support without site visits | P1–P2 | ★★★ |
| X39 | Hash-chained tamper-evident journal | Trust & audit, fiscal-ready | P1 | ★★★ (included in baseline design) |
| X40 | BigQuery / Looker Studio access | Custom analytics for power users | P2 | ★★ |
| X41 | Hotel PMS interface (room charge) | Only if the restaurant is in a hotel | as required | (Q3) |
| X42 | Brand theming per restaurant | Logo, accent colour, receipt design per brand | P1 | ★★ |
