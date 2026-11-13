# 25. One platform, industry models: wholesale, WhatsApp Business, POS manager functions

**Since 1.11.0.** Polymath is one system for every kind of business, not a fork per client. There is:

- **one codebase** (the `main` branch; the Enterprise Hotel Edition stays on its own branch);
- **one release**;
- **one Polymath Console** to license, update and watch every client.

What differs between a restaurant, a T-shirt wholesaler, a salon or a café is the **industry model** a business starts with. The licence still decides what it may use.

## 1. Industry models

`packages/core/src/industries.ts` lists the models. Each one has:

- **POS mode:** tables, quick counter, retail scanning, appointments, or none;
- **default modules:** switched on when the business is opened (within its licence);
- **words:** *Check / Order / Sale / Ticket*; *Menu / Catalogue / Services*; *Guests / Customers / Clients*;
- **a demo business**, where there is one.

| Model | POS mode | Starts with | Demo |
|---|---|---|---|
| Restaurant | tables | POS, tables, recipes, stock, purchasing, customers, revenue, LankaQR | Noura Kitchen, Spice Lagoon |
| Café & coffee shop | quick | POS, recipes, stock, customers, loyalty, revenue, LankaQR | — |
| Bar & pub | tables (tabs) | POS, tables, recipes, stock, purchasing, customers, revenue | — |
| Bakery & pastry | quick | POS, recipes, stock, purchasing, customers, revenue | — |
| Retail shop | retail | POS, stock, purchasing, customers, loyalty, revenue, LankaQR | — |
| Clothing & apparel | retail | POS, wholesale (styles, sizes, colours), stock, purchasing, customers, loyalty, revenue | — |
| **Wholesale & distribution** | none | **Wholesale, WhatsApp Business, stock, purchasing, accounting, customers, revenue** | **Colombo Tees** |
| Salon & spa *(preview)* | appointments | POS, stock, customers, loyalty, revenue, LankaQR | — |
| Tattoo & piercing *(preview)* | appointments | POS, customers, revenue, LankaQR | — |
| Other services *(preview)* | quick | POS, customers, accounting, revenue | — |
| Hotel & resort | — | the Enterprise Hotel Edition (separate product) | — |

*Preview* means the core works (POS, stock, customers, books), but its own screens (appointments, consent forms) are on the roadmap.

**Where the model shows:**

- **Set up a business:** *Kind of business* picks the model, which pre-selects its modules (*Modules* to adjust).
- **Starter data:** goods businesses get a *Warehouse*, goods sales, cost and stock accounts, and return/damage reasons. Wholesale also gets a price list and a courier.
- **Administration → Business & tax → Kind of business:** shows the model; the owner can change it (words and suggestions only; modules stay as licensed).
- **The workspaces:** only those of the modules that are on. A wholesaler sees Sales & Orders and WhatsApp Business, not Point of Sale or Menu Management.
- **Polymath Console:**
  - each client business shows its model (client page);
  - approval requests show the model asked for (*Businesses*);
  - the client industry list includes the new kinds.

**Adding a model** (e.g. a pharmacy):

1. Add an entry to `INDUSTRY_MODELS`: key, POS mode, modules, words.
2. If it needs its own screens, add a module (`modules.ts`) and a workspace (`apps/web/src/workspaces.ts`).
3. Optionally, a demo in `@pos/sample-data`.

Nothing is forked; every client gets it with the next update.

**Global-ready.** `BusinessSettings` has `country`, `currency`, `locale`, `timeZone` and `taxProfile` (absent = Sri Lanka: LKR, Asia/Colombo, VAT/SSCL, IRD invoices). Today the tax engine and formats are Sri Lankan; those fields are where other countries plug in.

## 2. Wholesale (module `wholesale`)

`packages/core/src/wholesale.ts`, screens in `apps/web/src/pages/sales/`.

