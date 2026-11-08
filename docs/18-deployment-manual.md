# 18 — Client deployment manual (A to Z)

This manual takes one client from nothing to live trading on the **Cloud Restaurant Edition**: a new Google account and Firebase project, installation, configuration, staff training and go-live. Follow it in order and tick each box.

> **Who does what:** **You** are the vendor (installer). **The client** is the restaurant owner or manager. The client owns the Google account, the Firebase project and the billing; you are added as a member to install and support it.
>
> Google changes its console screens from time to time. If a menu name differs slightly, look for the nearest match. The steps stay the same.

## Contents
- A. Before you start
- B. Client's Google account and Firebase project
- C. Billing, budget alerts and cost safety
- D. Firebase services: database, sign-in, web app
- E. Your computer: tools and the code
- F. Configure the deployment
- G. Deploy
- H. First sign-in and the client's business
- I. Licence key
- J. Business, tax and branding
- K. Outlets, workstations, printers and payments
- L. Menu, recipes and stock (Excel)
- M. People, roles and sign-in
- N. Finance (if licensed)
- O. Devices in the restaurant and the Print Agent
- P. Training and the dry run
- Q. Go-live day
- R. After go-live: daily, weekly, monthly
- S. Updating the system
- T. Custom domain (optional)
- U. Troubleshooting
- V. Hand-over checklist

---

## A. Before you start

Collect from the client:

| Item | Example |
|---|---|
| Registered business name, trading name, address, phone | Lagoon Café (Pvt) Ltd, "Lagoon Café" |
| TIN (9 digits); VAT registration status; SSCL liability | 123456789; VAT registered; SSCL not liable |
| Service charge %, prices inclusive or exclusive of taxes | 10%; exclusive |
| Logo (PNG or SVG), brand colours | |
| Outlets / revenue centres, counters and tablets, printers | 1 outlet; restaurant + takeaway; 1 counter PC + 2 tablets; bill printer + kitchen printer |
| Menu with prices, modifiers, recipes; stock items; suppliers | Use the Excel data feeder (section L) |
| Staff list: names, jobs, who may void, discount, refund | |
| Bank for cards, LankaQR merchant ID (when approved) | |
| Edition and modules bought | Professional + Accounting |
| An email address the client will own for the system | it@lagooncafe.lk (or a new Gmail) |

Hardware ready at the site:
- **Counter PC:** Windows 10/11 with a touch screen, Chrome or Edge, internet.
- **Bill printer and kitchen printer:** ESC/POS, for example Epson TM-T82III.
- **Cash drawer** connected to the bill printer.
- **Optional tablets** (Android or iPad).
- **A UPS**, and a 4G router as backup internet.

See [11](11-hardware-and-printing.md).

---

## B. Client's Google account and Firebase project

1. **Google account.** Sit with the client and create (or use) the Google account that will own the system. Turn on **2-Step Verification** at myaccount.google.com → Security. This account controls everything, so protect it.
2. **Create the Firebase project.**
   1. Open **console.firebase.google.com** and sign in with the client's account.
   2. Click **Create a project** (or **Add project**).
   3. Name it after the client, for example `lagoon-cafe-pos`. Firebase shows the **project ID** under the name; write it down. You will use it everywhere.
   4. Turn **Google Analytics off** (not needed), then **Create project**.
3. **Add yourself as a member** so you can install and support it from your own account:
   1. Open the ⚙ gear → **Project settings** → **Users and permissions** → **Add member**.
   2. Enter your email and give the role **Editor**. Use **Owner** only if you will also manage billing.
   3. Accept the email invitation.

- [ ] Client account has 2-Step Verification
- [ ] Project created; project ID recorded: `______________`
- [ ] You are a member (Editor)

---

## C. Billing, budget alerts and cost safety

Cloud Functions (licence activation, audit trail, accounting) need the **Blaze** (pay-as-you-go) plan. A restaurant normally stays inside the free quotas and pays **USD 0**, but Blaze needs a billing account and a card ([10](10-firebase-free-tier.md)).

