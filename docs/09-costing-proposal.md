# 09 — Running-Cost Plan & Client Proposal

> Prepared 30 Oct 2026. Cloud and messaging prices are **list prices or reported rates that can change**. Re-check them in the [Google Cloud pricing calculator](https://cloud.google.com/products/calculator), on [Meta's WhatsApp pricing page](https://developers.facebook.com/docs/whatsapp/pricing) and on [payhere.lk/fees](https://www.payhere.lk/fees) before signing. Hardware prices change weekly in the local market, so get 2–3 quotes.

## 1. What the client pays for, and who pays

| Item | Paid by | Type |
|------|---------|------|
| Google Cloud / Firebase usage (Blaze pay-as-you-go plan, billed to the **manager's Google account**) | Client | Monthly, usage-based |
| WhatsApp Business Platform messages (billed by Meta to the client's Meta Business account) | Client | Monthly, per message |
| Payment processing fees (bank, LankaQR, PayHere) | Client | Per transaction, deducted at settlement |
| Hardware | Client | One-off |
| Internet (fibre + 4G backup data) | Client | Monthly (existing plans) |
| Software licence / subscription, setup and support | Client → you | See §6 |

## 2. Cloud running cost (Firebase, `asia-south1` Mumbai)

**Assumptions for one restaurant:** 1–2 terminals, about 250 bills a day, 3 managers using Insights, inventory module on.

| Service | Free allowance (per project) | Estimated usage | Est. cost / month |
|---------|------------------------------|----------------|-------------------|
| Firestore reads | 50,000 / day | ~20–40k / day | USD 0 – 1 |
| Firestore writes | 20,000 / day | ~4–6k / day | USD 0 |
| Firestore storage | 1 GiB | < 1 GiB in year 1 | USD 0 |
| Cloud Functions (accounting ledger and audit trail) | 2 M invocations / month | ~50–150k | USD 0 |
| Hosting (EMC, Insights, QR menu) | 10 GB stored, 360 MB/day transfer | Small | USD 0 |
| Cloud Storage (logos, PDFs, Excel exports) | — | 1–2 GB | USD 0.05 – 0.10 |
| Cloud Scheduler | 3 jobs per billing account | 2–3 jobs | USD 0 |
| Secret Manager, App Check, Artifact Registry | Small free tiers | Small | USD 0 – 1 |
| **Total cloud** | | | **≈ USD 1 – 5 / month** |

A **budget alert** is set at USD 10/month, so the manager is emailed long before anything unexpected becomes expensive. Firestore is billed per operation, so cost grows with business volume, not with time.

*For your SaaS later:* about 20 restaurants on one shared project come to roughly **USD 25–40/month in total, ≈ USD 1.5–2 per restaurant**. That is the basis of a healthy subscription margin.

## 3. WhatsApp reports

| Item | Cost |
|------|------|
| Meta Business account, business verification, WhatsApp Cloud API access | Free (direct with Meta, **no reseller/BSP fee**) |
| Dedicated phone number (a new SIM not used on the WhatsApp app) | Cost of a SIM |
| End-of-day reports: 4 reports (Daily Revenue, Item-wise, Covers, Sales) as **one PDF** per manager per day | 1 utility message each |
| Estimate: 3 managers × 30 days + about 100 alert messages (X18) ≈ 200 messages/month × reported Sri Lanka utility rate **USD 0.002–0.011** | **≈ USD 0.40 – 2.20 / month** |

Set-up steps for the client: create a Meta Business account, complete business verification (business registration documents), and register the number. Approval of the message templates usually takes a few days, which is why this should **start this week**.

## 4. Payment processing (largest running cost; choose wisely)

Illustration: **Rs 3,000,000 per month of non-cash sales**.

| If all of it went through… | Rate | Monthly fees |
|-----------------------------|------|--------------|
| PayHere Lite | 3.30% | Rs 99,000 |
| Bank card terminal (assumed MDR 2.5%; get quotes) | ~2.5% | Rs 75,000 |
| LankaQR (assuming 60% of the value is in bills ≤ Rs 5,000) | 0% ≤ Rs 5,000, ≤ 1% above | ≈ Rs 12,000 |

**Recommendation:**
- **Promote LankaQR at the counter**, with the card terminal for cards.
- Keep **PayHere for online and QR pay-at-table only**.
- PayHere Lite has no monthly fee, so it costs nothing when unused.

## 5. Hardware (one-off; buy locally, get quotes)

| Package | Contents | For |
|---------|----------|-----|
| **Starter** | Existing or basic Windows 10/11 PC + budget 80 mm ESC/POS printer (Xprinter/Rongta) + RJ11 cash drawer | Cafés, small takeaways |
| **Standard** (recommended for this client) | 15.6" Windows 11 touch all-in-one POS + **Epson TM-T82III (USB+Ethernet)** + cash drawer + UPS 650–850 VA + 4G failover router | Typical restaurant |
| **Plus** | Standard + kitchen printer (Ethernet) **or** KDS (Android TV box + TV) + customer display + NFC staff-card reader | Busy dine-in with a separate kitchen |

## 6. Suggested commercial model (for you to price)

This structure fits both this first client and future clients:

| Line | Suggested structure |
|------|---------------------|
| One-time setup | Onboarding: menu and recipe loading, tax and bill configuration, printer setup, staff training, go-live support |
| Monthly subscription | Per outlet, includes 1 POS terminal, EMC, People Management, Insights and EOD WhatsApp reports |
| Additional terminal | Per terminal per month |
| Add-on modules | **Inventory** (recipes, FIFO, purchasing, mobile stock count) · **QR Ordering & Pay** · **Accounting** (full general ledger, audit trail and auditor exports) · Website/online ordering (future) |
| Support | Standard (business hours) or Premium (7 days, with remote monitoring alerts, X38) |

*For this client:* the Firebase project lives in **their** Google account, so they pay Google directly, and your fee covers software, setup and support. For future clients you can either do the same or host them as tenants on **your** platform project and include cloud costs in the subscription. The software supports both.

## 7. Client responsibilities and set-up checklist (start now)
- [ ] Create the Google account (owner/manager). Enable Firebase **Blaze** with a billing card and add the developer as a project member.
- [ ] Business details: registered name, address, **TIN / VAT and SSCL registration status** (see [06](06-sri-lanka-compliance.md)).
- [ ] Brand assets: logo (SVG/PNG), colours, bill header and footer text.
- [ ] Menu with prices, modifiers and recipes (Excel template provided).
- [ ] Bank: merchant account, **LankaQR** merchant QR and card terminal quotes.
- [ ] PayHere merchant account (Lite plan); needs BR certificate and bank details.
- [ ] Meta Business account and WhatsApp number (for EOD reports).
- [ ] Hardware purchase (Standard package) and internet with 4G backup.
