# 23. Polymath Console: deployment and configuration (A–Z)

This guide takes you from nothing to a working **Polymath Console**, Polymath Tech's own system for managing every POS Suite client. In it you see every client's licences, subscriptions, health and usage, and you release updates. How it works inside is in [22-polymath-console.md](22-polymath-console.md); this guide is the *doing*.

A printable copy: `pnpm manual:pdf -- --doc docs/23-polymath-console-deployment.md` (in `manual-pdf/`).

**Time:** about an hour the first time, most of it waiting for Google.
**You need:** the PC you already deploy clients from (deployment manual E), your Google account, and a payment card for the Blaze plan.

At the end you will have:

- `https://polymath-console.web.app` (or your project ID), where you and your staff sign in;
- every client's system checking in once a day, so the console shows its version, devices, errors, licence and (if the owner allows) yesterday's sales;
- licences, renewals, suspensions and notices reaching clients by themselves at their next check-in;
- optionally, updates started from the console's **Deployments** page.

| What | Where it lives |
|---|---|
| The console (web app, server functions, database) | Its **own** Firebase project, for example `polymath-console`. Never a client's project. |
| Your licence signing key (private half) | On your PC in `licence-keys/vendor-key.txt` (never committed), and in the console project's **Secret Manager**. |
| The console's address for check-ins | `apps/functions/.env` (`CONSOLE_URL`) on your PC, the GitHub variable `CONSOLE_URL`, and every client's server functions after their next deploy. |
| Console settings on your PC | `release/console.json` (no secrets; commit it) and `apps/console-functions/.env` (git-ignored). |

---

## A. Before you start

1. The project folder is up to date on your PC (PowerShell or Command Prompt, in the folder):

   ```bash
   git pull
   ```

   ```bash
   pnpm install
   ```

2. The Firebase CLI is signed in with **your** Google account (the one that will own the console project):

   ```bash
   pnpm exec firebase login
   ```

3. Your licence signing key is on this PC: `licence-keys/vendor-key.txt`. It was created by `pnpm deploy:setup` when you set up your first client. **Keep a copy somewhere safe (a password manager or an encrypted USB key).** If you lose it you can't issue licences that your clients' systems accept. If this PC doesn't have it, copy it from your backup now; don't create a new one.

## B. Create the console's Firebase project

