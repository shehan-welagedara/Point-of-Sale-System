# Changelog

Every release, newest first. The "For clients" part is what you send to clients as release notes.

## 1.9.0 — 2026-11-12

**Type:** Minor (the back office on phones) · **Deploy:** web app (`pnpm release:deploy`); no data updates

### For clients

- **Run the restaurant from your phone.** On a phone the back office now works like an app, with tabs at the bottom: **Today**, the two places you use most, **Tasks** and **More**.
- **Today** shows today's sales against the same day last week, the last 14 days, checks and covers, the month against its target, today's best sellers, and one-tap actions such as Record expense, Snap a bill, Receive goods and Stock count.
- **Tasks** (and the bell at the top) lists what needs you: documents to approve, bill photos to record, deliveries to receive, items running low, checks left open from an earlier day, and licence or supplier messages. Tap one to go straight to it.
- Lists show one clear row per item, with a **+ New** button at the bottom; reports have one-tap periods (Today, Yesterday, Last 7 days, Last 30 days); bill photos open the camera directly.
- **Add it to your home screen** (Safari: Share → Add to Home Screen; Chrome: Install) and it opens full screen, straight to Today. Phones connected as POS devices still open the POS.
- On computers and tablets nothing changes.

### Changes

- Back office phone layout (screens up to 600 px; `pages/emc/Phone.tsx`, `phone.css`): top bar with the module, a tasks bell and your initials; module pages as swipeable pills; bottom tabs by role (owners and managers: Reports, POS; accountants: Finance, Reports; storekeepers: Stock, Menu; auditors and viewers: Reports, Finance); a More sheet with every module, your account and About.
- New pages on every screen size: **Tasks** (`/emc/tasks`) and **Account** (`/emc/account`: acting-as in the demo, switching business, licence, sign out).
- Phone lists: `CrudPage` (menu, staff, customers, suppliers, tenders and the rest), voucher lists (journals, approvals, payables, receivables), stock on hand and the reports (daily revenue, item-wise, covers, checks) read as compact rows; a floating **+ New**; report periods as chips with **Dates…** for a custom range; tables that stay tables scroll with the first column pinned; full-screen editors with **Save** pinned at the bottom.
- Touch: 44 px buttons and 40 px chips and tabs, 16 px inputs (no zoom on iPhone), safe areas for the notch and the home bar.
- Installable app: PNG icons (`tools/web/make-app-icons.mjs`), the manifest starts at `/` (Today for the back office, the POS for connected devices) with shortcuts to Today, Tasks and the POS; iPhone home-screen meta.
- Tests: the end-to-end suite checks the phone back office (Today, tabs, Tasks, More, pills, rows, + New, report chips, account; no sideways scrolling and touch targets of 40 px or more on ten screens); contrast covers Tasks, Account and Journals in light and dark on PC and phone.
- Docs: user manual 2.1 *The back office on your phone* with screenshots; README.

## 1.8.1 — 2026-11-12

**Type:** Patch (release tool; console wording) · **Deploy:** clients as usual; the console (`pnpm console:deploy`) for the wording

### For clients

- Nothing changes in the system restaurants use.

### Changes

