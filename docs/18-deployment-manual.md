# 18 — Client deployment manual (A to Z)

This manual takes one client from nothing to live trading on the **Cloud Restaurant Edition**: a new Google account and Firebase project, installation, configuration, staff training and go-live. Follow it in order and tick each box.

> **Who does what:** **You** are the vendor (installer). **The client** is the restaurant owner or manager. The client owns the Google account, the Firebase project and the billing; you are added as a member to install and support it.
>
> Google changes its console screens from time to time. If a menu name differs slightly, look for the nearest match. The steps stay the same.

**How the system is reached.** Everything runs in the client's Firebase project in the cloud and is used over the internet at `https://PROJECT-ID.web.app` (or the client's own domain, section T):

| Who | Device | How they get in |
|---|---|---|
| Owner, manager, accountant, storekeeper | Any computer, tablet or phone, anywhere | Their own email and password (back-office login) |
| Stewards, cashiers, bar and kitchen staff | **Phones** (their own or the restaurant's), tablets, a counter PC | The device is **connected once with a one-time code** (section O); each person then signs in with their employee number and PIN |
| The Print Agent | One always-on PC in the restaurant, on the same network as the printers | A POS terminal login (section O) |

Phones work on the restaurant's Wi-Fi or on mobile data. They print in one of two ways:

- **Through the Print Agent** (several devices, network printers): bills and kitchen tickets go through the cloud to the Print Agent PC in the restaurant, which drives the printers and the cash drawer.
- **To a Bluetooth printer beside the phone** (a small business with one phone and one printer, no PC): the phone prints straight to the printer. See O.4.

## Contents
- A. Before you start
- B. Client's Google account and Firebase project
- C. Billing, budget alerts and cost safety
- D. Firebase services: database, sign-in, web app
- E. Your computer: tools, the code and sign-in
- F. Set up the client (one command)
- G. Deploy
- H. First sign-in and the client's business
- I. Licence key
- J. Business, tax and branding
- K. Outlets, workstations, printers and payments
- L. Menu, recipes and stock (Excel)
- M. People, roles and sign-in
- N. Finance (if licensed)
- O. POS devices (phones, tablets, PCs) and the Print Agent
- P. Training and the dry run
- Q. Go-live day
- R. After go-live: daily, weekly, monthly
- S. Updating the system
- T. Custom domain (optional)
- U. Troubleshooting
- V. Hand-over checklist

**The deployment in three parts:**

| Part | Sections | Where you work | Roughly |
|---|---|---|---|
| 1. The client's Google project | A–D | In the browser (Google and Firebase consoles), with the client | 1 hour |
| 2. Publish the system | E–G | On your PC: a few commands (E once for all clients) | 30 minutes |
| 3. Set up, train and go live | H–V | In the system itself, with the client | 1–3 days |

---

## A. Before you start

Collect from the client:

| Item | Example |
|---|---|
| Registered business name, trading name, address, phone | Lagoon Café (Pvt) Ltd, "Lagoon Café" |
| TIN (9 digits); VAT registration status; SSCL liability | 123456789; VAT registered; SSCL not liable |
| Service charge %, prices inclusive or exclusive of taxes | 10%; exclusive |
| Logo (PNG or SVG), brand colours | |
| Outlets / revenue centres, POS devices, printers | 1 outlet; restaurant + takeaway; 6 staff phones + 1 counter PC; bill printer + kitchen printer |
| **How many POS devices at the busiest time** (phones, tablets, PCs) | Each needs its own workstation, and the licence limits workstations: Starter 3, Professional 12 |
| Menu with prices, modifiers, recipes; stock items; suppliers | Use the Excel data feeder (section L) |
| Staff list: names, jobs, who may void, discount, refund | |
| Bank for cards, LankaQR merchant ID (when approved) | |
| Edition and modules bought | Professional + Accounting |
| An email address the client will own for the system | it@lagooncafe.lk (or a new Gmail) |

Hardware ready at the site:
- **Staff phones** (and any tablets): Android 10 or newer with Chrome, or iPhone/iPad with iOS 16 or newer with Safari. Charged, with Wi-Fi or mobile data. Staff's own phones are fine (see O.1).
- **Print Agent PC:** any small always-on Windows PC or mini-PC on the restaurant network, with the printers. It can also be the counter PC. **Not needed** for a small business with one phone and a Bluetooth printer (O.4).
- **Counter PC (optional):** Windows 10/11 with a touch screen, Chrome or Edge, if the cash desk uses a big screen.
- **Bill printer and kitchen printer:** ESC/POS network printers (LAN or Wi-Fi), for example Epson TM-T82III. Network printers let the Print Agent PC sit anywhere on the network. **Or**, for one phone: a Bluetooth ESC/POS printer such as the Xprinter XP-T80Q (O.4).
- **Cash drawer** connected to the bill printer.
- **Restaurant Wi-Fi** covering the dining area and kitchen, a **4G router as backup internet** for the Print Agent PC and printers, and a **UPS** for the router, PC and printers.

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
2. **Authentication.** The back office is reached over the internet with an email and password, so set these carefully.
   1. Open **Build → Authentication → Get started → Sign-in method**.
   2. Enable **Email/Password**. Leave every other provider off, especially Phone.
   3. **Settings → Password policy:** turn it on with *Require enforcement*, minimum length **10**, and require lowercase, uppercase and numeric characters. (The sign-up screen asks for 10 characters too; the policy makes Firebase itself refuse weaker passwords.)
   4. **Settings → User actions:** leave **Email enumeration protection** on (the default). The "Forgot password?" screen then never reveals which addresses have accounts.
   5. **Project settings → General → Public-facing name:** the restaurant's name, for example *Noura Kitchen*. Then **Authentication → Templates**: check the *Email address verification* and *Password reset* emails; set the sender name to the restaurant's name. Staff then receive "Noura Kitchen" emails rather than a project ID, and are less likely to find them in spam.
   6. **Settings → Authorized domains** already lists `PROJECT-ID.web.app` and `PROJECT-ID.firebaseapp.com`. Add a custom domain here only if you set one up (section T).
3. **Register the web app.**
   1. Open **Project settings → General → Your apps** → click the **Web** icon `</>`.
   2. Nickname: `POS web`. Leave "Firebase Hosting" unticked; the deploy sets it up.
   3. Click **Register app**.
   4. Firebase shows a `firebaseConfig` block. **You don't need to copy it:** once deployed, the app reads these settings from Firebase Hosting by itself (`/__/firebase/init.json`). Registering the app is what makes Hosting serve them. Click **Continue to console**.

- [ ] Firestore created in asia-south1
- [ ] Email/Password sign-in enabled; password policy, public-facing name and email templates set
- [ ] Web app registered

---

## E. Your computer: tools, the code and sign-in

**What this does:** your PC gets the programs that publish the system, a copy of the code, and permission to publish to the client's project. Steps 1 and 2 are done **once** for all your clients.

**Where to type the commands.** On Windows, use **Command Prompt**: Start → type *cmd* → **Command Prompt**. (In PowerShell, Windows blocks pnpm by default with *running scripts is disabled on this system*; see U if you prefer PowerShell.) Copy each grey box, paste it, press Enter and wait until it finishes. From step 2 on, every command runs **inside the project folder** (`cd Point-of-Sale-System`).

1. **Install these programs** (normal installers; accept the defaults):

   | Program | Why it is needed | Where |
   |---|---|---|
   | **Git** | downloads the code and its updates | git-scm.com → *Download for Windows* |
   | **Node.js 22 LTS** | runs the build and the deploy tools | nodejs.org → the *LTS* button |

   Close the terminal, open a new one (so it sees the new programs), and install **pnpm**, the tool that installs the project's parts:

   ```bash
   npm install -g pnpm@10
   ```

   (Java 21 is only for running the emulator tests. You don't need it to deploy.)

2. **Get the code.** The **`main`** branch is the Cloud Restaurant Edition: always deploy from `main`.

   ```bash
   git clone https://github.com/shehan-welagedara/Point-of-Sale-System.git
   ```

   ```bash
   cd Point-of-Sale-System
   ```

   ```bash
   pnpm install
   ```

   **Already have the code?** Bring it up to date instead: `git checkout main`, then `git pull`, then `pnpm install`.

3. **Sign in** with *your* Google account, the one you added to the client's project in B.3. The command opens the browser: choose that account and allow.

   ```bash
   pnpm exec firebase login
   ```

   This is the only sign-in you need, for the first deploy and for every update: the release tool uses it for the backups, the data updates and the project's permissions too. (Versions before 1.6.0 also needed the Google Cloud CLI; it isn't used any more.)

   **If `firebase login` fails** (*Unable to fetch the CLI MOTD*, *Failed to make request to auth.firebase.tools*, or *Firebase CLI Login Failed* in the browser), your PC's antivirus, proxy or firewall is stopping Node.js. Find the cause and the fix with:

   ```bash
   pnpm deploy:check
   ```

   It tests each Google service from Node.js and prints the exact fix (troubleshooting U has more). If nothing helps, use **Cloud Shell** in the browser instead (U, *Deploying from Cloud Shell*).

- [ ] Git, Node.js 22 and pnpm installed
- [ ] Code downloaded from `main`; `pnpm install` finished without errors
- [ ] `pnpm exec firebase login` done

---

## F. Set up the client (one command)

**What this does:** tells the deploy tools which Firebase project belongs to the client, and puts your licence key in place (it is what lets you issue the client's licence in section I).

```bash
pnpm deploy:setup
```

It first checks section E (✓ for each tool and sign-in, or ✗ with exactly what to do). Then it asks three questions:

| It asks | Answer with | Example |
|---|---|---|
| Client id | a short name, lowercase, with dashes | `noura-kitchen` |
| Client name | the name as it appears in reports | Noura Kitchen |
| Firebase project ID | the ID from B.2 (Firebase console → ⚙ **Project settings** → *Project ID*) | `noura-kitchen-pos` |

**The first time on your PC** it also offers to create your **licence signing key**: answer `y`. The key is saved in `licence-keys/vendor-key.txt`. **Back this file up straight away** (a USB drive kept somewhere safe, and your password manager). Without it you can't issue or renew licences for any of your clients. Never share it and never upload it anywhere.

It fills in, so you don't have to edit them by hand:

- `release/clients.json`: the client's project ID, region (asia-south1, Mumbai), backup location, and *switched on*;
- `apps/web/.env.production` and `apps/functions/.env`: your licence public key and the region.

**Polymath Console.** If you have set up the console ([22](22-polymath-console.md), `pnpm console:setup`, once for all clients), `apps/functions/.env` also holds its address (`CONSOLE_URL`), so the client's system checks in with the console from its first deploy. Add the client in the console (Clients → Add client) before or after the deploy.

You can run it again at any time: it only fills in or corrects these values. Carry on to G when it finishes with no ✗.

> **Automatic updates (optional, later).** If you want GitHub to deploy future updates by itself, without your PC, run the access script once with the client's owner: see [20](20-release-and-updates.md). It isn't needed for this installation.

- [ ] `pnpm deploy:setup` finishes with no ✗
- [ ] `licence-keys/vendor-key.txt` backed up (first client only)

---

## G. Deploy

**What this does:** builds the app and publishes it to the client's project together with the security rules, the database indexes and the server functions. The release tool does this in a safe order, takes a backup first whenever the client already has live data, and checks the result at the end.

1. **See the steps first.** Nothing is changed:

   ```bash
   pnpm release:deploy --target CLIENT-ID --dry-run
   ```

   Use the client id from F (for example `noura-kitchen`). It builds the app (about a minute) and lists each step. On the first installation it says *nothing deployed yet: this is the first deploy*, which is expected: a new project has nothing to back up and no data to update, so those two steps are skipped (they run from the next deploy on).

2. **Deploy for real:**

   ```bash
   pnpm release:deploy --target CLIENT-ID
   ```

   - The **first** deploy takes **5–10 minutes**: Google switches on Cloud Functions and the services it needs. There are no questions to answer.
   - On a first deploy the tool also does these by itself:
     - checks the project's permissions for the server functions: it switches on the *Compute Engine API* if needed (that creates the account the functions run as; it costs nothing by itself) and gives Google's own accounts the roles they need. If Google refuses, it says why and what to do (`pnpm deploy:access --project PROJECT-ID` runs only this check);
     - creates the web address (`PROJECT-ID.web.app`);
     - sets the clean-up policy that stops old server-function images from costing money;
     - if the server functions stop because Google is still setting up the new project (*Eventarc Service Agent*), it says so, **waits 3, then 5 minutes and tries again**. Leave the window open.
   - If it still stops, read the red *Error* line, wait 5 minutes and run the same command again: every step is safe to repeat, and it continues where it stopped. Section U lists the usual messages.
   - Firebase may warn that *firebase-functions* is outdated: that's only a suggestion and can be ignored.
   - It finishes with ✓ *https://PROJECT-ID.web.app/version.json reports …*: the system is live.

3. **Check** in the Firebase console:
   - **Hosting** shows a release.
   - **Firestore → Rules** shows our rules.
   - **Firestore → Indexes** lists the indexes (they may show "Building" for a few minutes).
   - **Functions** lists `ledgerApi`, `licenceApi`, `posAuth`, `deviceApi`, `consoleLinkNow`, `consoleCheckin`, `auditTrail`, `auditTenant` and `auditSealer`.
   - **Firestore → Time-to-live** has a policy on `printJobs`.

4. **Keep `release/clients.json`.** It is how the next update finds this client. If you keep your copy of the code on GitHub, commit and push it.

The system is now live at **https://PROJECT-ID.web.app** (also `.firebaseapp.com`). Open it: the back office **About** page (section H onwards) shows the version you deployed.

- [ ] Deploy finished with ✓; nine functions listed
- [ ] The site opens on https://PROJECT-ID.web.app

---

## H. First sign-in and the client's business

1. Open the site → **Create account** with the client's email and a strong password. This person becomes the **owner**, and creating the first business **claims the deployment**: from then on only they, owners and administrators of a business, and the people listed in `deployment/config.creators` can create businesses here. Strangers who sign up can't. (On your own demo project, set `openSignup: true` in that document in the Firestore console.)
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

**With the Polymath Console** ([22](22-polymath-console.md); set it up once for all clients):

1. In the console: **Clients → Add client** (client id, name, registered name, Firebase project ID). Fill in **Subscription** (plan, price, paid until).
2. In the client's back office: **About → Check now**. The first check-in appears on the client's page in the console within a minute (if it asks you to confirm the project number, check it against Firebase console → Project settings, and confirm).
3. In the console: **Licence → Issue licence** (edition, add-ons, valid until). Then in the client's back office, **About → Check now** again: Administration → Licence & modules shows the new edition and validity.
4. Under the **Modules** tab, switch on what the client uses.

Renewals: in the console, **Subscription → Record payment** with *Renew the licence*; the client's system picks it up within a day.

**Without the console** (or when the client's system can't reach it):

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
   - **Workstations:** one per POS device: **every phone**, tablet and counter PC has its own.
     - **Code** `W01` (counter PC), `P01`, `P02`… (phones), `T01` (tablets); the code appears in IRD invoice numbers, so never reuse one.
     - Default revenue centre, plus which revenue centres it may switch to.
     - Receipt printer, and **printing via Print Agent**, or **Bluetooth printer next to this phone or tablet** (O.4: no printer records or Print Agent needed).
     - Phones' workstations can also be created while connecting the phone (section O), which is quicker.
     - The licence limits active workstations (Starter 3, Professional 12): count every phone, plus one or two spares.
3. **Tables** (if table service) and **Order types**.
4. **Tender media:** cash, card, LankaQR, PayHere, vouchers, house account, complimentary.
   - Check that each one's ledger account is right (if Finance is licensed).
   - Keep PayHere and LankaQR in **mock** under Administration → Integrations until the client's merchant accounts are approved.
5. **Discounts** and **Reason codes** (void, refund, discount, comp, paid-out).

- [ ] Revenue centres, workstations (unique codes, one per device, within the licence) and printers entered
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
   - automatic sign-out after 300 seconds (120 seconds when staff use their own phones);
   - whether staff must clock in.
2. **Roles & privileges:** review the levels, privileges, limits and "needs approval" with the owner. For example:
   - cashiers can't void sent items;
   - supervisors approve voids up to Rs 10,000.
3. **Employees:** one per person.
   - Employee number (their sign-in ID), name, job and role.
   - Revenue centres; card number if they use swipe cards.
   - A **PIN**. Let each person choose their own PIN at the counter; easy PINs are refused.
4. **Back-office logins** for the **people** who use the back office (manager, accountant, storekeeper), and one for the **Print Agent**:
   1. Open **Back-office logins → Invite**. Enter the email and role. The invited person signs up with that address and must **verify it** (link in the email) before **Accept invitation** works: this stops anyone else claiming the invitation.
   2. The invited person opens the site → **Create account** with that email → **I was invited to a business**.
   3. The Print Agent's login uses the **POS terminal** role and an address the client owns, for example `printer@lagooncafe.lk` or a Gmail address made for it.

   **Phones, tablets and counter PCs don't need logins here.** They are connected with a one-time code (section O): no email, no shared password.

- [ ] Sign-in policy set; roles reviewed with the owner
- [ ] Every employee has a number, role, outlets and their own PIN
- [ ] Manager, accountant and the Print Agent have logins

---

## N. Finance (if licensed)

1. **Finance → Finance settings:**
   - ledger accounts for POS postings;
   - approval limits (owner only);
   - cost centres;
   - exchange rates.
2. **Opening balances, and records since the start date:** with the **accounting workbook** (Finance → Excel import): opening balances, opening stock, suppliers and customers with what they owe, supplier bills and expenses since the start date, daily sales from manual bills, and fixed assets with depreciation to date. Show the client the example first (**Download the example (filled in)**, or `templates/accounting-workbook-sample.xlsx`). Everything is checked before it is saved, and importing again skips what is already in.
3. **Paper bills:** photograph them into **Finance → Bills & receipts** and attach them to the imported bills (**From inbox**), or record each from there.
4. **Administration → Setup checklist** shows what is still missing. The [configuration guide](manual/configuration-guide.md) explains each setting for the client's own staff.
5. Invite the **accountant** (role Accountant) and, if wanted, the **external auditor** (role Auditor, read-only).

- [ ] Finance settings and opening balances entered by the accountant

---

## O. POS devices (phones, tablets, PCs) and the Print Agent

### O.1 Connecting phones, tablets and counter PCs

Every POS device is connected **once**, with a one-time code. It then has its own login, which works over the internet from Wi-Fi or mobile data and can be removed on its own.

1. On a computer, the owner or a manager signs in to the back office: **POS Configuration → Workstations & printers → Connect a phone**.
2. Type the phone's name (who uses it, or where: *Nimal's phone*, *Bar phone 1*). Choose **+ New workstation for this phone** (it suggests `P01`, `P02`…) or an existing workstation. Press **Show the code**.
3. On the phone, open the **camera** and scan the QR code, then tap the link. (Or open `https://PROJECT-ID.web.app/pair` and type the 8-character code.) Press **Connect**.
4. The phone opens the POS on its workstation. **Add it to the home screen** so it opens like an app:
   - iPhone/iPad (Safari): Share → **Add to Home Screen**.
   - Android (Chrome): ⋮ → **Install app** (or Add to Home screen).
   - Windows counter PC (Chrome/Edge): menu → **Install**, pin it to the taskbar and set it to open at start-up.
5. Staff sign in on the POS with their **employee number and PIN**, as on any terminal.

A code works **once, for 15 minutes**. Connect phones one at a time, while you have each phone in your hand. The device list on the same page shows every connected device, its workstation and when it was last seen.

**Staff's own phones** are fine:
- The phone's login can only use the POS. Without an employee PIN it can't even do that, and it never sees the back office, the books or other businesses.
- Keep **automatic sign-out** short (M.1, for example 120 seconds), so a phone left on a table signs its user out.
- When someone leaves, or a phone is lost or replaced, press **Remove** next to it. Its login is deleted at once and the phone shows *This phone is no longer connected*. Also end the employee (People & Security → Employees). Removing a phone does not touch its workstation's bills.
- Data on a removed phone stops updating. The menu and recent orders may stay in that browser's storage until the browser data is cleared.

**Restaurant-owned phones and tablets** are connected the same way. For a counter PC, kiosk use (Windows assigned access, or the browser's kiosk mode) keeps staff in the POS.

**Each workstation on one device at a time.** Bills are numbered per workstation. If two devices use the same one, the POS warns *also open on another device*. Give the second device its own workstation.

### O.2 Internet

- **Phones** use the restaurant Wi-Fi, or mobile data when the Wi-Fi is weak. Short drops are fine: orders and payments carry on and are sent when the connection returns, with a notice on screen meanwhile.
- **Printing needs the Print Agent PC online.** If the restaurant's internet is down, phones on mobile data can still take orders, but nothing prints until the Print Agent is back online. Hence the **4G backup router** for the Print Agent PC and printers (section A).
- Test both before go-live: switch off the Wi-Fi on a phone, take an order on mobile data, and check it prints.

### O.3 The Print Agent

Skip this part when the only POS device prints to its own Bluetooth printer (O.4).

The Print Agent runs on the counter PC, or on a mini-PC that is always on. It prints bills and kitchen tickets for every device, including phones, and opens the cash drawer.
1. Install Git, Node.js 22 LTS and pnpm on that PC (as in E.1), then clone the code and run `pnpm install`.
2. Copy `apps/print-agent/.env.example` to `apps/print-agent/.env` and fill it in:
   - the six web config values (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`): Firebase console → **Project settings → General → Your apps → POS web → SDK setup and configuration → Config**;
   - `AGENT_EMAIL` and `AGENT_PASSWORD`: the Print Agent's login with the **POS terminal** role (M.4);
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

### O.4 One phone and a Bluetooth printer (small businesses, no Print Agent)

A small restaurant can run on **one phone** (or tablet) with **one Bluetooth receipt printer** beside it, for example an **Xprinter XP-T80Q** (80 mm, USB + Bluetooth, ESC/POS, cash drawer port). Bills, kitchen tickets, X/Z reports and the cash drawer all go to that printer. No PC, no Print Agent, no network printers. See [11](11-hardware-and-printing.md) (Model C).

1. **Phone:** Android with **Chrome** is recommended. On an iPhone, open the POS in the **Bluefy** browser instead (Safari and Chrome on iOS can't use Bluetooth from web apps).
2. **Printer:** load the paper, switch it on, and connect the cash drawer to the printer's drawer port.
3. **Connect the phone** (O.1): in **How this phone prints**, choose **Bluetooth printer beside it (Chrome on Android)**. (For an existing workstation: Workstations & printers → the workstation → **Printing: Bluetooth printer next to this phone or tablet**, **Bluetooth route: From the browser**, **paper 80 mm**, and **Kitchen and bar tickets print on this printer too** on.)
4. **On the phone**, in the POS: tap **Connect printer** (home screen, or More → Bluetooth printer) → **Choose the printer** → pick it from the list (named like *XP-T80Q* or *Printer001*) → **Test print**. The phone remembers it and reconnects by itself while the POS is open.
5. **If the printer isn't in the list**, or the test doesn't print, its Bluetooth is classic only. Then:
   1. install **RawBT** from Google Play;
   2. pair the printer in Android **Settings → Bluetooth** (PIN usually `0000` or `1234`);
   3. in RawBT, choose the printer and 80 mm paper;
   4. set the workstation's **Bluetooth route** to **Through the RawBT app**;
   5. **Test print** again.
6. **Kitchen tickets on the same printer:** no kitchen printer record is needed. With none, **Send KOT** prints the kitchen ticket on the workstation's own printer (here the Bluetooth printer), and the bill prints there at payment. Keep **Print a kitchen ticket (KOT) when an order is sent** on (POS Configuration → POS options).
7. **Test a sale:** **Send KOT** (only the kitchen ticket prints; no bill, the drawer stays shut), **Reprint KOT** from the order's ⋮ menu (marked REPRINT), then a cash payment (the bill prints and the drawer opens).

If the printer is switched off or out of range, prints **wait on the phone**: the printer button shows how many. They print as soon as the printer is connected again. A bill that never printed can be reprinted from **Orders**.

- [ ] Every phone, tablet and counter PC connected with a code, on its own workstation, added to the home screen; all listed under Connected phones and tablets
- [ ] Print Agent running and starting with Windows; test page, bill, kitchen ticket and drawer all work, **from a phone** as well (or, for one phone with a Bluetooth printer: test page, kitchen ticket, bill and drawer from the phone, O.4)
- [ ] An order taken on mobile data (Wi-Fi off) prints in the kitchen

---

## P. Training and the dry run

1. **Train staff in the demo business** (H.3) with the [training manuals](manual/training/README.md): one per role, with exercises and sign-off checklists. Print them, with the [user manual](manual/user-manual.md), as PDFs carrying the client's name: `pnpm manual:pdf -- --client "Client name"` (files in `manual-pdf/`).
   - **Cashiers and stewards:** sign in, tables, orders, modifiers, allergies, send, split, transfer, payment, bill (on the phones in the chosen app style). To practise on their phones, connect them to the demo business (O.1); before go-live, **Remove** them there and connect them to the real business.
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
   - every phone connected and showing *last seen: just now* (Workstations & printers), staff phones charged;
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
| Monthly | Owner / you | **Access review**: remove leavers (employees → terminated; logins → removed; **their phones → Remove**); remove phones not seen for weeks |
| Monthly | You | Firebase usage and billing (should be USD 0); budget alert still set |
| Yearly | You | Renew the licence; year-end close in Finance; review roles and limits |

---

## S. Updating the system

Updates go through the release process in [20 — Releases and updates](20-release-and-updates.md): one tested build, deployed to your staging project first, then to pilot clients, then to everyone, after closing time, with a backup before each client.

- **Automatic (recommended):** tag the release (`pnpm release:version 1.1.0`, commit, `git tag v1.1.0`, push). GitHub builds and tests it, deploys to staging, and waits for your approval before each wave of clients.
- **By hand, one client:** `git pull`, `pnpm install`, then `pnpm release:deploy --target CLIENT-ID` (add `--dry-run` to see the steps first). It builds the app, takes a backup of the client's database, runs any data updates and publishes, using only your Firebase sign-in.

Devices pick up the new version by themselves: screens show **Version x is available**, and devices where nobody is signed in reload within a minute. **Administration → System status** shows which devices still run the old version. On the Print Agent PC, run `git pull` and `pnpm install`, then restart the agent if the release notes say so.

---

## T. Custom domain (optional, recommended)

Staff can use the system at `https://PROJECT-ID.web.app` from anywhere. A domain of the restaurant's own (for example `books.nourakitchen.lk`) is easier to remember and to trust, and is worth setting up once the client has a domain.

1. Open **Firebase console → Hosting → Add custom domain**, for example `pos.lagooncafe.lk`.
2. Add the DNS records it shows at the client's domain registrar; certificates are issued automatically.
3. Open **Authentication → Settings → Authorized domains** → add the domain.
4. Optional hardening: in Google Cloud console → APIs & Services → Credentials, restrict the web API key to the client's domains.

---

## U. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *We failed to modify the IAM policy for the project*, or a permissions / service-agent / Eventarc error on the first deploy | From version 1.5.8 the first deploy checks this itself before the server functions: it switches on the **Compute Engine API** if needed (that creates the account the functions run as; no cost by itself), gives the three accounts their roles, and if Google refuses, prints Google's reason and what to do. To run only that check: `pnpm deploy:access --project PROJECT-ID`. The usual reasons: your Google account isn't an **Owner** of the project (sign the Firebase CLI in with the owner, or have the owner give you the Owner role in Google Cloud console → IAM & Admin → IAM), or Google is still creating the accounts (the deploy waits 3, then 5 minutes and tries again; otherwise run it again in 10 minutes). |
| *User code failed to load. Cannot determine backend specification. Timeout after 10000* | Loading the server functions took longer than Firebase's 10 seconds (antivirus scanning on Windows). Version 1.5.7 and later allow 60 seconds; on an older version run `set FUNCTIONS_DISCOVERY_TIMEOUT=60` in the same Command Prompt first. |
| Deploy stops with *ENOENT: no such file or directory, open* `…\apps\functions\dist\.env.PROJECT-ID` | A fault in versions up to 1.5.4 on a fresh copy of the code (the folder is created later). Get the fix with `git pull` and `pnpm install`, then run the deploy again; the indexes already deployed are simply checked again. |
| *Could not detect runtime for functions at …\\apps\\functions\\dist* (after *No projects matched the filters*) | On Windows, versions up to 1.5.5 didn't build the server functions. Update (`git pull`, `pnpm install`) and deploy again. |
| *Unable to deploy to Hosting as there is no Hosting site* | Versions up to 1.5.4 didn't create the web address. Update (`git pull`) and deploy again; or open **Firebase console → Hosting → Get started**, click through to the end, then deploy again. |
| *Functions successfully deployed but could not set up cleanup policy* | Versions up to 1.5.4 left this question unanswered. Update (`git pull`) and deploy again, or set it once: `pnpm exec firebase functions:artifacts:setpolicy --location asia-south1 --days 1 --project PROJECT-ID --force`, then deploy again. |
| PowerShell: *pnpm.ps1 cannot be loaded because running scripts is disabled on this system* | PowerShell blocks scripts by default. Use **Command Prompt** instead (Start → *cmd*), where the same commands work. To use PowerShell anyway, allow local scripts once for your account: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (answer **Y**), then open a new PowerShell window. |
| `pnpm deploy:setup` shows ✗ | Do what it says on that line (install a program or sign in), then run it again. |
| `pnpm exec firebase login` fails: *Unable to fetch the CLI MOTD and remote config*, *Failed to make request to https://auth.firebase.tools/attest*, *Your credentials are no longer valid*, or the browser page *Firebase CLI Login Failed* | The browser can reach Google but Node.js (which runs the Firebase tools) can't: antivirus HTTPS scanning, a company proxy or a firewall. Run `pnpm deploy:check`: it tests each Google service from Node.js and prints the fix for your PC. Most often that is `set NODE_OPTIONS=--use-system-ca` in Command Prompt, or `$env:NODE_OPTIONS="--use-system-ca"` in PowerShell (Node.js then trusts the same certificates as Windows; `setx NODE_OPTIONS "--use-system-ca"` keeps it for new terminals). Then run `pnpm exec firebase logout` and `pnpm exec firebase login --reauth`. If nothing helps, deploy from Cloud Shell (below). |
| "Billing account not configured" when deploying functions | Blaze plan missing (section C). |
| "Missing or insufficient permissions" in the app | The signed-in login doesn't have the role for that action. Check Back-office logins. |
| Phone: "This code isn't valid any more" | Codes work once, for 15 minutes. Create a new one (Connect a phone). |
| Phone: "No connection to the system" while connecting | The phone has no internet. Switch to Wi-Fi or mobile data and try again. |
| Phone shows "This phone is no longer connected" | It was removed (lost phone, leaver). Connect it again with a new code if it should be used. |
| Phone shows the email/password sign-in | It isn't connected: use **Connect it with the code** on that screen, not a password. |
| Phone orders don't print | The Print Agent PC is off or offline, or the workstation's bill printer isn't set. Orders still reach the cloud; they print when the agent is back. |
| Bluetooth printer: "Printer: 2 waiting" / "Connect printer" | The printer is off, out of range, or the phone restarted. Switch it on, tap the printer button → **Connect printer**. Waiting prints then come out. |
| Bluetooth printer not in the phone's list | Its Bluetooth is classic only, or Bluetooth/location is off on the phone. Switch them on; otherwise use the RawBT route (O.4 step 5). |
| iPhone: "can't print to Bluetooth printers" | Safari and Chrome on iOS have no Web Bluetooth. Open the POS in the Bluefy browser, or print through the Print Agent. |
| Licence: "This licence is for project …" | Issued for another project id. Re-issue with `--project` set to the id shown on the Licence page. |
| Licence: "signature is not valid" | The deployment's public key doesn't match the key that signed it. Check `VITE_LICENCE_PUBLIC_KEY` and `LICENCE_PUBLIC_KEY`, then redeploy. |
| Accounting buttons fail with a region error | `LOCATION` (functions) and `VITE_FUNCTIONS_REGION` (web) must both equal the Firestore location. |
| Nothing prints | Print Agent not running, or wrong agent id, printer address, tenant id or login. The agent window shows the error. Print a test page. |
| A device shows another workstation's numbers, or "also open on another device" | Two devices use one workstation. Give each device its own workstation (connect the second phone to a new one). |
| "The licence allows N active workstations" | Every phone uses a workstation. Deactivate unused ones, or issue a licence with more (section I). |
| Employee locked out | A manager uses Functions → Unlock employee on the POS, or People & Security → Employees. |
| "Failed to resolve import" after `git pull` (your computer) | Run `pnpm install`. Scripts now do this automatically. |
| Phone on the local network can't run the dev demo | Use the deployed **https** site, or `pnpm demo` for a local preview. |
| Budget alert email | Check **Usage and billing** in the Firebase console. Most often an extra paid feature was switched on by mistake. |

### Deploying from Cloud Shell (when your PC can't connect)

Google Cloud Shell is a terminal in the browser, run by Google, with the Google tools already installed and signed in. It avoids any problem with your PC's network, antivirus or tools.

1. Open **console.cloud.google.com**, choose the client's project at the top, and click **Activate Cloud Shell** (the `>_` icon, top right). A terminal opens at the bottom.
2. Get Node.js 22, pnpm and the code:

```bash
nvm install 22
```

```bash
npm install -g pnpm@10
```

```bash
git clone https://github.com/shehan-welagedara/Point-of-Sale-System.git
```

```bash
cd Point-of-Sale-System
```

```bash
pnpm install
```

3. Sign in to the Firebase tools. Cloud Shell has no local browser, so use this form: open the link it prints, sign in, and paste back the code it shows:

```bash
pnpm exec firebase login --no-localhost
```

4. Then continue with **F** (`pnpm deploy:setup`) and **G** exactly as on a PC.
5. **The licence key.** If you already created it on your PC, upload `licence-keys/vendor-key.txt` to the same folder in Cloud Shell first (⋮ menu → *Upload*), so every client uses the same key. If you create it in Cloud Shell, download it straight away (⋮ → *Download*, `Point-of-Sale-System/licence-keys/vendor-key.txt`) and back it up.
6. After the deploy, keep a copy of `release/clients.json` (download it, or commit and push it), so the next update finds the client.

---

## V. Hand-over checklist

- [ ] Client owns the Google account (2-Step Verification on) and the billing account; you are a member
- [ ] Budget alert active
- [ ] Licence activated; copy of the licence and contract filed
- [ ] Business, tax and branding confirmed by the accountant
- [ ] Menu, stock and recipes imported; data quality clean
- [ ] Every employee has their own PIN; roles and limits signed off by the owner
- [ ] Every phone, tablet and PC connected with a code (own workstation, home-screen app); owner and manager know how to connect and remove a phone
- [ ] Print Agent auto-starts; printers and drawer tested from a phone, also on mobile data
- [ ] Staff trained and signed off (training manuals); manager can run End of Day; dry run clean
- [ ] User manual and training manuals handed over (PDF with the client's name)
- [ ] Monthly routine (section R) explained; first export of the audit package done
- [ ] Security checklist done ([21](21-security-review.md#go-live-security-checklist)): 2-Step Verification for owners, backups and delete protection, deployment claimed by the owner
- [ ] Support contacts given to the client
