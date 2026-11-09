# Changelog

Every release, newest first. The "For clients" part is what you send to clients as release notes.

## 1.2.0 — 2026-11-09

**Type:** Minor (new features) · **Deploy:** functions (new `deviceApi`), security rules, hosting

### For clients

- **Staff can use the POS on their own phones over the internet.** A manager connects each phone once: POS Configuration → Workstations & printers → **Connect a phone** shows a QR code; the phone scans it and opens the POS. No passwords to share.
- **Connected phones and tablets** lists every device and when it was last seen. **Remove** cuts off a lost phone or a leaver's phone at once.
- A phone's workstation can be created while connecting it; the licence's workstation limit is now checked when workstations are added.

### Changes

- `deviceApi` Cloud Function: one-time pairing codes (8 characters, single use, 15 minutes, stored as SHA-256 hashes and unreadable to clients); each device gets its own POS terminal login; revoke deletes it. Used codes are cleared hourly.
- Rules: `devicePairings` closed to clients; connected devices can't be promoted from POS terminal.
- `/pair` page on the phone; a removed phone shows *This phone is no longer connected*; the sign-in screen points restaurant phones to their code; terminals open straight into the POS.
- Back-office logins and the licence's user count no longer include devices.
- Deployment manual re-validated for phones over the internet (sections A, G, K, M, O, P, Q, R, U, V and an overview); user, training and security docs updated; Noura Kitchen plan: Professional licence (12 workstations) for staff phones.
- Tests: emulator test for pairing, rules tests, and `pnpm test:pairing` (browser, against the emulators).

## 1.1.1 — 2026-11-09

**Type:** Patch

### For clients

- **Forgot password?** on the sign-in screen: enter your email to receive a link to choose a new password.
- New back-office passwords need at least 10 characters.

### Changes

- Password reset by email (Firebase), without revealing which addresses have accounts; clearer sign-in messages (too many attempts, invalid email).
- Deployment manual: the web config no longer needs copying (read from Hosting); Firebase password policy, public-facing name and email templates; custom domain recommended.

## 1.1.0 — 2026-11-08

**Type:** Minor (new features) · **Data migration:** 0003 adds account 3900 *Opening balances (temporary)* to existing businesses

### For clients

- Photograph or scan paper bills (Finance → Bills & receipts) and keep them with expenses, supplier bills, payments, journals and goods receipts. Every file keeps a fingerprint, so it can't be changed afterwards.
- Record an expense in one simple form (supplier, what it was for, amount, how it was paid), and enter a day of handwritten bills as daily sales.
- Bring your existing books in from Excel: opening balances, opening stock, suppliers and customers with what they owe, supplier bills, expenses, daily sales and fixed assets. An example workbook shows what goes where, and everything is checked before it is saved.
- Stock counts have a type: opening stock, kitchen usage (for businesses without POS sales) or a regular count. Stock received, counted or wasted reaches the books at once.
- Accountants can keep suppliers and customers without the Purchasing or Customers modules.
- A Setup checklist shows what your business still needs, and a new configuration guide explains each setting.

### Changes

- Attachments (photos resized, PDFs up to 10 MB) stored with SHA-256 fingerprints; security rules make them immutable and removable only from the inbox by administrators.
- Accounting workbook (`@pos/excel`): build, row-level checks and an idempotent import through the ledger; 3900 cleared to retained earnings; asset register continues depreciation from the start date.
- Starter set-up for new businesses (outlet, roles, tenders, reason codes, store, chart of accounts, cost centres) and the Setup checklist.
- Stock count kinds (`usage` to cost of sales, `opening` to 3900); stock-only days listed and postable on the Finance overview; storekeepers may post a day's stock.
- Finance: Record an expense, Daily sales, Bills & receipts, Suppliers, Customers, Excel import; voucher numbers now shown after posting.
- Docs: configuration guide (PDF), user and training manual updates, Noura Kitchen onboarding plan; Excel templates in `templates/`.

## 1.0.0 — 2026-11-08

**Type:** First release for client deployments

### For clients

- Phone and tablet POS app in two styles (Bright and Indigo), chosen by your administrator.
- Bill designer: choose what your bills print, with a preview.
- Stronger security: PINs are checked by the server, and too many wrong PINs lock an employee, also for manager approvals. Approvers now tap their name (or swipe their card) and enter their PIN.
- The POS keeps working through short internet drops and shows a notice while offline.
- Screens show when a new version is available and update themselves when nobody is signed in.

### Changes

- Mobile POS styles, bill designer, POS options, user and training manuals.
- Server-side PIN and card checks with lockout; secrets unreadable to clients; business creation restricted; verified email for invitations.
- Security headers (CSP, HSTS…); dependency updates (React Router 7, zod 4).
- Offline-tolerant writes, error screen and error reports, device status, System status page.
- One build for every client; version.json and update banner; release pipeline with backups and data migrations.
