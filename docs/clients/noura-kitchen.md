# Noura Kitchen: onboarding plan

**Client:** Noura Kitchen · **Wave:** 1 (first client) · **Starts with:** Accounting, Inventory and Purchasing — the books and the stores. The POS is added later; nothing set up now has to be redone.

**The business already trades.** Its existing manual bills, expenses and supplier invoices come into the system from a start date, with the paper bills photographed and attached.

Follow the [deployment manual](../18-deployment-manual.md) for the technical steps; this page lists what is specific to Noura Kitchen, in order.

## 1. Project and deployment (vendor)

The Firebase project exists and the Blaze plan is active.

1. Budget alert on the project (deployment manual C): USD 5, alerts to the client and to you. Bill photos add a little storage; a restaurant still normally stays within the free quotas.
2. In `release/clients.json`, entry `noura-kitchen`: set `projectId` to the project ID and `backupBucket` to `gs://<project-id>-backups`.
3. With the client's owner, run the access script once:

```bash
bash tools/release/grant-access.sh <project-id> pos-release@YOUR-VENDOR-PROJECT.iam.gserviceaccount.com asia-south1
```

4. Set `"enabled": true` for `noura-kitchen`, then deploy (dry run first):

```bash
pnpm release:deploy --target noura-kitchen --dry-run
```

```bash
pnpm release:deploy --target noura-kitchen
```

5. Check `https://<project-id>.web.app/version.json` shows the release.

## 2. Owner account and business

1. The owner creates their account on `https://<project-id>.web.app` and verifies the email.
2. **Create business** "Noura Kitchen" with the modules **Accounting**, **Inventory**, **Purchasing** (and **Recipes** if the menu will be costed). The starter set-up is added automatically: outlet MAIN, main store, roles, payment methods, reason codes, chart of accounts and cost centre.
3. **+ Business → Load the demo restaurant** as a training copy.
4. Licence (deployment manual I): **Professional + Accounting**. It covers books and stores now and the POS later, and allows **12 workstations**: staff will use their phones as POS devices, and each phone needs its own workstation. (Starter allows only 3.) Issue against the project and business IDs shown on Licence & modules.

## 3. Configuration with the client (2–3 hours)

Work down **Administration → Setup checklist** together, using the [configuration guide](../manual/configuration-guide.md):

| Step | Decide with the client |
|---|---|
| Business & tax | Registered name, TIN, VAT registration (yes/no), SSCL, service charge. |
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

## 5. When the POS starts: staff phones

Staff use the POS on their own phones over the internet (deployment manual, sections A, K and O):

1. **At the restaurant:** bill and kitchen printers on the network, the **Print Agent** on an always-on PC with a POS terminal login (`printer@…`), Wi-Fi over the dining area and kitchen, and a 4G backup router.
2. **Turn on the POS module**; menu, tables, tenders and employees with their own PINs (sections K–M).
3. **Connect each phone** with a code: POS Configuration → Workstations & printers → Connect a phone → *new workstation* (`P01`, `P02`…). The steward scans the QR code, taps **Connect** and adds it to the home screen.
4. Sign-in policy: automatic sign-out **120 seconds** (personal phones).
5. Test: an order from each phone prints in the kitchen; one with the phone on mobile data; a bill and the cash drawer.
6. When someone leaves, or a phone is lost: **Remove** the phone and end the employee.

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
- [ ] Later: POS module, menu, employees; every staff phone connected with a code and tested with the printers (section 5 above)