- **Release tool: the data updates use plain HTTPS.** They talked to Firestore over gRPC, which needs HTTP/2 all the way to Google; on a Windows PC with antivirus HTTPS scanning or a proxy that breaks, and the deploy stopped with `14 UNAVAILABLE: No connection established … Protocol error` after the backup (nothing else changed). They now use Firestore's REST transport over HTTP/1.1, like the backup and the rest of the tool. A failure is explained in plain words, and the deploy says that nothing else changed and that running it again is safe.
- `pnpm test:update` now reaches the database only through a relay that speaks HTTP/1.1, so a deploy that needs HTTP/2 fails the rehearsal (it fails 1.8.0's tool with the same error; 29 checks).
- **Console:** the banner no longer says *All systems online* when there are no clients or no check-ins yet (*No clients yet*, *Waiting for the first check-in*, or *N of M systems checking in*). The Platform health card stacks its legend under the donut when the card is narrow.

## 1.8.0 — 2026-11-12

**Type:** Minor (Polymath Console redesign and new pages; release QA) · **Deploy:** the console (`pnpm console:deploy`); clients optional (their system is unchanged)

### For clients

- Nothing changes in the system restaurants use. Updating to 1.8.0 is safe and optional; it only shows the new version number on the About page.

### Changes

- **Polymath Console in the Polymath Technologies look** (light lavender and violet, with a matching dark theme): white sidebar with icons, the *Polymath Ecosystem* card and your profile; a top bar with search (Ctrl/⌘ K finds a client by name, town, project or licence), alerts (every client needing attention) and an account menu; a slide-in menu on phones.
- **Overview:** welcome banner with the systems' status; total clients, systems checking in, revenue this month and system health, each with a 30-day trend line; where clients are on a world map and a Sri Lanka map (drawn from Natural Earth, no map library); platform health (healthy, attention, offline, not linked; licences valid, paid, latest version); recent activity; your clients; quick actions.
- **New pages:** Subscriptions (monthly recurring revenue, annual run rate, collected this month, renewals due, overdue, latest payments), Monitoring (every system's check-in: status, version, devices, errors, licence, what to look at), Reports & Analytics (revenue by month, client growth, sales through POS Suite across clients that share figures, versions, editions, plans, industries; every chart also as a table), Support (what clients see, guides, systems needing help, contacts). *Updates* is now *Deployments*.
- Clients have an **industry, town and country**. Fixed: a country typed as a name was stored as its first two letters.
- The console's server writes each day's figures to `metrics/{date}` (morning housekeeping and the `recordMetrics` action). Staff may read every client's payments and usage at once (security rules; a collection-group index for usage).
- **`pnpm console:backup`**: exports the console's database to a bucket in its own project (90-day retention) and switches on Firestore delete protection.
- **Docs:** [23 · Polymath Console deployment and configuration (A to Z)](docs/23-polymath-console-deployment.md); docs/22, docs/18 and the README updated.
- **`pnpm test:update`** (also in CI): rehearses updating a live client end to end with Google simulated: backup with the Firebase sign-in, indexes, the data updates on businesses created on 1.5.8 (only the bill footer changes), rules and functions (the new ones load), the web app and the version check; a second run changes nothing; a failed backup or an unreachable site stops the deploy before anything is touched. The release tool reads `POS_LIVE_BASE` (tests only) for the site address.
- Tests: console unit tests (11), console rules (7), the console end to end (48 checks) and every console screen in light and dark on a PC and a phone, with contrast and screen-width checks (190 checks in all).

## 1.7.0 — 2026-11-11

**Type:** Minor (Polymath Console and the link to it) · **Deploy:** full (new functions `consoleCheckin` and `consoleLinkNow`; security rules)

### For clients

- **About → Polymath Tech: help and support** shows Polymath Tech's phone, WhatsApp, email and website, and when the system last checked in with Polymath Tech. **Check now** checks in at once.
- **Licence renewals arrive by themselves.** When Polymath Tech renews or upgrades your licence, the system picks it up within a day (or at once with Check now); there is no key to paste any more. Pasting a key by hand still works.
- Owners and administrators see messages from Polymath Tech at the top of the back office, such as a renewal reminder a few days before the renewal date.
- **Your choice:** About → *Share daily figures with Polymath Tech* (on by default) sends yesterday's number of bills and covers and the sales totals, nothing about customers, items or staff. Switch it off at any time.

### Changes

- **Polymath Console** (docs/22): Polymath Tech's own system to manage every client, in its own Firebase project. `apps/console` (React) and `apps/console-functions`:
  - clients, with health from each daily check-in (server and device versions, errors, licences, businesses), usage figures, notes and an activity log;
  - licences issued, renewed and upgraded from the browser, signed with the licence key held in Secret Manager; every licence kept;
  - subscriptions and payments, with one-click licence renewal to the new paid-until date and automatic renewal reminders to the client;
  - suspend and restore, with a grace period and a message, delivered as a signed directive;
  - updates started from the console through the GitHub Actions release workflow, with each client's settings from the console;
  - staff with roles (owner, admin, sales, support, engineer), Google or verified-email sign-in, and an audit log of every action.
- **Check-in** (`packages/core/src/link.ts`, `apps/functions/src/console-link.ts`): a daily scheduled function plus *Check now*. The client proves its project with a Google-signed identity token of its own service account, so no secret is shared; the console verifies it (Google keys, audience, expiry) and matches it to the registered project (a new project number is confirmed once by an owner or admin).
- Licences and the active/suspended status are signed with the vendor key and verified by the client with the public key it already has; older directives are ignored (no replay), and a licence is applied only when it is newer than the business's own.
- A suspension past its grace period stops licensed modules like an expired licence (web app and server), and keeps the data. The tenant's `supplier` field is server-only (security rules).
- Release tool: each deploy records `APP_VERSION` and `CONSOLE_URL` for the functions. Release workflow: `registry` and `request_id` inputs, a run name the console can find, and the `CONSOLE_URL` variable.
- New commands: `pnpm console:setup`, `pnpm console:deploy`, `pnpm console:dev`, `pnpm test:console`.
- Tests: console security rules (6), the client's `supplier` field (1), console logic unit tests (10), and an end-to-end run of the console and a client's real check-in code on the emulators.

## 1.6.0 — 2026-11-11

**Type:** Minor (branding, deployment tools, fixes, documentation) · **Deploy:** full (data update 0004 runs)

### For clients

- The system now shows its maker: **POS Suite by Polymath Tech** on the sign-in page, the About page and the manuals.
- **Bills:** the "Powered by" line said *POS Suite (demo)* in businesses set up before this version. It now says **Powered by Polymath Tech**. (If you typed your own text under Administration → Branding, it stays.)
- The auditor's SAF-T file now carries the system's real version number.

### Changes

- `packages/core/src/brand.ts`: product and company names in one place (`PRODUCT_NAME`, `COMPANY_NAME`, `PRODUCT_FULL_NAME`, `DEFAULT_POWERED_BY`), used by the login, the page title, the About page, Excel exports (workbook author), SAF-T and the manual PDFs (cover and footer). New businesses and the demo restaurants default to "Powered by Polymath Tech".
- Migration **0004-powered-by**: replaces exactly "POS Suite (demo)" with "Polymath Tech" in each business's branding; tested on the emulator (`pnpm test:migrations`).
- **Updates no longer need the Google Cloud CLI.** New `tools/release/google.mjs` talks to Google with the Firebase CLI's sign-in: the pre-release backup creates the bucket (90-day retention, Firestore service agent access) and exports the database through the Firestore and Storage APIs, waiting until it finishes; data migrations get the same sign-in through a temporary credentials file (owner-only, deleted after the step). On GitHub Actions the workflow's own credentials are used. `deploy:setup` no longer checks for gcloud.
- `functions-access.mjs` uses the shared module.
- Removed the `pnpm firebase:deploy` script: every deploy goes through `pnpm release:deploy`, including your staging project.
- Full system review: typecheck, unit (93), security rules (24), migrations, functions (6), phone pairing (8), browser end-to-end (67) and go-live rehearsal (25) all pass.
- Documentation re-validated against the system: README (product name, status, printing, commands, layout), getting started (staging and client deploys through the release tool; no web config in builds), Firebase free tier (release tool sets the region and clean-up policy), accounting (deploy), deployment manual (no Google Cloud CLI; the first deploy's permissions check; updates by hand), releases (rollback from the Google Cloud console instead of gcloud), security review (findings 15–16), decisions log (D33 product and company, D34 updates without gcloud), Noura Kitchen plan (deployed).

## 1.5.8 — 2026-11-11

**Type:** Patch (deployment tools) · **Deploy:** hosting only (version number)

### For clients

- No change in the system itself.

### Changes

- New `tools/release/functions-access.mjs` (`pnpm deploy:access --project PROJECT-ID`), run by `release:deploy` before the first deploy of the server functions. Firebase's own step failed every time on a new project with only *We failed to modify the IAM policy for the project* and hid Google's reason. The check uses the Firebase CLI's sign-in (no Google Cloud CLI needed) and, in order:
  - checks that the signed-in account may change the project's permissions (Owner), and says how to fix it if not;
  - switches on the Compute Engine API when it is off, which creates the "Compute Engine default service account" that the server functions run as (new projects don't have it), and waits for that account;
  - creates the Pub/Sub and Eventarc service agents;
  - grants the three roles Firebase needs (Cloud Run Invoker and Eventarc Event Receiver for the compute account, Service Account Token Creator for the Pub/Sub agent), retrying while Google is still creating an account, and printing Google's own reason and the console steps if it refuses.
- Deployment manual U: the permissions row now points to this check.

## 1.5.7 — 2026-11-11

**Type:** Patch (deployment tools) · **Deploy:** hosting only (version number)

### For clients

- No change in the system itself.

### Changes

- `release:deploy` gives Firebase 60 seconds instead of 10 to load the server functions before deploying them (`FUNCTIONS_DISCOVERY_TIMEOUT`). On a Windows PC with antivirus scanning the first load took longer, and the deploy stopped with *User code failed to load. Cannot determine backend specification. Timeout after 10000*.
- First deploy: when the server functions fail, the tool now waits 3 minutes, then 5, and tries twice more (it tried once). On a new project Google creates the service accounts of the services it has just switched on a few minutes later, and Firebase can't grant them their roles until then (*We failed to modify the IAM policy for the project*).
- Deployment manual U: rows for both messages, with a fallback through the Google Cloud console that doesn't need the Google Cloud CLI.

## 1.5.6 — 2026-11-11

**Type:** Patch (deployment tools) · **Deploy:** hosting only (version number)

### For clients

- No change in the system itself.

### Changes

- Deploying from Windows: the server functions were never built, so the deploy stopped with *Could not detect runtime for functions at …\\apps\\functions\\dist*. The Firebase CLI runs `predeploy` commands through cross-env, which on Windows turns every `/` in the command into `\`; `pnpm --filter @pos/functions build` became `@pos\functions`, matched no package, and pnpm still reported success. The predeploy step is now `pnpm run build:functions` (no `/`; new root script).
- `release:deploy` builds the server functions itself before deploying (the dry run too) and stops with a clear message if the build leaves no `apps/functions/dist/package.json` or `index.js`.
- Clearer messages when the functions deploy fails on a first deploy, and a troubleshooting row in deployment manual U.

## 1.5.5 — 2026-11-11

**Type:** Patch (deployment tools) · **Deploy:** hosting only (version number)

### For clients

- No change in the system itself.

### Changes

- `release:deploy` on a fresh copy of the code: it stopped after the indexes with *ENOENT … apps/functions/dist/.env.PROJECT-ID*, because it wrote the functions' per-project settings before Firebase had built that folder. It now creates the folder first.
- First deploy of a new client, without questions: the tool creates the Firebase Hosting site (`PROJECT-ID.web.app`, linked to the project's web app) when the project has none, which the Firebase CLI refuses to do in a scripted deploy; and it passes `--force` to the first functions deploy so Firebase sets the image clean-up policy instead of stopping to ask (a new project has no functions that could be replaced).
- First deploy: when the server functions fail because Google is still giving its services their permissions (*Eventarc Service Agent*), the tool explains it, waits 3 minutes and tries once more.
- Deployment manual G and U: the clean-up policy step is gone (the deploy does it); new troubleshooting rows for the three messages above.

## 1.5.4 — 2026-11-11

**Type:** Patch (deployment tools) · **Deploy:** hosting only (version number)

### For clients

- No change in the system itself.

### Changes

- `deploy:setup` and `release:deploy` start pnpm and gcloud on Windows through one quoted command line (`tools/release/run-cmd.mjs`). Newer Node.js versions (24 and later) printed a `DEP0190` warning that landed on top of the "Create the licence key?" question and hid it.
- `release:deploy --first-deploy`: for a client that has never been deployed, when the PC can't reach `PROJECT-ID.web.app` to check (the deploy says so and suggests it).

## 1.5.3 — 2026-11-11

**Type:** Patch (deployment tools) · **Deploy:** hosting only (version number)

### For clients

- No change in the system itself.

### Changes

- `release:deploy`: the first deploy of a new client needs only the Firebase login. With nothing live yet it skips both the backup and the data updates (migrations, which need the Google Cloud CLI's credentials); the next deploy runs them, and each is safe to run then.
- Safer check of what is live: a deploy is treated as the first only when Firebase Hosting answers 404. Any other answer (no connection, an error page) stops the deploy instead of skipping the backup of a live client.
- `pnpm deploy:setup`: the Google Cloud CLI and its two sign-ins are shown as "needed before the first update", not as blockers. Deployment manual and Noura Kitchen plan updated to match.

## 1.5.2 — 2026-11-11

**Type:** Patch (deployment tools and documentation) · **Deploy:** hosting only (version number)

### For clients

- No change in the system itself.

### Changes

- `pnpm deploy:check`: tests, from Node.js, each Google and Firebase service the deploy needs, and prints the fix for this PC. When `firebase login` fails although the browser works, the cause is usually antivirus HTTPS scanning, a company proxy or a firewall. For a certificate problem it tests whether trusting the Windows certificate store fixes it (`NODE_OPTIONS=--use-system-ca`) and prints the command for Command Prompt and PowerShell. Otherwise it explains `NODE_EXTRA_CA_CERTS`, proxies (it reads the Windows proxy setting), firewalls and DNS. `pnpm deploy:setup` runs the same check first.
- Deployment manual: what to do when `firebase login` fails (E.3 and troubleshooting), and deploying from **Google Cloud Shell** in the browser when the PC can't connect.

## 1.5.1 — 2026-11-11

**Type:** Patch (deployment tools and documentation) · **Deploy:** hosting only (no rule, function or data changes)

### For clients

- No change in the system itself. Installations are simpler for your supplier.

### Changes

- `pnpm deploy:setup`: one command prepares a PC to deploy a client. It checks the tools and sign-ins (and says what to do for each that's missing), creates or reuses the licence signing key, writes `apps/web/.env.production` and `apps/functions/.env`, and registers the client in `release/clients.json`.
- `pnpm release:deploy`: on the first deploy (nothing live yet) it skips the pre-release backup by itself; later it creates the backup bucket (90-day retention) when it is missing, so the access script is only needed for automatic updates from GitHub. Arguments with spaces are quoted on Windows; the licence-key warning only shows when the key is really missing.
- Deployment manual: an overview of the three parts, and sections E (your computer), F (set up the client with one command) and G (deploy) rewritten in plain steps with Windows details. Noura Kitchen plan, licensing and release docs updated to match.
- Branches: `main` is the Cloud Restaurant Edition (deploy from it), `develop` holds work in progress, `enterprise/hotel-suite` the hotel edition; the README explains them.

## 1.5.0 — 2026-11-11

**Type:** Minor (new features and fixes) · **Deploy:** hosting only (no rule, function or data changes)

### For clients

- **Noura Kitchen demo.** *+ Business → Load the Noura Kitchen demo* creates a training copy set up like Noura Kitchen: not VAT or SSCL registered, a restaurant and a takeaway counter, one counter phone with the Bluetooth printer, and an office PC that shows bills on screen. It comes with a Sri Lankan menu with recipes, stock, suppliers, a month of sales and books, so staff and the owner can explore every module before go-live.
- **About this system.** A new **About** tile on the launchpad (owners and administrators) shows the version you are running, whether an update is waiting (with **Update now**), what's new in recent releases, the licence and modules, and where the data is kept.
- **Clearer POS screens in every theme.** On the terminal layout, messages such as *Unknown employee number or card* and *Wrong PIN* were unreadable when the computer was set to dark mode, and a dark band showed under the sign-in screen. Fixed for all three terminal themes (Modern, Classic, Midnight). Buttons and dish tiles now pick white or dark text to suit any brand, accent or category colour.
- **Finance:** when Accounting is switched on after the business was created, the Finance overview asks to **Open fiscal year** instead of showing an empty year.

### Changes

- Sample data: a `noura-kitchen` profile (property `MAIN`, workstations `P01` Bluetooth and `W01` on-screen, cash/card/LankaQR, no VAT on purchases or sales, smaller books) next to Spice Lagoon; unit test for its books, invoices and data health.
- Terminal themes set every colour themselves (status colours, shadows, `--on-brand`, `--brand-text`), so they no longer mix with the device's dark mode; the app styles map the shared colours (dialogs, keypads, notices) to their own palette for the same reason. `readableTextOn` and `deepenForWhite` keep text readable on any chosen colour.
- `pnpm test:contrast` also checks the terminal in its three themes with the device in light and dark mode, the app with the device in dark mode, and error states (unknown employee, wrong PIN), dish choices, discount and payment dialogs: 0 below WCAG AA.
- `release:deploy` works from Windows (pnpm and gcloud started through the shell), builds the web app first when run by hand, and explains a missing Google Cloud CLI or login. Noura Kitchen plan: deployment steps for a Windows PC.
- e2e: the Noura Kitchen demo (modules, not VAT registered, balanced books, standard bill on the office PC), the About page, and opening the fiscal year when Accounting is switched on later.

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
