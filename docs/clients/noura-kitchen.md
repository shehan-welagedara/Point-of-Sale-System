# Noura Kitchen: onboarding plan

**Client:** Noura Kitchen · **Wave:** 1 (first client) · **Starts with:** Accounting, Inventory and Purchasing — the books and the stores. The POS is added later; nothing set up now has to be redone.

**The business already trades.** Its existing manual bills, expenses and supplier invoices come into the system from a start date, with the paper bills photographed and attached.

Follow the [deployment manual](../18-deployment-manual.md) for the technical steps; this page lists what is specific to Noura Kitchen, in order.

## 1. Project and deployment (vendor)

The Firebase project exists and the Blaze plan is active (deployment manual B–D). The rest happens on your PC, in a terminal (Windows: PowerShell) inside the project folder; the deployment manual E–G explains each step.

1. **Budget alert** on the project (deployment manual C): USD 5, alerts to the client and to you.
2. **Your PC, once** (deployment manual E): install Git and Node.js 22 LTS; then `npm install -g pnpm@10`; get the code from the `main` branch and run `pnpm install`; sign in to Firebase (if it fails, `pnpm deploy:check` shows the fix, for example `setx NODE_OPTIONS "--use-system-ca"`):

```bash
pnpm exec firebase login
```

   Before the first **update** (not needed now): install the Google Cloud CLI, open a new terminal, and run `gcloud auth login` and `gcloud auth application-default login`.

3. **Set up Noura Kitchen** (deployment manual F). Answer *noura-kitchen*, *Noura Kitchen* and the Firebase project ID; the first time, let it create your licence key and back up `licence-keys/vendor-key.txt`:

```bash
pnpm deploy:setup
```

4. **Deploy** (deployment manual G): look at the steps first, then deploy. The first deploy takes 5–10 minutes; there is nothing to back up yet, so it skips the backup by itself.

```bash
pnpm release:deploy --target noura-kitchen --dry-run
```

```bash
pnpm release:deploy --target noura-kitchen
```

5. **Check** that `https://<project-id>.web.app` opens, and that the back office's **About** page (launchpad → About) shows the version you deployed.

> Automatic updates from GitHub later (the access script in [20](../20-release-and-updates.md)) are optional; updates can always be deployed from your PC with the same `pnpm release:deploy` command.

## 2. Owner account and business

1. The owner creates their account on `https://<project-id>.web.app` and verifies the email.
2. **Create business** "Noura Kitchen" with the modules **Accounting**, **Inventory**, **Purchasing** (and **Recipes** if the menu will be costed). The starter set-up is added automatically: outlet MAIN, main store, roles, payment methods, reason codes, chart of accounts and cost centre.
3. **+ Business → Load the Noura Kitchen demo** as a training copy: the same set-up as theirs (not VAT registered, one counter phone with the Bluetooth printer) with a Sri Lankan menu, stock, suppliers, a month of sales and books, to explore and train on before their own data goes in. Staff sign in to the POS with 1001/1111 (manager), 1002/2222 (cashier) or 1003/3333 (steward).
4. Licence (deployment manual I). Noura Kitchen starts with **one phone** as its only POS device, so **Starter + Inventory, Purchasing, Recipes and Accounting add-ons** is enough (3 workstations: the phone plus spares). Choose **Professional + Accounting** (12 workstations) instead if they expect more staff phones soon; moving up later is a new licence key, nothing else changes. Issue against the project and business IDs shown on Licence & modules.

## 3. Configuration with the client (2–3 hours)

Work down **Administration → Setup checklist** together, using the [configuration guide](../manual/configuration-guide.md):

| Step | Decide with the client |
|---|---|
| Business & tax | Registered name, address, phone, service charge. Noura Kitchen is **not VAT or SSCL registered**: leave both off. Bills then print as a **standard bill** (Bill No, date, items, service charge, total), not a tax invoice; the Bill designer shows *Print the final bill as a TAX INVOICE* off. Turn VAT on only when they register. |
| Fiscal year | **Books start on**: the first day of the month from which bills will be entered (for example 1 April). Open the fiscal year(s). |
| Finance settings | Who keeps the books. One person → journal approval limit high (for example Rs 1,000,000); owner + accountant → 0 or Rs 50,000. Payment limit Rs 50,000 unless they prefer otherwise. |
| Accounts | Add the few they need: 6150 Gas, 6170 Telephone and internet, 3200 Owner's drawings… |
| Stock items | Their ingredients with units and costs, via the **data feeder** workbook (Administration → Excel import & export). |
| Suppliers | Via the accounting workbook (next step) or Finance → Suppliers. |
| Logins | Owner; accountant (Accountant); storekeeper (Storekeeper). |

## 4. Bringing the existing records in

