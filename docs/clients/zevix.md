# Zevix: onboarding and deployment plan

**Client:** Zevix · **Business:** wholesale T-shirts, selling to shops and resellers, with orders mostly over WhatsApp · **Industry model:** Wholesale & distribution ([docs/25](../25-industry-models-wholesale-whatsapp.md)) · **Release:** 1.11.0 or later · **Wave:** 1

**What they get.** The same Polymath system as every client: one codebase, one release, managed in the Polymath Console. It is set up with the *Wholesale* model, so the screens are for trade, not tables:

- **Sales & Orders** (quotations → orders → packing → dispatch → delivery, cash on delivery, credit, cheques);
- **WhatsApp Business** (inbox, ordering assistant, broadcasts, catalogue);
- **Inventory & Purchasing** (stock by size and colour, receiving from mills and printers);
- **Customers**, **Finance** (books, receivables, VAT ready when they register) and **Reports**.

**Their requirements, and where each is met:**

| Zevix needs | In the system |
|---|---|
| WhatsApp orders and delivery | The WhatsApp assistant takes orders 24/7 (design → colour → size → quantity → address → payment) and puts them on the Orders board as **New**. Staff confirm, pack and dispatch with the courier and tracking number. |
| Shops buying on credit | Credit limit and days to pay per customer. An order over the limit needs a manager. Owed amounts show by customer, with WhatsApp reminders. |
| Quotations and bulk orders | Quotations (QT-) become orders (SO-) in one tap. The size × colour grid enters a bulk order in seconds. Quantity prices apply per style. |
| Barcodes later | Every size and colour already has its SKU and an EAN-13 barcode. Labels print from *Styles → Barcodes*. Scanning at a counter needs no data changes later. |
| Quantity prices, customer price lists, size/colour extras, custom printing | Style quantity tiers. Price lists (percentage off, or set prices). XXL and colour extras. Print jobs priced per side and colour, with set-up fees. |
| Bank transfer with the slip on WhatsApp | The assistant sends the bank details. The customer's photo of the slip is attached to the order as a payment to check. *Confirm received* posts it to the books. |
| Online payment link | Offered by the assistant once PayHere is live (Administration → Integrations). |
| Cash on delivery by courier | COD amount on the parcel. *Payments & COD → Courier COD* settles the courier's statement less their fees, into the books. |
| Cheques from credit shops | Cheque register: post-dated cheques can't be banked early. Cleared confirms the payment; bounced puts the order back to unpaid. |
| VAT: not sure yet | Set up without VAT. When registered: Business & tax → VAT-registered, TIN, and invoices show VAT from then on. |
| Modern, automatic WhatsApp | Order confirmations, dispatch with tracking, delivery and payment thanks are sent automatically. Broadcasts go to opted-in shops, with STOP to opt out. The catalogue syncs to WhatsApp, one product per size and colour, with stock. |

Follow the [deployment manual](../18-deployment-manual.md) for the general technical steps. This page lists what is specific to Zevix, in order.

---

## 1. Explore first (before any deployment)

On your PC, run `pnpm dev`, open `http://localhost:5173/?mode=local`, choose *Try a demo business → Load Colombo Tees*. That demo is a T-shirt wholesaler built like Zevix: 5 styles in sizes and colours, 8 shops on price lists and credit, orders in every state, COD with couriers, a cheque, and a WhatsApp order taken by the assistant.

1. Show the owner **Sales & Orders**: the board, *New order* with the size grid, *Dispatch*, *Record payment → Confirm received*.
2. Then **WhatsApp Business → Inbox → Try as a customer**: type *hi* and order as a shop would. The order appears on the board as **New**.

Use the demo to agree on prices, credit terms and couriers before go-live.

## 2. Polymath Console (you)

