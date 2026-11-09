# 10 — Firebase setup that stays inside the free tier

This guide covers your **demo / development project** (Blaze plan). Use the same settings when you deploy to a client's own Firebase project.

> Prices and free quotas are Google's and can change. Check the [Firebase pricing page](https://firebase.google.com/pricing) before relying on any figure below.

## 1. What this system uses, and what it deliberately avoids

The build runs on **Firestore + Authentication (email/password) + Hosting + a few small Cloud Functions** (for the accounting ledger and the audit trail). All of them have generous daily or monthly no-cost quotas, even on the Blaze plan.

| Firebase product | Used? | Why it stays free |
|------------------|-------|-------------------|
| **Cloud Firestore** (the `(default)` database) | ✅ | Free daily quota (about 50,000 reads, 20,000 writes, 20,000 deletes and 1 GiB stored). A demo day uses a small fraction (see §5). |
| **Authentication** (email/password) | ✅ | Email/password sign-in has no per-user charge for normal Firebase Auth. **Do not enable phone/SMS sign-in or SMS MFA**: SMS is charged per message. |
| **Hosting** | ✅ | Free quota (about 10 GB stored and 360 MB transfer per day). The app is about 0.6 MB gzipped. |
| **Cloud Functions** (2nd gen) | ✅ licence activation, audit trail and (with Accounting) the ledger | Seven functions: `ledgerApi` (posting, approvals, period close, integrity check), `auditTrail` and `auditTenant` (record every change), `auditSealer` (hourly; also clears old device codes), `licenceApi` (licence activation, rarely called), `posAuth` (employee PIN checks), `deviceApi` (connecting and removing phones, rarely called). Free quota: about 2 million invocations a month plus compute time. A restaurant uses tens of thousands. They run at **0 minimum instances**, 256 MiB, max 3 instances. Deploying also uses **Cloud Build** (free build minutes), **Artifact Registry** (0.5 GB free; set the clean-up policy in §2), **Eventarc** (Firestore triggers) and **Cloud Scheduler** (3 free jobs per billing account; the sealer uses 1). |
| Cloud Storage | ❌ not used | Logos are resized and stored inside Firestore settings (≤ 360 px), so no Storage bucket is needed. |
| Realtime Database, Extensions, BigQuery export, Vertex AI / Gemini, Test Lab, App Hosting | ❌ | Not needed. Leave them off. |

The PayHere, LankaQR and WhatsApp integrations run in **mock mode**, which makes no external calls. When a client goes live with them, the server-side parts (PayHere notify URL, WhatsApp sending) will be added as more functions within the same quotas.