1. In the Firebase console, at the bottom left, click **Upgrade** → choose **Blaze**.
2. Create a billing account in the **client's name** with the client's card. Choose Sri Lanka and the client's details.
3. **Budget alert (essential).** In Google Cloud console (console.cloud.google.com):
   1. Open **Billing** → **Budgets & alerts** → **Create budget**.
   2. Scope: this project. Amount: **USD 5**.
   3. Alerts at 50%, 90% and 100%, emailed to the client and to you.
4. Do **not** enable:
   - phone/SMS sign-in;
   - extra Firestore databases;
   - point-in-time recovery;
   - Firebase Extensions;
   - minimum instances on functions.

   All of these cost money ([10 §3](10-firebase-free-tier.md)).

- [ ] Blaze plan on the client's billing account
- [ ] Budget alert USD 5 created, client and you notified

---

## D. Firebase services: database, sign-in, web app

1. **Firestore database.**
   1. Open **Build → Firestore Database → Create database**.
   2. If asked for an edition, choose **Standard**.
   3. Location: **asia-south1 (Mumbai)**. It cannot be changed later.
   4. Choose **Production mode**; our security rules are deployed in section G.
2. **Authentication.**
   1. Open **Build → Authentication → Get started → Sign-in method**.
   2. Enable **Email/Password**. Leave every other provider off, especially Phone.