1. Open [console.firebase.google.com](https://console.firebase.google.com) → **Create a project**.
2. Name: `polymath-console` (Firebase may add a few characters to make the ID unique; note the **project ID** it shows).
3. Google Analytics: **off**. Create the project.
4. Upgrade to **Blaze** (bottom-left, *Upgrade*). Server functions need it. Add a **budget alert** of USD 5: the console costs nothing or a few cents a month (section W), and the alert tells you if that ever changes.

## C. Firestore database

1. **Build → Firestore Database → Create database**.
2. Location: **asia-south1 (Mumbai)**, the same region as your clients.
3. Start in **production mode** (the console's own rules replace the defaults when you deploy).

## D. Sign-in methods

1. **Build → Authentication → Get started**.
2. **Sign-in method → Google → Enable**. Choose your support email. This is how you and your staff sign in.
3. Optional: **Email/Password → Enable**, for staff without a Google account. They must confirm their email before the console lets them in.
4. **Settings → Authorized domains** already lists `PROJECT-ID.web.app` and `PROJECT-ID.firebaseapp.com`. Leave it; add a domain only if you set one up (section U).

## E. Register the web app

1. **Project settings** (gear icon) → **Your apps** → the web icon `</>`.
2. Nickname: `Polymath Console`. Leave *Firebase Hosting* unticked (the deploy sets it up).
3. Click **Register app**, then **Continue to console**. You don't need to copy the settings it shows: the console reads them from Firebase Hosting by itself.

## F. Set up the console from your PC

In the project folder:

```bash
pnpm console:setup
```

It asks two things:

| Question | Answer |
|---|---|
| Console's Firebase project ID | The ID from B.2, for example `polymath-console` |
| Owner's email | **Your** Google account's email. That account becomes the console's owner the first time it signs in. |

Then it:

1. stores your licence signing key in the console project's **Secret Manager** as `LICENCE_PRIVATE_KEY` (only the console's server functions can read it), and `GITHUB_TOKEN` as `none` for now (section Q);
2. writes `apps/console-functions/.env` (owner, region, licence public key) and `release/console.json`;
3. adds `CONSOLE_URL=https://PROJECT-ID.web.app/api/checkin` to `apps/functions/.env`, so **every client deploy from now on** tells that client's system where to check in.

Commit `release/console.json` (it holds no secrets) so another PC finds the console too. Running `pnpm console:setup` again is safe.

If it says the project isn't on Blaze, or that you aren't its owner, finish B.4 or sign in with the right account (`pnpm exec firebase login`), then run it again.

## G. Deploy the console

```bash
pnpm console:deploy
```

The first time takes 5–10 minutes. It builds the console, checks the project's permissions for server functions (switching on what Google needs), creates the web address, and deploys the web app, the server functions (`checkin`, `consoleApi`, `housekeeping`), the security rules and the database indexes. On a brand-new project Google needs a few minutes before functions can be deployed; the tool waits and tries again by itself (3 and then 5 minutes). Leave the window open.

It ends with:

```
✓ Polymath Console is live: https://polymath-console.web.app
```

Running it again is safe. You also run it after every update of the console itself (section V).

## H. First sign-in (you, the owner)

1. Open the console's address in Chrome or Edge.
2. **Sign in with Google**, using the owner's email from F.
3. The console recognises you as **Owner** and opens the **Overview**.

If it says your account isn't invited, you signed in with a different account than the owner's email in F: sign out (*Use another account*) and choose the right one, or run `pnpm console:setup` again with the right email and redeploy (`pnpm console:deploy`).

## I. Company details (what your clients see)

**Settings → Company**: name (Polymath Tech), support email, phone, WhatsApp, website, address. Save.

Every client's back office shows these on **About → Polymath Tech: help and support**, from their next check-in. The website also appears on the console's *Polymath Ecosystem* card and *Discover Polymath* button.

## J. Your staff

**Staff → Invite**: their email and role. They open the console's address, sign in with that email (Google, or *Invited? Create an account with your email*), and join with that role. Deactivate someone in the same place; they lose access at once.

| | Owner | Admin | Sales | Support | Engineer |
|---|---|---|---|---|---|
| See clients, health, usage, licences, reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| Add and edit clients, subscriptions, payments | ✓ | ✓ | ✓ | | |
| Issue and renew licences | ✓ | ✓ | ✓ | | |
| Suspend and restore | ✓ | ✓ | | | |
| Start updates (deployments) | ✓ | ✓ | | | ✓ |
| Staff, company details, GitHub settings | ✓ | ✓ (not owners) | | | |

Every change anyone makes is in the **Audit log** (who, what, when). Nobody can edit or delete it, not even you.

## K. Add your clients

**Clients → Add client** (or **Add client** on the Overview):

| Field | What to enter |
|---|---|
| Client id | Short, lowercase, with dashes, the same as in `release/clients.json`: `noura-kitchen` |
| Name / Registered name | Noura Kitchen / Noura Kitchen (Pvt) Ltd (the registered name goes on licences) |
| Firebase project ID | The client's project: `noura-kitchen-pos` |
| Project number | Optional: Firebase console → client's project → Project settings → *Project number*. If you leave it empty you confirm it once at their first check-in (L.4). |
| Release wave | 1 for pilot clients (updated first), 2 for everyone else |
| Industry, Town or city, Country | For the Overview's map and the reports. In Sri Lanka, type the town (Colombo, Kandy, Galle…); the list suggests the ones the map knows. |
| Contact person, email, phone | Who you call at the client. The Support page lists them. |
| Maintenance window | When updates may run, for example `23:30-05:00 Asia/Colombo` |

A deployed system that checks in before you add it appears on **Clients → Checked in, not a client yet**, with an **Add as client** button that fills in the project for you.

## L. Link each client's system

A client's system checks in only after it has been deployed with `CONSOLE_URL` set (F.3). For each existing client (Noura Kitchen first):

1. Deploy the client from your PC, as usual:

   ```bash
   pnpm release:deploy --target noura-kitchen
   ```

   Their server functions now know the console's address. (New clients deployed after F get it automatically.)
2. The system checks in every day at 03:17 Sri Lanka time. To see it at once, ask the client's administrator to press **About → Check now** in their back office (or do it yourself if you have access).
3. Within a minute the client's page in the console shows **Health**: server version, devices and their versions, errors in the last 24 hours, licences, and on **Usage** yesterday's figures if the owner shares them (their About page has the switch).
4. If you left the project number empty in K, the client's page says **First check-in from project number …**. Compare it with Firebase console → client's project → Project settings → *Project number*, then press **Confirm project number**. From then on only that project is answered under that client's name.

**How a check-in proves who it is:** the client's server sends a Google-signed identity token of its own project; the console checks Google's signature. No password or key is shared with clients, and one client can't pose as another.

## M. Licences

Client → **Licence** → **Issue licence** (or *Renew or change*): edition, add-on modules, limits, end date, grace days. It reaches the client's system at its next check-in (or press *Check now* there). For a client without internet, copy the licence key from the same page; their administrator pastes it in the back office under **Setup → Licence & modules**.

The client's system keeps whichever licence is newer: a key you pasted by hand is never replaced by an older one from the console.

## N. Subscriptions and payments

1. Client → **Subscription** → plan, price, billing cycle (monthly, quarterly, annual or one-off), paid-until date.
2. When a client pays: **Record payment** (date, amount, method, reference, new paid-until). Tick **Renew the licence** and the licence moves to the new date at the same time.
3. 14 days before the paid-until date the client's back office shows a renewal reminder; after it, an overdue notice. Both disappear when you record the payment.

The **Subscriptions** page shows monthly recurring revenue, renewals due, overdue clients and the latest payments. **Revenue (month to date)** on the Overview is the total of payments recorded with a date in the current month.

## O. Suspend, restore, notices

- **Suspend** (client → *Suspend / notice*): a message the client sees and a grace period in days. During the grace period their system keeps working with a warning; after it, the licensed modules stop. Their data is never touched.
- **Restore** brings everything back at the next check-in. Ask them to press *Check now* to make it immediate.
- **Notice**: a message for the owner and administrators (planned maintenance, a new feature), optionally until a date.

Suspensions and restores are signed with your licence key; the client's system checks the signature, so nobody else can suspend or restore a client, and an old suspension can't be replayed.

## P. Reading the Overview

| Figure | What it counts |
|---|---|
| Total clients | Clients that aren't cancelled; the line is how many there were each day for 30 days |
| Active systems | Clients whose system checked in within 36 hours |
| Revenue (month to date) | Payments recorded with a date this month, against the same days last month |
| System health | Healthy systems among those that have checked in at least once |
| Client distribution | Clients by country (World) or town (Sri Lanka), from each client's town and country |
| Platform health | Healthy, needing attention, offline (36 hours without a check-in), not linked yet; and how many are checking in, have a valid licence, have paid, run the latest version |

The trend lines use one set of figures a day, written every morning at 06:15 by the console (the `housekeeping` function), so they fill in over the first days. The bell at the top lists every client that needs attention; **Monitoring** has the details.

## Q. Updates from the console

**Updates** (in the menu) is where you push a version to clients: load the release notes, choose the version, tick the clients (those behind are ticked), and choose *In each maintenance window* (default), *Now* or *At a time*. Clients see a maintenance notice from their next check-in (hourly), then *What's new* after the update; a client shows **Done** when its own system reports the version. Docs/22 §8 has the whole flow.

**Without GitHub** (the simplest start): Updates still schedules the update and tells the clients; when a client is due it shows **Run on the release PC** with the command, for example `pnpm release:deploy --target noura-kitchen`. Run it from your PC on the version's code, as you do today; the client's next check-in marks it done (or press *Mark done*).

**With GitHub**, the console starts the release itself when each client is due. One-time setup:

1. **Release pipeline**: the one-time setup in [20 §3](20-release-and-updates.md) (release robot, repository variables, environments with approvals), and the access script for each client ([20 §4](20-release-and-updates.md)).
2. **GitHub variable** `CONSOLE_URL`: GitHub → repository → Settings → Secrets and variables → Actions → Variables → `CONSOLE_URL` = `https://PROJECT-ID.web.app/api/checkin` (the same as in F.3). Without it, clients updated by GitHub stop checking in.
3. **GitHub token** for the console: GitHub → your picture → Settings → Developer settings → **Fine-grained tokens** → *Generate new token*:
   - Repository access: **Only select repositories** → this repository;
   - Permissions: **Actions: Read and write**, **Contents: Read-only** (Metadata is added by itself);
   - an expiry date you will remember (set a reminder to renew it).

   Then store it in the console's Secret Manager:

   ```bash
   pnpm console:setup --github-token
   ```

   and deploy the console once more (`pnpm console:deploy`) so its functions pick it up.
4. **Settings → GitHub** in the console: owner (your GitHub account), repository, workflow file `release.yml`, release branch `main`, and your staging project ID.

**Releasing with GitHub:** Updates → choose the version and clients → *Schedule update* or *Update now*. Every 15 minutes the console starts the GitHub workflow for the clients that are due (on the tag `vX.Y.Z` if it exists, else the release branch while it is still that version), follows the run, and waits for the client's check-in. Approvals for production still happen in GitHub if you set reviewers on the environment. **Deployments** keeps the technical history and still lets you start a run to staging or a wave by hand.

## Q2. New businesses: approvals

From 1.10.0 every new business on a linked client system waits for your approval (docs/22 §9). The bell and **Businesses** show each request with who asked, whether that is the client's contact on file, and any business with the same name. **Approve**, or **Decline** with a message the owner sees. Approving a name that already exists in that system needs *It's a different business* ticked. For your own demo or training systems, switch approvals off: Clients → the client → **Controls** → *Open without approval*.

## Q3. Privacy and data

**Privacy & data** lists what the console holds and why, sets how long data is kept (applied every morning), records each client's **data agreement**, exports everything about a client (owners and admins) and, after a contract ends, erases a cancelled client's personal data. Read [24 · Privacy and data protection](24-privacy-and-data-protection.md) before you sign your first data agreement.

## R. Daily, weekly, monthly

| When | What |
|---|---|
| Every morning | Overview: the status chip and the bell. Anything red: Monitoring, then call the client (Support lists their contact). |
| When a client pays | Record the payment (N.2) with *Renew the licence* ticked. |
| Weekly | Subscriptions → *Due* and *Overdue*. Send reminders; suspend (O) only after talking to them. |
| Monthly | Reports: revenue, growth, versions. Back up the console (section T). |
| When you release | Staging first, then Updates: a pilot client, then everyone, in their maintenance windows. |
| When a client opens a business | Businesses: approve or decline the same day (they are waiting). |

## S. Notifications to clients, at a glance

Everything you change for a client reaches their system at its **next check-in** (every hour since 1.10.0, daily at 03:17 before; or when they press *About → Check now*): licences, suspend and restore, notices, the message to all clients, renewal reminders, scheduled updates (the maintenance notice), decisions on new businesses, and your company's contact details. A request to open a business checks in at once, and the waiting screen asks again every 20 seconds. Nothing is pushed into their project from outside: their own server asks, checks what comes back, and applies it.

## T. Backups of the console

The console's database holds your clients, licences, payments, staff and the audit log. Back it up once a month and before you update the console:

```bash
pnpm console:backup
```

It exports the whole database to `gs://PROJECT-ID-backups/console/<date and time>` in the console's own project (the bucket is created the first time, and backups older than 90 days are deleted by themselves), and switches on Firestore's delete protection. It uses your Firebase CLI sign-in.

To restore (only if something went badly wrong): Google Cloud console → **Firestore → Import/Export → Import**, choose the folder the backup printed.

Your clients' data is never in the console; each client's own project is backed up before every update (deployment manual, release).

## U. Your own web address (optional)

Staff can use a domain such as `console.polymath.lk`:

1. Firebase console → console project → **Hosting → Add custom domain**, and follow the DNS steps.
2. **Authentication → Settings → Authorized domains** → add the domain.

Keep the clients' check-in address on `PROJECT-ID.web.app` (`CONSOLE_URL` as set in F): it never changes, so you never need to redeploy every client. If you do want clients to check in on your domain, add `CONSOLE_DOMAINS=console.polymath.lk` to `apps/console-functions/.env`, deploy the console, then change `CONSOLE_URL` in `apps/functions/.env` and the GitHub variable, and deploy every client.

## V. Updating the console itself

When a new version of the system comes out:

```bash
git pull
```

```bash
pnpm install
```

```bash
pnpm console:backup
```

```bash
pnpm console:deploy
```

Staff see the new version when they reload the page. Client systems are updated separately (`pnpm release:deploy`, or Deployments).

## W. Costs

The console is one more small Firebase project: a few hundred database reads and writes a day, one scheduled job (housekeeping, daily), two secrets, a few check-ins a day per client. That is inside Firebase's free allowances; expect USD 0 to a few cents a month. Backups are small files in Cloud Storage (cents a month). Each client's check-in is one function call a day in *their* project, also inside the free allowances.

## X. Security checklist

- [ ] `licence-keys/vendor-key.txt` is backed up offline and never committed, emailed or pasted into chat.
- [ ] Only you (and perhaps one trusted admin) are **Owner** or **Admin**.
- [ ] Staff who leave are deactivated the same day (Staff page).
- [ ] The GitHub token has access to this one repository only, with an expiry date, and is renewed before it expires.
- [ ] The console project's budget alert is set (B.4).
- [ ] `pnpm console:backup` runs monthly.
- [ ] Two-step verification is on for your Google and GitHub accounts.

What protects the console without you doing anything: staff can only **read** the database; every change goes through the console's server, which checks the person's role and writes the audit log. Client systems never touch the console's database, they only call the check-in address. Your private key is only in Secret Manager and on your PC.

## Y. Troubleshooting

| What you see | What to do |
|---|---|
| `console:setup`: *couldn't store LICENCE_PRIVATE_KEY in Secret Manager* | The project isn't on Blaze (B.4), or you're signed in with an account that doesn't own it: `pnpm exec firebase login`. |
| `console:setup`: *no licence signing key on this PC* | Copy `licence-keys/vendor-key.txt` from your backup (A.3). Don't create a new key: clients only accept licences signed with yours. |
| `console:deploy` stops with a permissions or *Eventarc* error | A new project needs a few minutes. Run `pnpm console:deploy` again. Deployment manual U lists the other Google messages. |
| Signing in says the account isn't invited | Use the owner's email from F, or ask an owner or admin to invite that email (Staff). |
| Email/password sign-in says to verify the email | Open the link Firebase emailed (check spam), then sign in again. |
| A client's page says *No check-in yet* | Deploy the client once more after F (L.1), then *About → Check now* in their back office. Check that `apps/functions/.env` on your PC has `CONSOLE_URL`. |
| *First check-in from project number …* | Confirm it after comparing with the client's Project settings (L.4). |
| *check-in refused: identity is for project …* | Another project is using this client's project ID, or the project number you typed is wrong: check K and L.4. |
| A licence or a restore doesn't arrive | It arrives at the next check-in; ask the client to press *Check now*. Their About page shows when the last check-in worked. |
| Clients stopped checking in after a GitHub release | The GitHub variable `CONSOLE_URL` is missing (Q.2). Set it and release again. |
| Deployments: *Set the GitHub repository first* or a 401/403 from GitHub | Settings → GitHub (Q.4), and the token (Q.3); after `console:setup --github-token`, run `pnpm console:deploy`. |
| Overview trend lines are flat | They fill in day by day from the morning figures (P). |

## Z. Quick reference

| Command (in the project folder) | What it does |
|---|---|
| `pnpm console:setup` | Stores your key in Secret Manager, writes the console's settings and `CONSOLE_URL` |
| `pnpm console:setup --github-token` | Stores the GitHub token for Deployments |
| `pnpm console:deploy` | Builds and deploys the console (safe to repeat) |
| `pnpm console:backup` | Backs up the console's database, switches on delete protection |
| `pnpm release:deploy --target CLIENT-ID` | Deploys or updates a client (links it to the console) |
| `pnpm console:emulators` and `pnpm console:dev` | Try the console on your PC without the cloud (22 §7) |
| `pnpm test:console` | Runs every console check on the emulators |

| Address | What |
|---|---|
| `https://PROJECT-ID.web.app` | The console |
| `https://PROJECT-ID.web.app/api/checkin` | Where clients check in (`CONSOLE_URL`) |
| `https://CLIENT-PROJECT-ID.web.app` | A client's system (linked from their page in the console) |