Deploy the functions for every client: licence activation and the server-side audit trail need them, and they stay inside the free quotas. (A deployment without functions still runs the POS and back office, but can't activate a licence, so it stays on the 30-day trial, and changes are not audited server-side.)

## 2. Settings to turn on (one-off, about 15 minutes)

1. **Budget alert (essential)**
   - Google Cloud Console → *Billing* → *Budgets & alerts* → *Create budget*.
   - Scope: this project. Amount: **USD 1**.
   - Alert thresholds: 50%, 90% and 100% of actual spend, emailed to you.
   - A budget **does not stop** spending. It warns you early enough to react.
2. **Firestore database**
   - Firebase console → *Firestore Database* → create the **`(default)`** database in **Native mode**.
   - Location: use `asia-south1` (Mumbai) for Sri Lankan clients. Any location works for the demo. The location cannot be changed later.
   - The free quota applies **only to the `(default)` database**. Do not create additional named databases.
3. **Authentication** → *Sign-in method* → enable **Email/Password** only.
4. **Usage monitoring**
   - Firestore → *Usage* tab: shows reads and writes per day against the free quota.
   - Cloud Console → *Billing → Reports*: filter by this project, and check it shows USD 0.00.
5. **Cloud Functions settings** (before the first `pnpm firebase:deploy`)
   - Copy `apps/functions/.env.example` to `apps/functions/.env`. Set `LOCATION` to **the same region as your Firestore database** (for example `asia-south1`). Set `VITE_FUNCTIONS_REGION` in `apps/web/.env.local` to the same value. Firestore triggers must run in the database's region.
   - Set the Artifact Registry clean-up policy once per project and region, so old build images are deleted. The first deploy usually offers it: answer yes. If it doesn't, run this **after** the first deploy (the image repository only exists from then):
     `pnpm exec firebase functions:artifacts:setpolicy --location asia-south1 --days 1`
   - Leave **minimum instances at 0** (the code sets it). Each warm instance kept alive is billed.
   - Do not enable "Retry on failure" for the triggers.
6. **Firestore TTL policy** (keeps the print queue from growing)
   - Firestore → *Time-to-live* → add a policy on collection group **`printJobs`**, field **`expireAt`**.
   - `firebase deploy --only firestore` also applies it from `firebase/firestore.indexes.json`.
   - TTL deletes count against the free delete quota.

## 3. Settings to leave OFF

- **Point-in-time recovery** and **scheduled backups** for Firestore (both billed). For a demo, use *Export to Excel* instead.
- **Identity Platform upgrade** (only needed for SAML/OIDC or SMS MFA).
- **Phone authentication**.
- **Multiple Firestore databases**.
- **Cloud Functions min instances** (keep `minInstances: 0`) and **more than 3 scheduled jobs per billing account** (Cloud Scheduler bills each job above 3).
- **Firebase Extensions** (each one deploys billable resources).
- **App Check with reCAPTCHA Enterprise** above its free assessment allowance. It is optional for a demo.

## 4. Optional hard stop on spending

If you want a guaranteed cap, Google documents a pattern where a budget publishes to Pub/Sub and a small function **disables billing** on the project once the budget is reached ([Cloud Billing docs: "Disable billing usage with notifications"](https://cloud.google.com/billing/docs/how-to/notify#cap_disable_billing_to_stop_usage)).

This works, but it **shuts the project down** until billing is re-enabled. Use it only on the demo project, never on a live client.

## 5. Expected usage of a demo

| Action | Firestore reads | Firestore writes |
|--------|-----------------|------------------|
| Create a business with the demo restaurant (≈ 700 documents, written in small batches) | ~100 | ~700 |
| Open the dashboard | ~150 (open checks, stock, settings) | 0 |
| Open a report for 7 days | 7 (one aggregate document per day) + reference data | 0 |
| Sell one check (send, pay, close) | ~5 | ~6 (check, invoice, numbering, day totals, customer) |
| End of Day with stock deduction | ~1 per ingredient used | ~1 per ingredient |
| Post the POS day to the ledger (function) | ~60 (settings, accounts, day totals, movements) | ~25 (document, ledger lines, balances, number) |
| Audit trail (function) | 0 | +1 per changed business record (e.g. a sale adds ~5) |
| POS transaction journal | 25 once per POS start | ~4–6 per check (begin, send, payment, close; voids/discounts when they happen) |
| Item photos | 1 per photo when the POS loads (≈ 30 KB each) | 1 per photo upload |
| Hourly seal (function) | the new events since the last seal | 1 |
| Integrity check (function, on demand) | every voucher, ledger line, invoice and audit event once. Run it monthly, not daily |  0 |

A full day of demos (a few new demo businesses, dozens of page views, 50 test sales) is typically **under 10,000 reads and 3,000 writes**, well inside the daily free quota. The audit trail roughly doubles writes for configuration and sales records; a busy restaurant (300 checks a day) still stays around 5,000 writes a day.

Development needs **no cloud at all**:

- `pnpm dev` with no Firebase config runs in **local demo mode**, with data kept in the browser.
- `pnpm emulators` plus `VITE_USE_EMULATORS=true` runs against the **local Firebase Emulator Suite**, which uses the same rules with zero cost.

Cost-saving choices already built in:
- **Day totals are pre-aggregated.** Reports read one document per day instead of every check.
- **Stock is deducted in batches** (End of Day or the "Deduct sold stock" button): one read and one write per ingredient, not per sale line.
- **Large fields are excluded from indexing** (check lines, invoice totals, print documents) in `firebase/firestore.indexes.json`. This saves index storage.
- **Print jobs expire after 24 hours** through the TTL policy.
- **Logos live in Firestore**, so Cloud Storage is not used.

## 6. When a client goes live (their own Firebase project)

- Repeat §2 in the client's project, with the budget alert sent to the client's billing contact.
- For one restaurant, Firestore, Hosting and Auth usually stay inside the free tier as well. The estimate is in [09-costing-proposal.md](09-costing-proposal.md).
- Cloud Functions: repeat §2 step 5 (same region as Firestore, artifact clean-up policy, minimum instances 0).
- Turning on live **PayHere/WhatsApp** adds a few more functions within the same free quotas.

## 7. Commands

```bash
# one-off
pnpm install
npx firebase login
npx firebase use --add          # pick your demo project, alias "demo"

# deploy the web app, security rules, indexes and functions (no Storage)
cp apps/web/.env.example apps/web/.env.local          # paste the Firebase web config
cp apps/functions/.env.example apps/functions/.env    # LOCATION = your Firestore region
pnpm firebase:deploy
pnpm exec firebase functions:artifacts:setpolicy --location asia-south1 --days 1   # after the first deploy, if it didn't ask
```