1. **Clients → Add client:** Zevix, industry **Wholesale & distribution**, city, contact (the owner's email: they must be the one who signs in first), Firebase project `zevix-pos` (or the ID you create in 3), region `asia-south1`, wave 1, maintenance window `23:30-05:00 Asia/Colombo`.
2. **Licence** (after 3): **Starter** (it includes Customers and Revenue; the Point of Sale in it is simply not switched on) with the add-ons **Wholesale**, **WhatsApp Business**, **Inventory**, **Purchasing** and **Accounting**. Or **Professional** with Wholesale, WhatsApp Business and Accounting. Record the subscription.

## 3. Firebase project and deployment (you)

As in the deployment manual B–G:

1. **Google account and project** (B): `zevix-pos`, Blaze plan, budget alert USD 5 (C), Firestore in `asia-south1`, Email/Password sign-in, a web app (D).
2. **Set up the client** (F), from the project folder on your PC:

   ```bash
   pnpm deploy:setup --client zevix --name "Zevix" --project zevix-pos --yes
   ```

3. **Deploy** (G):

   ```bash
   pnpm release:deploy --target zevix
   ```

   This deploys the app, the security rules, the indexes and the functions, including **whatsappWebhook** and **whatsappApi**. If the organisation blocks public functions, run `pnpm deploy:access` as the manual says. WhatsApp must be able to reach `whatsappWebhook` without signing in, because it checks Meta's signature itself.
4. **Link to the console:** *About → Check now* in their back office, then confirm the project number in the console. From then on, updates are pushed from the console (*Updates*).

## 4. The owner opens the business

1. The owner signs up at `https://zevix-pos.web.app` with the email in the console.
2. **Set up a business:** name **Zevix**, kind of business **Wholesale & distribution**. The modules are pre-selected: Wholesale, WhatsApp Business, Inventory, Purchasing, Accounting, Customers, Revenue. **Create business**.
3. Approve the request in the console (*Businesses*). The business opens with:
   - the warehouse store;
   - a price list (*A-grade shops, 5% off*, to rename);
   - a courier to rename;
   - payment methods and roles;
   - the chart of accounts with goods sales and cost accounts.
4. **Licence:** it arrives at the next check-in (or *About → Check now*).

## 5. Configuration with the owner (a half-day session)

| Step | Where | Notes |
|---|---|---|
| Business details | Administration → Business & tax | Legal name, address, phone. **VAT off** for now. |
| Branding | Administration → Branding | Logo and colours (shown on printed quotations and invoices). |
| Bank details for transfers | WhatsApp → Connection & assistant | Exactly as customers should type them. Printed on invoices and sent by the assistant. |
| Couriers | Sales & Orders → Couriers | Each courier's COD fee (%) and fee per parcel, as in their contract, and the tracking page. |
| Price lists | Sales & Orders → Price lists | E.g. *A-grade shops 5%*, *Resellers 10%*, *Distributors*: set prices per style. |
| Styles | Sales & Orders → Styles & stock | Per style: code (e.g. `ZX-OVS01`), name, sizes, colours, price per piece, cost, quantity prices (e.g. 12+, 50+, 100+), XXL extra, pack size (12). Each size and colour becomes a stock item with a barcode. |
| Customers (shops) | Sales & Orders → Customers | Shop name, contact, area, WhatsApp number (`94771234567`), price list, credit limit and days to pay, consent to offers. Import from Excel (Administration → Excel import) if they have a list. |
| Opening stock | Inventory → Goods receipts | One receipt from the mill per delivery, in **packs** (the style's pack size) at the cost per pack. Or a stock count to start from what is on the shelves. |
| Staff logins | People & Security → Back-office logins | Sales staff: role **Sales** (orders, customers, payments received, WhatsApp; no prices or stock changes). Storekeeper: packing, stock, receiving. Accountant: books. |
| Opening balances | Finance → Journals | Bank, cash, what shops owe (per customer, from their ledger), what they owe suppliers. |

## 6. WhatsApp Business (Meta Cloud API)

Zevix's customers already message them on WhatsApp. Connecting the number to the official **WhatsApp Cloud API** lets the system answer, take orders and send updates. Meta's screens change often; the names below were right in November 2026.

### 6.1 Decide the number

- **Recommended:** a **new number** for the API (a new SIM or a landline that can receive a call or SMS once). Their current WhatsApp Business app number keeps working as it is. Customers are moved over gradually: a broadcast from the old app, the new number on invoices and bags.
- **Or the existing number:** moving it to the Cloud API means it stops working in the WhatsApp Business app, and the app's chat history stays on the phone. Meta also offers using the app and the API on the same number ("coexistence"), but only through Meta's Tech Provider sign-up. Check Meta's current rules before choosing; if in doubt, use a new number.

### 6.2 Meta Business set-up (with the owner, their Facebook login)

1. **Business portfolio:** [business.facebook.com](https://business.facebook.com) → create (or use) *Zevix*. **Verify the business** (Settings → Business info → Verify): business registration certificate, utility bill, the business phone or website. Verification lifts the messaging limits and allows the display name.
2. **App:** [developers.facebook.com](https://developers.facebook.com) → *My apps → Create app* → use case **Connect with customers through WhatsApp** (or type *Business*) → link it to the Zevix portfolio.
3. **WhatsApp → API setup:** *Add phone number* → display name **Zevix** (Meta approves it), category *Apparel & clothing*, verify the number by SMS or call, and set the **two-step PIN** (keep it in the client's password manager).
4. **Payment method:** WhatsApp Manager → *Payment settings* → add a card. Meta charges per template message, and marketing messages cost more than order updates. Replies within 24 hours of a customer's message are free. See Meta's current price list for Sri Lanka.
5. **Permanent token:** Business settings → *Users → System users → Add*, for example *zevix-system*, role **Admin**.
   - *Assign assets*: the app (full control) and the WhatsApp account (full control).
   - *Generate new token* for the app, expiry **Never**, permissions `whatsapp_business_messaging`, `whatsapp_business_management` and `catalog_management`. Copy it once.
6. **App secret:** App settings → *Basic* → **App secret** → Show.

### 6.3 Connect it in the system (owner or administrator)

1. **WhatsApp Business → Connection & assistant:** paste the **Phone number ID** and **WhatsApp Business Account ID** (Meta: WhatsApp → API setup), the display number, the **access token** and the **app secret**. Press **Generate** for the verify token, copy it, then press **Connect**. The token and secret go to the server and can't be read back.
2. **Meta → WhatsApp → Configuration → Webhook → Edit:**
   - **Callback URL:** the *Webhook URL* shown on that page, e.g. `https://asia-south1-zevix-pos.cloudfunctions.net/whatsappWebhook`;
   - **Verify token:** the one you generated;
   - **Verify and save**, then *Manage* → subscribe to **messages**.
3. Test from a phone: send *hi* to the number. The menu answers within seconds, and the chat appears in *Inbox*.
4. **Go live in Meta:** App → *Publish* (switch the app to Live mode), otherwise only test numbers get answers.

### 6.4 Assistant and templates

1. **Assistant** (Connection & assistant):
   - **Welcome:** e.g. *Welcome to Zevix! 👕 Wholesale T-shirts from 12 pcs.*
   - **Hand-over:** *A member of our team will reply shortly.*
   - **Opening hours.**
   - **Bank details.**
   - **Automatic order messages** on.
2. **Templates** (WhatsApp Manager → *Message templates → Create*; language English). The system sends them only when a customer last wrote more than 24 hours ago. Create them, wait for approval (minutes to a day), then type their names on the page.

| On the page | Category | Example text (variables in this order) |
|---|---|---|
| Order confirmed | Utility | `Your order {{1}} is confirmed: {{2}}. Thank you!` |
| Order on the way | Utility | `Your order {{1}} is on its way. Tracking: {{2}}` |
| Delivered | Utility | `Your order {{1}} was delivered. Thank you for your business!` |
| Invoice | Utility | `Invoice {{1}} for {{2}} is ready.` |
| Payment received | Utility | `We received {{1}} for order {{2}}. Thank you!` |
| Payment reminder | Utility | `Friendly reminder: {{1}} is due for order {{2}}.` |
| Quotation | Utility | `Quotation {{1}}: total {{2}}. Reply YES to confirm.` |
| New arrivals (broadcast) | Marketing | `New in at Zevix: {{1}}. Reply ORDER to see the range. Reply STOP to opt out.` |

### 6.5 Catalogue (optional, recommended)

1. [Commerce Manager](https://business.facebook.com/commerce) → *Add catalogue* → **E-commerce** → *Upload product info* → name *Zevix wholesale*. Then WhatsApp Manager → *Catalogue* → connect it to the number.
2. Photos: one per style, named by the style's id (e.g. `ZX-OVS01.jpg`), in a public folder. For example their website, or `apps/web/public/images/styles/` on the client's Firebase Hosting, which is then `https://zevix-pos.web.app/images/styles`.
3. **Connection & assistant → WhatsApp catalogue:** catalogue ID, photos folder → **Sync catalogue now**. Every size and colour is a product with its stock ("out of stock" hides it). Sync again after receiving stock or changing prices.

Customers can then browse in WhatsApp and send a cart. The assistant prices it with their price list and continues to checkout.

### 6.6 Broadcasts

*WhatsApp → Broadcasts:* choose the **New arrivals** template, fill in its text, and pick shops by tag, area or price list. Only customers who agreed to offers (tick on the customer) and never sent STOP are included. *Send test* to your own number first.

## 7. Training (two short sessions)

- **Owner / manager (1.5 h):** the orders board and what each status means; credit approvals; price lists and styles; Payments & COD (courier settlement, cheques); broadcasts; the Finance overview (sales, what shops owe, bank). Their phone: the back office installs as an app (deployment manual O; *Add to home screen*).
- **Sales staff (1 h):**
  - the Inbox: when the assistant hands over, *Take over*, reply, *Hand back*;
  - *New order* with the size grid;
  - recording payments and slips;
  - *Confirm received* only after seeing the money in the bank.
- **Storekeeper (45 min):** confirmed → *Packed*; *Dispatch* with the courier and tracking number (this takes the stock out); receiving from the mill in packs; stock counts.

## 8. Dry run and go-live

1. **Dry run** (on their system, one day before): create a test shop with your own WhatsApp number, then order through WhatsApp end to end:
   - confirm → pack → dispatch (check the stock went down);
   - record and confirm a bank payment;
   - settle a COD parcel from the courier statement;
   - check Finance → Trial balance *Balanced* and the receivable cleared.

   Then cancel the test order and mark the test customer inactive.
2. **Go-live:** announce the number (or the new number) with a broadcast from the old app and on the website or Instagram. Watch the inbox together for the first day.
3. **After go-live:**
   - *daily:* the orders board and COD with couriers;
   - *weekly:* cheques, the owed list and reminders, catalogue sync after new stock;
   - *monthly:* stock count, then Finance period close.

## 9. Later

- **VAT registration:** Business & tax → VAT-registered, TIN. Invoices print *TAX INVOICE* with VAT from that day. Customers' VAT numbers go on the customer.
- **Counter sales / barcodes:** add the **Point of Sale** module. Variant barcodes are already printed and on the items.
- **PayHere payment link:** Administration → Integrations → PayHere live; the assistant then offers *Pay online*.