3. **Register the web app.**
   1. Open **Project settings → General → Your apps** → click the **Web** icon `</>`.
   2. Nickname: `POS web`. Leave "Firebase Hosting" unticked; the deploy sets it up.
   3. Click **Register app**.
   4. Firebase shows a `firebaseConfig` block: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`. **Copy these six values**; you need them in section F.

- [ ] Firestore created in asia-south1
- [ ] Email/Password sign-in enabled
- [ ] Web app registered; six config values copied

---

## E. Your computer: tools and the code

Do this once on your own laptop. You then use it for every client.

1. **Install the tools:**
   - **Git**: git-scm.com.
   - **Node.js 22 LTS**: nodejs.org.
   - **pnpm** in a terminal:

     ```bash
     npm install -g pnpm@10
     ```
   - **Java 21**, only if you will run the emulator tests.
2. **Get the code** (main branch = Cloud Restaurant Edition):

```bash
git clone https://github.com/shehan-welagedara/Point-of-Sale-System.git
```

```bash
cd Point-of-Sale-System
```

```bash
pnpm install
```

3. **Your licence signing key**, once, ever ([15](15-licensing-and-modules.md)):

```bash
pnpm licence keygen
```

It prints a **public key** and saves the private key in `licence-keys/vendor-key.txt`. **Back this file up offline** (USB drive in a safe and a password manager). Never share it or commit it. Every client deployment needs the public key.

4. **Sign in to Firebase** from the terminal with *your* Google account (the member you added in B.3):

```bash
pnpm exec firebase login
```

- [ ] Tools installed; `pnpm install` finished
- [ ] Licence key pair created and backed up (first client only)
- [ ] `firebase login` done

---

## F. Configure the deployment

1. **Select the client's project** and give it a short alias:

```bash
pnpm exec firebase use --add
```

Choose the project ID from B.2 and type an alias such as `lagoon`. Later, switch between clients with `pnpm exec firebase use lagoon`.

2. **Web app settings.** Copy `apps/web/.env.example` to `apps/web/.env.local` and fill it in:

```ini
VITE_FIREBASE_API_KEY=…            # from D.3
VITE_FIREBASE_AUTH_DOMAIN=…
VITE_FIREBASE_PROJECT_ID=…
VITE_FIREBASE_STORAGE_BUCKET=…
VITE_FIREBASE_MESSAGING_SENDER_ID=…
VITE_FIREBASE_APP_ID=…
VITE_USE_EMULATORS=false
VITE_FUNCTIONS_REGION=asia-south1  # same as the Firestore location
VITE_LICENCE_PUBLIC_KEY=MFkw…      # your public key from E.3
```

3. **Functions settings.** Copy `apps/functions/.env.example` to `apps/functions/.env`:

```ini
LOCATION=asia-south1               # must equal the Firestore location
LICENCE_PUBLIC_KEY=MFkw…           # same public key
```

Keep one copy of these two files per client, for example `apps/web/.env.lagoon`. Copy the right one into place before each deploy.

- [ ] `firebase use` points at the client's project
- [ ] `apps/web/.env.local` filled in
- [ ] `apps/functions/.env` filled in

---

## G. Deploy

1. **Build and deploy** the web app, security rules, database indexes and the Cloud Functions:

```bash
pnpm firebase:deploy
```

- The **first** deploy switches on several Google services (Cloud Functions, Cloud Build, Artifact Registry, Eventarc, Pub/Sub, Cloud Scheduler) and can take 5–10 minutes.
- If it stops with a permissions or "service agent" error, wait 5 minutes and run it again. The new services need a few minutes to be ready.
- If the CLI asks whether to set up an **artifact clean-up policy**, answer **yes**.

2. **Artifact clean-up policy**, if you weren't asked, after the first successful deploy. This stops old build images from costing money:

```bash
pnpm exec firebase functions:artifacts:setpolicy --location asia-south1 --days 1
```

3. **Check** in the Firebase console:
   - **Hosting** shows a release.
   - **Firestore → Rules** shows our rules.
   - **Firestore → Indexes** lists the indexes (they may show "Building" for a few minutes).
   - **Functions** lists `ledgerApi`, `licenceApi`, `auditTrail`, `auditTenant` and `auditSealer`.
   - **Firestore → Time-to-live** has a policy on `printJobs`.

The system is now live at **https://PROJECT-ID.web.app** (also `.firebaseapp.com`).

- [ ] Deploy succeeded; five functions listed
- [ ] Clean-up policy set
- [ ] The site opens on https://PROJECT-ID.web.app

---

## H. First sign-in and the client's business

1. Open the site → **Create account** with the client's email and a strong password. This person becomes the **owner**.
2. **Set up a business:**
   1. Under **New client business**, type the business name.
   2. Choose the **modules** the client bought.
   3. Click **Create business**. It starts as a 30-day trial.
3. **Training copy (recommended).** Click **+ Business** in the top bar → **Load the demo restaurant**. Staff can practise there without touching real data or invoice numbers.
   - Switch between businesses with the selector in the top bar.
   - In a client deployment the demo business works for 30 days, which is enough for training. It can't be used to trade without a licence.

- [ ] Owner account created
- [ ] Real business created with the right modules
- [ ] Demo business created for training

---

## I. Licence key

1. In the real business, open **Administration → Licence & modules**. Note the two identifiers it shows: **Project** and **Business**.
2. On your computer, issue the licence:

```bash
pnpm licence issue --licensee "Lagoon Café (Pvt) Ltd" --edition professional --addons accounting --project PROJECT-ID --tenant BUSINESS-ID --months 12
```

3. Copy the long key it prints (`POSL1.…`) into the client's **Licence key** box → **Activate licence**. The page shows the edition, validity and usage limits.
4. Under the **Modules** tab, switch on what the client uses.

Keep the issued licence (saved under `licence-keys/issued/`) with the client's contract. Renewal is the same command with a new end date.

- [ ] Licence activated; edition and expiry correct

---

## J. Business, tax and branding

1. **Administration → Business & tax.** Fill in everything; the "sample business details" banner disappears once this is saved.
   - Registered (legal) name, trading name, address, phone and email.
   - TIN.
   - **VAT registered** and **SSCL liable** switches.
   - Service charge %, and the order types it applies to.
   - Inclusive or exclusive pricing; bill rounding.
   - Invoice numbering reset.

   **Check the settings with the client's accountant** ([06](06-sri-lanka-compliance.md)).
2. **Administration → Branding:** logo, colours, bill header and footer lines.
3. **POS Configuration → Terminal themes:** for counter terminals and PCs, choose Classic, Modern or Midnight and adjust colours and sizes.
4. **POS Configuration → Mobile app style:** show the client both styles (**Bright** and **Indigo**) on a phone and let them choose. Set where it applies (phones; phones and tablets; every screen), the accent colour and the sign-in picture (a landscape photo of the restaurant). A workstation can override it under Workstations & printers → *Screen style*.
5. **POS Configuration → Bill designer:** with the owner, choose what the bills print (titles, employee label, header, items, totals, QR codes, footer), check the preview on the client's paper width, and print a test bill. For VAT-registered clients the IRD particulars stay locked on.
6. **POS Configuration → POS options:** business day start (for late-night venues), automatic bill printing, loyalty points per Rs 100.

- [ ] Business and tax details confirmed by the accountant
- [ ] Logo and bill text set; terminal theme and mobile app style chosen by the client
- [ ] Bill layout approved by the owner on a printed test bill

---

## K. Outlets, workstations, printers and payments

In **POS Configuration**:

1. **Properties & revenue centres:** one property per site; revenue centres such as Restaurant, Takeaway, Bar.
2. **Workstations & printers.**
   - **Printers:** name, role (receipt, kitchen or bar), connection and address.
     - Network printers: IP address and port 9100.
     - USB on Windows: the printer's *share name*.
     - Set a backup printer and the **Print Agent id** (for example `AGENT-1`).
   - **Workstations:** one per counter PC or tablet.
     - **Code** `W01`, `W02`, `T01`…; the code appears in IRD invoice numbers, so never reuse one.
     - Default revenue centre, plus which revenue centres it may switch to.
     - Receipt printer, and **printing via Print Agent**.
3. **Tables** (if table service) and **Order types**.
4. **Tender media:** cash, card, LankaQR, PayHere, vouchers, house account, complimentary.
   - Check that each one's ledger account is right (if Finance is licensed).
   - Keep PayHere and LankaQR in **mock** under Administration → Integrations until the client's merchant accounts are approved.
5. **Discounts** and **Reason codes** (void, refund, discount, comp, paid-out).

- [ ] Revenue centres, workstations (unique codes) and printers entered
- [ ] Tenders, discounts and reason codes reviewed

---

## L. Menu, recipes and stock (Excel)

1. Open **Administration → Excel import & export → Download blank template**. Or start from `templates/data-feeder-sample.xlsx`.
2. With the client, fill in:
   - Categories;
   - Menu Items: code, price, kitchen route, modifiers, allergens;
   - Modifier Groups;
   - Stock Items: units, purchase unit and conversion, cost, supplier, par level;
   - Recipes;
   - Vendors and Customers.
3. **Import.** Every row is checked and errors are listed with their row numbers before anything is saved. Fix and re-import; codes update existing rows.
4. **Menu Management → Recipes & costing:** review food cost % and click **Save costs to menu items**.
5. **Menu Management → Menu items:** add photos if the theme shows them.
6. **Opening stock:** post one goods receipt per supplier, or do a stock count.
7. **Audit Center → Data quality → Run.** Fix anything it lists. It checks every record and every link between modules.

- [ ] Menu, modifiers, recipes and stock imported without errors
- [ ] Data quality check: no errors

---

## M. People, roles and sign-in

In **People & Security**:

1. **Sign-in policy:**
   - method (employee number + PIN is recommended);
   - lockout after 5 wrong PINs;
   - automatic sign-out after 300 seconds;
   - whether staff must clock in.
2. **Roles & privileges:** review the levels, privileges, limits and "needs approval" with the owner. For example:
   - cashiers can't void sent items;
   - supervisors approve voids up to Rs 10,000.
3. **Employees:** one per person.
   - Employee number (their sign-in ID), name, job and role.
   - Revenue centres; card number if they use swipe cards.
   - A **PIN**. Let each person choose their own PIN at the counter; easy PINs are refused.
4. **Back-office logins.** People who use the back office (manager, accountant, storekeeper) and **one login per POS device**:
   1. Open **Back-office logins → Invite**. Enter the email and role. Devices use the **POS terminal** role, for example `pos-counter@lagooncafe.lk`.
   2. The invited person opens the site → **Create account** with that email → **I was invited to a business**.

   Devices sign in once and stay signed in. Staff then sign in on top with their number and PIN.

- [ ] Sign-in policy set; roles reviewed with the owner
- [ ] Every employee has a number, role, outlets and their own PIN
- [ ] Manager, accountant and each POS device have logins

---

## N. Finance (if licensed)

1. **Finance → Finance settings:**
   - ledger accounts for POS postings;
   - approval limits (owner only);
   - cost centres;
   - exchange rates.
2. **Opening balances:** one journal on the go-live date, using bank, cash, assets, loans and capital from the accountant.
3. **Fixed assets:** register equipment, furniture and IT with cost, date and life.
4. Invite the **accountant** (role Accountant) and, if wanted, the **external auditor** (role Auditor, read-only).

- [ ] Finance settings and opening balances entered by the accountant

---

## O. Devices in the restaurant and the Print Agent

**Each POS PC or tablet:**
1. Open **https://PROJECT-ID.web.app** in Chrome or Edge (Safari on iPad) and sign in with that device's login.
2. Open **Point of Sale** and choose the workstation (W01, T01…). Each workstation is used on **one device only**.
3. **Install as an app:**
   - Windows (Chrome/Edge): menu → **Install**, then pin it to the taskbar and set it to open at start-up.
   - iPad: Share → **Add to Home Screen**.
   - Android: menu → **Install app**.
4. **Kiosk use (optional):** Windows assigned access, or the browser's kiosk mode, so staff can't leave the POS.

**Print Agent** (on the counter PC, or a mini-PC that is always on). It prints bills and kitchen tickets for every device, and opens the cash drawer.
1. Install Git, Node.js 22 LTS and pnpm on that PC (as in E.1), then clone the code and run `pnpm install`.
2. Copy `apps/print-agent/.env.example` to `apps/print-agent/.env` and fill it in:
   - the six web config values from D.3;
   - `AGENT_EMAIL` and `AGENT_PASSWORD`: a login with the **POS terminal** role;
   - `TENANT_ID`: the business id from I.1;
   - `AGENT_ID`: the same id you set on the printers;
   - `DRY_RUN=0`.
3. Start it:

```bash
pnpm agent
```

4. Print a **test page** from POS Configuration → Workstations & printers. Do a test sale: the bill prints and the drawer opens; the kitchen ticket prints.
5. **Start automatically.** In Windows **Task Scheduler**:
   - create a task that runs at log-on: program `cmd`, arguments `/c cd /d C:\path\to\Point-of-Sale-System && pnpm agent`;
   - set "Restart if the task fails".

   Keep the PC from sleeping (Power settings → never sleep).

- [ ] Every device signed in, workstation chosen, installed as an app
- [ ] Print Agent running and starting with Windows; test page, bill, kitchen ticket and drawer all work

---

## P. Training and the dry run

1. **Train staff in the demo business** (H.3) with the [training manuals](manual/training/README.md): one per role, with exercises and sign-off checklists. Print them, with the [user manual](manual/user-manual.md), as PDFs carrying the client's name: `pnpm manual:pdf -- --client "Client name"` (files in `manual-pdf/`).
   - **Cashiers and stewards:** sign in, tables, orders, modifiers, allergies, send, split, transfer, payment, bill (on the phones in the chosen app style).
   - **Supervisors:** voids, discounts and approvals.
   - **Manager:** reports on the POS, End of Day, 86, unlock employee.
   - **Storekeeper, accountant, administrator:** their back-office workspaces.
2. **Dry run in the real business**, on the day before go-live, after closing:
   - Ring a few real-looking checks with each tender, then a void with approval, a discount and a split.
   - Run **End of Day**: Z report, stock deduction, ledger posting if Finance is on, WhatsApp report (simulated).
   - Check **Reports**, **Finance → Overview** (POS day posted) and **Audit Center → Integrity** (no critical findings).
   - The dry-run invoices stay in the IRD series. That's normal: they were real numbers on real bills. Keep the printed bills with the day's records.
3. Re-check **Data quality**.

- [ ] Staff trained; manager can run End of Day alone
- [ ] Dry run complete; integrity check clean

---

## Q. Go-live day

1. **Before opening:**
   - internet and backup 4G working;
   - Print Agent running;
   - every device signed in;
   - opening cash float counted;
   - integrations still in mock, or switched to live if the bank and PayHere have approved them.
2. **Opening stock count** (if inventory is used).
3. Trade normally. Keep the vendor phone line open on the first day.
4. **After closing:**
   - run End of Day;
   - check the Z report against the cash counted and the card-terminal settlement;
   - read the WhatsApp/email summary.
5. **First week:** review **Audit Center → Exceptions** daily with the manager; tune roles and limits.

- [ ] First day closed; Z report agrees with cash and card settlements

---

## R. After go-live: daily, weekly, monthly

| When | Who | What |
|---|---|---|
| Daily | Manager | End of Day; Exceptions (voids, discounts, no-sales); 86 list back on sale |
| Weekly | Manager / owner | Reports and menu engineering; stock counts of key items; **Audit Center → Integrity** |
| Monthly | Accountant | Bank reconciliation; supplier invoices and payments; depreciation; **close the month**; VAT/SSCL working |
| Monthly | Owner / you | **Backups**: Audit Center → Auditor exports (audit package and SAF-T) and the Excel export of master data, stored off-site. On the free tier these exports are the backup. Optional paid Firestore backups cost a few cents a month ([10](10-firebase-free-tier.md)). |
| Monthly | Owner / you | **Access review**: remove leavers (employees → terminated; logins → removed) |
| Monthly | You | Firebase usage and billing (should be USD 0); budget alert still set |
| Yearly | You | Renew the licence; year-end close in Finance; review roles and limits |

---

## S. Updating the system

When a new version is released:
1. Read the release notes.
2. Choose a quiet time, after closing.

```bash
git pull
```

```bash
pnpm install
```

```bash
pnpm exec firebase use lagoon
```

```bash
pnpm firebase:deploy
```

3. Reload each device (pull down, or Ctrl+F5) and check one sale prints. On the Print Agent PC, run `git pull` and `pnpm install`, then restart the agent if the release notes say so.

---

## T. Custom domain (optional)

1. Open **Firebase console → Hosting → Add custom domain**, for example `pos.lagooncafe.lk`.
2. Add the DNS records it shows at the client's domain registrar; certificates are issued automatically.
3. Open **Authentication → Settings → Authorized domains** → add the domain.
4. Optional hardening: in Google Cloud console → APIs & Services → Credentials, restrict the web API key to the client's domains.

---

## U. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Deploy fails the first time with a permissions / service-agent / Eventarc error | New Google services are still being set up. Wait 5 minutes and run `pnpm firebase:deploy` again. |
| "Billing account not configured" when deploying functions | Blaze plan missing (section C). |
| "Missing or insufficient permissions" in the app | The signed-in login doesn't have the role for that action. Check Back-office logins. Devices need the POS terminal role. |
| Licence: "This licence is for project …" | Issued for another project id. Re-issue with `--project` set to the id shown on the Licence page. |
| Licence: "signature is not valid" | The deployment's public key doesn't match the key that signed it. Check `VITE_LICENCE_PUBLIC_KEY` and `LICENCE_PUBLIC_KEY`, then redeploy. |
| Accounting buttons fail with a region error | `LOCATION` (functions) and `VITE_FUNCTIONS_REGION` (web) must both equal the Firestore location. |
| Nothing prints | Print Agent not running, or wrong agent id, printer address, tenant id or login. The agent window shows the error. Print a test page. |
| A device shows another workstation's numbers | Two devices use one workstation. Give each device its own workstation code. |
| Employee locked out | A manager uses Functions → Unlock employee on the POS, or People & Security → Employees. |
| "Failed to resolve import" after `git pull` (your computer) | Run `pnpm install`. Scripts now do this automatically. |
| Phone on the local network can't run the dev demo | Use the deployed **https** site, or `pnpm demo` for a local preview. |
| Budget alert email | Check **Usage and billing** in the Firebase console. Most often an extra paid feature was switched on by mistake. |

---

## V. Hand-over checklist

- [ ] Client owns the Google account (2-Step Verification on) and the billing account; you are a member
- [ ] Budget alert active
- [ ] Licence activated; copy of the licence and contract filed
- [ ] Business, tax and branding confirmed by the accountant
- [ ] Menu, stock and recipes imported; data quality clean
- [ ] Every employee has their own PIN; roles and limits signed off by the owner
- [ ] Devices installed; Print Agent auto-starts; printers and drawer tested
- [ ] Staff trained and signed off (training manuals); manager can run End of Day; dry run clean
- [ ] User manual and training manuals handed over (PDF with the client's name)
- [ ] Monthly routine (section R) explained; first export of the audit package done
- [ ] Support contacts given to the client