- **Styles** have sizes and colours.
  - Every size × colour is a **stock item** (id = SKU, e.g. `ZX-OVS01-BLACK-XL`). So receiving, FIFO cost, counts, transfers and the books work as for any stock.
  - Each variant has an **EAN-13 barcode** in the in-store range (20–29), with labels to print.
  - **Purchasing is in packs** (the style's pack size): a goods receipt of 4 packs of 12 is 48 pieces at the pack cost ÷ 12.
- **Prices**, applied in order:
  1. list price;
  2. quantity tier, counted over the **whole style** on the order (12 Black M + 12 White L = 24 → the 12+ price for both);
  3. the customer's **price list** (a percentage off, or set prices; a set price never makes a bigger order dearer than its tier);
  4. size and colour **extras** (XXL +Rs 100), never discounted.
- **Custom printing:** screen, DTF, DTG, sublimation or embroidery, per side and colour. Set-up per colour per side for screens and embroidery. Editable per order.
- **Documents:**
  - **QT-** quotation (valid for N days) → **SO-** order;
  - *New* (from WhatsApp) → *Confirmed* → *Packed* → *Dispatched* → *Delivered* (or *Cancelled*).
  - Orders that are confirmed or packed hold their stock: **free to sell** = on hand − held.
- **Dispatch:**
  - takes the goods out of stock at FIFO cost (a `sale` stock movement, so cost of sales posts with the day);
  - sets the courier and tracking number;
  - **invoices the customer** in the books (`postSalesOrder` invoice: sales on account 4020, VAT when registered, receivable per customer);
  - posts the day's cost of sales.
- **Credit:** a limit and days to pay per customer. An order on credit that takes the customer over the limit is saved for a manager, or approved by the manager who confirms it (recorded on the order). The due date is the dispatch date + the days to pay.
- **Payments** are recorded as *to check*:
  - bank transfer (and the slip photo from WhatsApp);
  - payment link, cash on delivery, cheque, cash or card.
  - *Confirm received* posts a **receipt** against the invoice (`postSalesOrder` payment), or an advance before it.
  - **Courier COD:** tick the parcels on the courier's statement; each payment is receipted with the courier's fee (parcel fee + % of cash) as bank charges.
  - **Cheques:** received → deposited (not before the date on a post-dated cheque) → cleared (receipted) or bounced (the order is unpaid again).
- **Printable** quotation, order and invoice (*Print / PDF*: the browser's *Save as PDF* to send by email or WhatsApp).
- **Access:** new back-office role **Sales**.
  - May: quotations, orders, customers, payments received, the WhatsApp inbox, take stock out on dispatch.
  - May not: change prices, styles or stock settings, or reach the books (`firestore.rules`: `canSell`).
  - The invoice link on an order is written only by the ledger function.

## 3. WhatsApp Business (module `whatsappCommerce`)

The official **WhatsApp Cloud API** (Meta), no third-party gateway. Set-up for a client: [clients/zevix.md](clients/zevix.md) §6.

```
Customer ──WhatsApp──▶ Meta ──POST (signed)──▶ whatsappWebhook ──▶ assistant (@pos/core) ──▶ Firestore (conversation, messages, draft order)
                                                                        │
Staff inbox ──whatsappApi (callable)──▶ send / order messages / broadcast / catalogue ──▶ Meta Graph API ──▶ Customer
```

- **Assistant** (`packages/core/src/whatsapp.ts`, `botReply`): a small state machine with WhatsApp buttons and lists. Steps:
  1. **Menu:** Place an order · My orders · Talk to us.
  2. **Designs:** a list with "from" prices.
  3. **Colour, then size:** stock per size shown.
  4. **Quantity:** checked against stock free to sell. The cart is priced with the customer's price list and tiers, with a hint at the next tier ("6 more of this design gets Rs 1,200 per piece").
  5. **Checkout:** saved address, another, or pickup.
  6. **Payment:** bank transfer (sends the bank details), cash on delivery, *Pay online* when PayHere is live, *On my account* for credit customers.
  7. A **draft order** lands on the board.

  It also handles:
  - **Photos:** a photo becomes a payment slip on the latest unpaid order.
  - **Carts from the WhatsApp catalogue:** priced the same way.
  - **Talk to us:** hands the chat to staff (the assistant stays quiet until *menu*).
  - **STOP / START:** opt out of and back into offers.
- **Inbox:**
  - **Take over:** replies are sent by staff and the assistant steps back.
  - **Hand back:** the assistant answers again.
  - Unread counts, the customer's shop and orders, and delivery ticks (sent, delivered, read, failed).
- **The 24-hour rule:** free-form messages only within 24 hours of the customer's last message. After that, only Meta-approved **templates**; the page maps each kind (order confirmed, on the way, delivered, invoice, payment received, reminder, quotation, new arrivals) to its template name.
- **Automatic messages** (switchable) on confirm, dispatch, delivery and payment. They skip quietly when neither the window nor a template allows a message.
- **Broadcasts:** an approved template to customers who agreed to offers, never to anyone who sent STOP. Segments by tag, area and price list; a test send first.
- **Catalogue sync:** every published style × size × colour becomes a product (`items_batch`, retailer id = SKU, grouped by style), with price and availability from stock.
- **Simulator:** before Meta is connected (and in the local demo), *Try as a customer* talks to the same assistant; messages are marked *simulated*.

**Security:**

- The access token and app secret are stored in `integrationSecrets/{tenantId}` and number routing in `waRouting/{phoneNumberId}`. The rules deny every app access to both; only the functions use them. The page only learns whether they are set.
- The webhook acts only on deliveries carrying Meta's **X-Hub-Signature-256** (HMAC-SHA256 of the body with the app secret, compared in constant time).
- **Verification** (GET) answers only a verify token stored for a connected number.
- **Repeated deliveries** (Meta retries) are recognised by message id and answered once.
- **Messages and conversations are written only by the server.** Staff may change only a conversation's mode, unread count, assignment and step.
- A number can belong to one business only.
- Not copied into the audit trail (high volume): `waMessages`, `waConversations`, `docSequences`. Broadcasts and orders are.

## 4. POS manager functions on closed checks (Simphony-style)

**POS → Functions** (also on phones: *More → Functions*):

- **Closed checks:** find any check of a day by number, invoice, table, amount or name, then:
  - **Reprint** (marked COPY);
  - **Change payment** (e.g. paid by card, rung up as cash): moves the amount between tenders in the check's own day;
  - **Refund items** (with the quantity and whether the goods go back into stock);
  - **Void check:** refused after a partial refund ("refund the rest item by item");
  - **Reopen:** a new open check with the same items, marked sent, to correct and close again.
- **Corrections never change a closed check or its tax invoice.** They issue **credit notes** (`CN-26NOV_W01_1`, numbered and hash-chained per workstation), which:
  - take the figures off the day they are issued (negative day totals, so the books post the difference);
  - restore customer spend;
  - return goods to stock at the next stock run when ticked.
- **Merge checks** (Transfer / merge), **cash pickups** from the drawer, **till counts** by denomination against the expected cash.
- **Privileges:**
  - `pos.adjustClosed` (refunds, voids, reopen and payment changes on closed checks);
  - `pos.tillCount`.

  Data update **0006** gives them to existing roles that could refund or override (managers, supervisors), and the till count to roles that run end of day (finance). Every action is in the POS journal, and the exceptions are in *Audit Center → Exceptions by employee*.
