# 07 — Payments (Tender Media) & Hardware

## 1. Most cost-effective payment mix for Sri Lanka

| Tender | Provider | Indicative merchant cost | Use for | Integration |
|--------|----------|-------------------------|---------|-------------|
| **Cash** | — | 0% | Everything | Native: denominations, change, cash rounding, drawer kick |
| **LankaQR** | Any participating bank (merchant QR) | **0% for payments ≤ Rs 5,000** (since 6 Apr 2026); **capped at 1%** above that for local apps (foreign apps such as UPI/Alipay+ up to 1.8%); instant settlement | Most digital in-store payments. **The cheapest option.** | Phase 1: static or bank dynamic QR, with the cashier confirming and the reference recorded. Later: bank API for automatic confirmation where the bank offers one |
| **Card (standalone bank terminal)** | Your bank (Visa/Master/Amex/UnionPay) | MDR typically **~2–3%** (negotiable, plus any terminal rental; **get quotes from 2–3 banks**) | Guests paying by card in-store | Tender "Card – Visa/Master/…" with the approval code entered (semi-integration later if the bank provides an ECR protocol) |
| **PayHere** | PayHere (IPG) | **Lite plan: no setup or monthly fee, 3.30% per transaction** (other plans exist; check payhere.lk/fees for current figures) | Remote and online payments **only**: QR pay-at-table (X01), payment links for advance deposits and event bookings, the future website | Checkout API + Payment Links + `notify_url` webhook with MD5 signature verification, handled in Cloud Functions |
| Gift vouchers / gift cards | Internal | 0% | Promotions, corporate gifts | Serial number, balance, expiry |
| House account (credit customers) | Internal | 0% | Corporate clients, regulars | Credit limit, statements, receipts |
| Complimentary / staff meal / officer check | Internal | — | Non-revenue tenders | Manager authorisation and reason code |
| Foreign currency (USD, EUR, GBP…) | Cash | 0% | Tourists | Exchange-rate table in EMC, change given in LKR |

**Recommendation:**
- In-store: **cash + LankaQR + bank card terminal**.
- **PayHere** for online and remote payments only.
- Using PayHere for in-store cards would cost ~3.3% instead of the bank's ~2–3%. Using LankaQR for ≤ Rs 5,000 bills costs nothing.

### Settlement and reconciliation features
- Split and partial tenders, tips, deposits and advances, refunds to the original tender.
- End-of-day **tender reconciliation**: system expected vs declared (cash) vs settled (bank card batch report, LankaQR statement, PayHere settlement).
- **Blind cash declaration** by denomination, with over/short per till and per cashier.
- PayHere: automatic match by `order_id` through the webhook; unmatched payments go to an exception list.

## 2. Hardware: supports budget-friendly devices

The POS Shell talks **ESC/POS**, the de facto standard of nearly every thermal printer on the market. It is not tied to any brand.

| Device | Recommended | Budget alternatives | Notes |
|--------|-------------|--------------------|-------|
| POS terminal | Windows 11 touch all-in-one POS (15.6") | Any Windows 10/11 PC or laptop with mouse/keyboard; optional USB touch monitor | Minimum: 4-core CPU (Celeron N5105 / i3 or better), 8 GB RAM, SSD. Runs full-screen in kiosk mode |
| Receipt / bill printer | **Epson TM-T82III** (USB + Ethernet) | Xprinter (XP-Q80/N160), Rongta (RP326/RP330), Sewoo, Gprinter, any 80 mm ESC/POS printer with auto-cutter | Prefer **Ethernet** models so the printer can be shared by more terminals later |
| Cash drawer | Any **RJ11/RJ12 24 V printer-driven** drawer (5 notes / 8 coins) | Same | Plugs into the printer's DK port. The POS sends the open-drawer pulse after cash tenders |
| Kitchen | 2nd ESC/POS printer (Ethernet) | **KDS** on an Android TV box + TV, or a tablet with a browser | Routing per item or print class, with backup printer failover |
| Customer display (optional) | 2nd monitor / pole display | — | Shows order, totals and the LankaQR/PayHere QR |
| Staff login card (optional) | USB NFC/MSR reader (keyboard-emulation) | — | Faster and more secure than PIN alone |
| Barcode scanner (inventory) | USB HID scanner | **Phone camera** in the mobile stock-count app (X34) | |
| Power | UPS 650–850 VA | — | Keeps the PC, printer and router alive during short power cuts |
| Internet | Fibre/ADSL | **4G router with automatic failover** | Makes internet drops practically invisible |

### Printing details
- Logo printed as a bitmap; **Sinhala and Tamil** text rendered as images, since most budget printers have no Sinhala font.
- QR codes on the bill for feedback, the e-bill link, or PayHere payment.
- Configurable chit formats: large fonts, modifiers indented, allergy lines in **reverse/bold** (X14).
