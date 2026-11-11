# 21 — Security and reliability review (before the first client)

A review of the whole Cloud Restaurant Edition before its first client go-live. It covers:

- security rules and server functions;
- sign-in and PIN handling;
- the web app and its dependencies;
- offline behaviour, error handling and scalability;
- the release process.

It lists what was found, what was changed, the risk that remains, and the checklist for each go-live.

## 1. Findings and fixes

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | Employee PIN hashes and card numbers were stored on staff records, which every login of the business can read. A 4–6 digit PIN hash is cracked in seconds, so any back-office login could impersonate a manager on the POS. | **Fixed.** Hashes and card numbers are in `staffSecrets`, which no client can read (rules). PINs and cards are checked by the `posAuth` Cloud Function. Old records are moved on first use, by migration 0002, or from System status. Audit events hide them. |
| 2 | **High** | Manager approvals tried one PIN against every eligible manager, with no lockout, so approval PINs could be guessed at the till. A card swipe alone approved, and card numbers were readable. | **Fixed.** The approver taps their name (or swipes) and enters their PIN. It is checked on the server, and wrong PINs count towards that employee's lockout. Card numbers are checked on the server. |
| 3 | **High** | Anyone could create an account on a client's site and then create businesses in the client's project (cost, abuse). | **Fixed.** The first business claims the deployment (`deployment/config`). After that only its owner, listed creators, owners and administrators of an existing business, or platform admins can create businesses. Migration 0001 claims existing projects. |
| 4 | **High** | Invitations were accepted by email match without proof of owning the address: someone who registered the invited address first got the access. | **Fixed.** The rules require a verified email to accept an invitation. The app sends the verification email at sign-up and asks for it before accepting. |
| 5 | Medium | No security headers: no Content-Security-Policy, framing allowed (clickjacking), no HSTS. | **Fixed.** Strict CSP (no inline scripts, no eval), `frame-ancestors 'none'`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HSTS. Verified on the production build with no violations. The same headers apply to `pnpm demo`. |
| 6 | Medium | Dependency advisories: React Router open-redirect/XSS (high), zod memory exhaustion (high), grpc-js (high, Print Agent), uuid (moderate, server library). | **Fixed:** React Router 7.18, zod 4.6 (no runtime code generation), grpc-js ≥1.13.6. **Accepted:** uuid inside Google's server library; the advisory needs a caller-supplied buffer, which that library doesn't use. |
| 7 | Medium | Every write waited for the server, so **Pay** and **Send** froze when the internet dropped, although the device can queue writes. | **Fixed.** Writes wait at most a few seconds (none offline); the device keeps them and syncs on reconnect. A later refusal is reported and shown. An offline notice explains what still works. |
| 8 | Medium | With PIN checks on the server, nobody could sign back in during an outage. | **Mitigated.** After a successful online check, the device keeps its own salted hash of that employee's PIN for 7 days, for offline sign-in on that device only. Five wrong offline PINs erase it. |
| 9 | Medium | An unexpected error in a screen left a blank page (a blank POS during service). No error was reported. | **Fixed.** An error screen offers Reload and Start again. Errors are reported to `clientErrors` (System status). |
| 10 | Medium | The same workstation open on two devices produces duplicate invoice numbers. The rules refuse the duplicate, but the bill then fails to close. | **Mitigated.** Devices report to `deviceStatus`; a warning shows when a workstation is open on a second device. |
| 11 | Low | The Excel library (270 KB compressed) loaded on every screen, including phones. | **Fixed.** It loads only for export and import; first load is 724 → 453 KB compressed. |
| 12 | Low | Each client needed a separate build with its Firebase settings, a source of mix-ups (a build pointing at the wrong project). | **Fixed.** One build for all; settings are read from the client's hosting at start-up. The release tool refuses a build that contains a Firebase key. |
| 13 | **High** | Staff phones over the internet needed one POS terminal login per device, each with its own verified mailbox; in practice one password would be shared and typed into every phone, and a leaver's or lost phone couldn't be cut off without signing out every phone. | **Fixed.** Devices are connected with a one-time code (8 characters, single use, 15 minutes, stored only as a hash and unreadable to clients). Each device gets its own login with the POS terminal role, created by the `deviceApi` function; nobody sees its password. **Remove** deletes that one login at once. The rules keep a connected device a POS terminal (it can't be promoted). |
| 14 | Medium | No way to reset a forgotten back-office password except in the Firebase console. | **Fixed** (1.1.1). Forgot password? sends a reset link; the answer doesn't reveal whether an address has an account. New passwords need 10+ characters; the deployment manual sets the Firebase password policy. |
| 15 | Medium | Bills printed "Powered by POS Suite (demo)" in real businesses: new businesses took the demo restaurant's default. | **Fixed** (1.6.0). The default is "Polymath Tech"; migration 0004 corrects existing businesses (a name the business typed itself is kept). |
| 16 | Low | Deploying updates needed the Google Cloud CLI and a second, long-lived sign-in on the vendor's PC (application default credentials). | **Fixed** (1.6.0). The release tool uses the Firebase CLI's sign-in for backups, data updates and permissions. For data updates it lends that sign-in to the migration process through a temporary file readable only by the user, deleted when the step ends. |

## 2. Remaining risks (accepted, with controls)

| Risk | Why it is accepted | Controls |
|---|---|---|
| **POS devices write invoices, sequences and daily totals themselves.** A person with a terminal login and technical skill could write a false invoice or skip numbers. | Server-side invoicing would make every payment depend on a Cloud Function round trip, and stop sales during outages. | Invoices can't be changed or overwritten (rules). Invoices and the POS journal are hash-chained. **Audit Center → Integrity** and **Numbering** detect gaps, duplicates and alterations, and the hourly sealer timestamps the trail. Run them weekly. |
| A terminal login can clear an employee's lockout (the "Unlock employee" function). | The POS checks the unlock privilege and journals it. | Every unlock is in the POS journal and the exceptions report. |
| Offline PIN copies on devices (finding 8). | Needed to keep trading during outages. | Device-only, salted, 7-day expiry, erased after 5 wrong tries, one device each. |
| No two-step verification inside the app for back-office logins. | Not built yet. | Strong passwords (Firebase password policy). Owners' Google accounts use 2-Step Verification. Remove leavers promptly (Access review). |
| Firebase App Check is not enabled. | Optional; needs a reCAPTCHA key per client. | All data access goes through the security rules and authenticated functions anyway. |
| Cold start: the first PIN check after a quiet period can take 2–4 seconds. | Keeping a function warm costs money. | For busy clients, set `minInstances: 1` on `posAuth` (a few dollars a month). |

## 3. Scalability

| Area | Capacity and limits |
|---|---|
| Database (Firestore) | Each business's data is separate (`tenants/{id}`), and screens read only what they show: open checks, today's checks, date ranges of daily totals. A day's totals document takes one update per closed bill, well within Firestore's per-document rate even at peak. |
| Free tier | 50,000 reads and 20,000 writes per day suit one small to medium restaurant. Busier clients move to pay-as-you-go automatically, with budget alerts (deployment manual, section C). |
| Server functions | Ledger operations: up to 3 instances. PIN checks (`posAuth`): up to 10. Raise them in `apps/functions/src/index.ts` for large clients. |
| Web app | 453 KB compressed on first load, then cached. Assets are immutable, so releases download only what changed. Menu photos are resized to ≤ 400 px. |
| Many clients | Each client has its own project, so load and failures are isolated. Releases go wave by wave ([20](20-release-and-updates.md)). |

## 4. Go-live security checklist

For every client, before the first real bill:

- [ ] The client owns the Google account and Firebase project, with **2-Step Verification** on; you are a member, not the owner.
- [ ] **Budget alert** set (deployment manual, section C).
- [ ] Deployed with `pnpm release:deploy`. `version.json` is live; seven functions are listed, including `posAuth` and `deviceApi`.
- [ ] `grant-access.sh` run: the **backup bucket** exists and Firestore **delete protection** is on.
- [ ] The **deployment is claimed** by the client's owner: the first business was created by them, or migration 0001 ran. In the Firestore console, `deployment/config` shows their user id and `openSignup: false`.
- [ ] **Authentication → Settings:**
  - password policy at least 10 characters;
  - email enumeration protection on;
  - authorised domains limited to the client's domains.
- [ ] **Google Cloud → Credentials:** the browser API key is restricted to the client's site addresses (HTTP referrers).
- [ ] Every POS phone, tablet and PC is **connected with a one-time code** (its own login, removable on its own); the Print Agent has its own POS terminal login with a strong password. Nobody uses an owner login on a till.
- [ ] Phones of leavers, lost phones and phones not seen for weeks are **removed** (monthly access review).
- [ ] Every employee has their own PIN; no demo employees in the real business. **System status → Employee PINs** shows **Secure**.
- [ ] The licence is activated with **your** licence key (not the demo key).
- [ ] **Audit Center → Integrity** and **Data quality** are clean after the dry run.

**Every month:**

- Integrity and Numbering checks.
- Exceptions by employee.
- Access review: remove leavers from Back-office logins and end their employee records.
- System status: device versions and errors.
