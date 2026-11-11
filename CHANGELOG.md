# Changelog

Every release, newest first. The "For clients" part is what you send to clients as release notes.

## 1.4.0 — 2026-11-11

**Type:** Minor (new features and fixes) · **Deploy:** hosting only (no rule, function or data changes)

### For clients

- **Kitchen tickets and bills from one printer.** *Send KOT* sends the order and prints the kitchen ticket at once. With no kitchen printer, the ticket prints on the counter's own printer (Bluetooth or network), the same one as the bills; the bill and the cash drawer come only at payment. A lost ticket can be printed again from the order (*Print kitchen ticket again*, marked REPRINT). POS options → *Print a kitchen ticket (KOT) when an order is sent* (on by default).
- **The app look on PCs and tablets too, each with its own layout.** Phones keep the bottom bar. PCs and landscape tablets get a side navigation rail, the menu with the order always beside it (*Send KOT* and *Pay* at hand), more dishes per row, payment with the order, methods and amount side by side, and option sheets as dialogs. New businesses use the app style on every screen; existing businesses keep their choice (POS Configuration → Mobile app style → *Every screen*).
- **Easier to read everywhere.** Text and status colours were checked on every POS and back-office screen at phone, tablet and PC sizes, in Bright, Indigo, light and dark, and darkened where needed (grey text, green/orange/red statuses, allergen notes, white text on blue).

### Changes

- KOT routing: the dish's bar or kitchen printer, then the kitchen printer, then the sending workstation's bill printer; the *print KOT on send* setting is honoured on the terminal and in the app; *Send KOT* / *Reprint KOT* on the terminal; reprints recorded in the transaction journal.
- Wide app layout from 960 × 540: navigation rail, order panel, split payment, dialog sheets, container-query columns (4 to 6 dishes per row); sales charts sized to the screen so labels stay small; reports in two columns; payment-success buttons centred.
- Colour tokens to WCAG AA (4.5:1 text, 3:1 large text): app muted, good, warn, bad and accent-2 colours; back-office secondary text, status colours in dark mode, brand-coloured text (`--brand-text`) readable for any brand colour; dish-initial tiles darkened; decorative icons hidden from assistive tech.
- **Fix:** settings pages (Business & tax, Branding, Integrations, Finance settings) could save the built-in defaults over the business's settings when opened directly (refresh or link) before the settings had loaded. In a new business this set the demo's cost centre and stopped the opening-balances journal from posting. Pages now wait for the settings and follow saved values until edited.
- Tests: `pnpm test:contrast` (every visible text on 190+ screens against its real background), `pnpm test:golive` (a Noura Kitchen-style rehearsal from an empty business: settings, menu, staff, phone with a Bluetooth printer, Send KOT, reprint, standard bill, drawer, X report, POS day posting, accounting workbook import, trial balance amounts, audit checks), e2e for Send KOT and REPRINT on the shared printer and the PC/tablet layout.
- Docs: user manual (sections 3.4, 4, 6.2, 6.3, 6.7), training 01–03, deployment manual O.4, Noura Kitchen plan (one printer for kitchen tickets and bills).

## 1.3.0 — 2026-11-11

**Type:** Minor (new features) · **Deploy:** hosting only (no rule, function or data changes)

### For clients

- **One phone and a Bluetooth printer, no PC.** A small restaurant can print bills, kitchen tickets and reports, and open the cash drawer, straight from its phone to a Bluetooth receipt printer beside it (for example an Xprinter XP-T80Q). No Print Agent or network printer needed. The phone's printer button connects the printer, makes a test print and shows prints waiting while the printer is off.
- **Tax invoice or standard bill.** Bill designer → *Print the final bill as a TAX INVOICE*. Businesses not registered for VAT or SSCL print a standard bill (Bill No, date and time, items, service charge, total) with no TIN or tax-invoice wording.

### Changes

- Workstation printing *Bluetooth printer next to this phone or tablet*: from the browser (Web Bluetooth, Chrome on Android, Bluetooth LE printers; common printer services such as 18F0 and Xprinter's E7810A71; small-packet fallback) or through the RawBT app (Android, classic Bluetooth); paper width; kitchen tickets on the same printer. Set when connecting a phone or on the workstation. Prints wait on the phone while the printer is off and print on reconnect.
- iPhone: explained in the app (Bluefy browser) since Safari and Chrome on iOS have no Web Bluetooth.
- Standard bill: *Bill No* and *Date* instead of the tax invoice's invoice/supply dates; no TIN; tax invoice only for VAT-registered sellers (switch on by default), and always for a VAT-registered buyer.
- One paper-width rule for all POS printing (bills, tickets, X/Z, reports, reprints).
- Docs: hardware Model C (one phone + Bluetooth printer), deployment manual O.4, user manual, configuration guide, training, Noura Kitchen plan (XP-T80Q, standard bill, Starter licence with add-ons enough for one phone).
- Tests: printing (standard bill, switch off, business buyer), validation, and e2e with a simulated XP-T80Q over Web Bluetooth (20-byte packets): connect, test print, kitchen ticket, bill and drawer kick.

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