1. **Photograph the paper bills.** All supplier bills, expense bills and invoices since the start date: **Finance → Bills & receipts → Add photos or scans** on a phone, many at a time.
2. **Accounting workbook.** **Finance → Excel import**, download the blank workbook (it carries their chart and stock items) and fill:
   - **Opening balances** on the start date: cash, bank, deposits, loans, capital.
   - **Suppliers** with what was owed on the start date; **Customers** only if they have credit customers.
   - **Supplier bills** since the start date (paid ones with *Paid on* and *Paid from*); **Expenses** paid without a supplier bill.
   - **Daily sales** from their manual bills, one row per day.
   - **Fixed assets** owned on the start date (kitchen equipment, furniture) with depreciation to date.
   - **Opening stock**, or count it in the system (Inventory → Stock counts → *Opening stock*).

   Show them the example first: the example workbook (`templates/accounting-workbook-sample.xlsx`, or **Download the example** on the page) is the same layout filled with a small restaurant's figures.
3. **Import:** check results → fix → import. Approve what waits under Finance → Approvals.
4. **Attach the photos:** for each imported bill, open it (Finance → Payables or All documents) → **From inbox**. Bills not in the workbook: **Record as expense** straight from Bills & receipts.
5. **Check:** trial balance against their own figures (bank balance, what suppliers say is owed).

> Stock deliveries from now on are received as **goods receipts** (Inventory → Goods receipts) with the delivery note photographed, not as expenses. Without the POS, a **Kitchen usage** count each week or month turns what the kitchen used into cost of sales.

## 5. When the POS starts: one phone and the Bluetooth printer

Noura Kitchen starts small: **one phone** as the POS and their **Xprinter XP-T80Q** (80 mm, USB + Bluetooth, ESC/POS, cash drawer port) beside it. **No Print Agent PC and no network printers** (deployment manual O.4; hardware guide, Model C):

1. **Phone:** an Android phone with Chrome (recommended). If it is an iPhone, the POS runs in the **Bluefy** browser.
2. **Printer:** 80 mm paper loaded, cash drawer plugged into the printer's drawer port, printer on.
3. **Turn on the POS module**; menu, tenders and employees with their own PINs (sections K–M). No printer records are needed.
4. **Connect the phone** with a code: POS Configuration → Workstations & printers → **Connect a phone** → name *Counter phone* → **+ New workstation** (`P01`) → **How this phone prints: Bluetooth printer beside it (Chrome on Android)** → **Show the code**. Scan it with the phone, **Connect**, add to the home screen.
5. **On the phone:** **Connect printer** → **Choose the printer** → pick the XP-T80Q from the list → **Test print**.
   If the printer doesn't appear or the test doesn't print, use RawBT: install RawBT, pair the printer in Android Bluetooth settings (PIN `0000` or `1234`), choose it in RawBT, and set the workstation's **Bluetooth route** to **Through the RawBT app**.
6. **Kitchen tickets and bills on the one printer.** Nothing to set up: with no kitchen printer, **Send KOT** prints the kitchen ticket on the XP-T80Q straight away (leave *Kitchen and bar tickets* on the same printer in the workstation, and *Print a kitchen ticket (KOT) when an order is sent* on in POS Configuration → POS options). The cashier tears the ticket off for the kitchen; the bill prints on the same printer at payment. A lost ticket: order → ⋮ → **Print kitchen ticket again (KOT)**, marked REPRINT.
7. **Test:** an order → **Send KOT** (only the kitchen ticket prints, no bill, the drawer stays shut), **Reprint KOT** (REPRINT on the ticket), a cash payment (the standard bill prints and the drawer opens), the X report.
8. **More devices later:** connect each phone with a code. A tablet or PC at the counter uses the same app with its own wide layout (menu and order side by side), so nothing new to learn. With several devices, a Print Agent PC and network printers (sections K and O) are usually better than a Bluetooth printer per phone.

## 6. Training

| Who | Manual | Time |
|---|---|---|
| Owner / administrator | Training 07 (administrator) + configuration guide sections 1–4 | 2 h |
| Accountant | Training 06 (accountant), including 1a and 1b (bill photos, daily sales, import) | 4 h |
| Storekeeper | Training 05 (storekeeper): stock items, goods receipts with photos, counts | 3 h |

Hand over the PDFs (`pnpm manual:pdf -- --client "Noura Kitchen"`): user manual, configuration guide, training manuals 05–07.

## 7. Go-live checklist

- [ ] Deployed; version page shows the release; budget alert set
- [ ] Owner account, business with Accounting, Inventory, Purchasing; licence activated
- [ ] Business & tax details; fiscal year from the start date; approval limits chosen
- [ ] Stock items imported; suppliers in
- [ ] Opening balances, bills, expenses and daily sales since the start date imported; approvals done
- [ ] Opening stock counted
- [ ] Bill photos attached
- [ ] Trial balance agreed with the owner
- [ ] Accountant and storekeeper trained and signed off
- [ ] Later: POS module, menu, employees; the phone connected with a code and printing to the XP-T80Q over Bluetooth: test page, Send KOT (kitchen ticket only), Reprint KOT, standard bill and cash drawer (section 5 above)
