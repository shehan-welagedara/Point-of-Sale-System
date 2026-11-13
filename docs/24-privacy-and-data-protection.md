# 24 — Privacy and data protection

How POS Suite and the Polymath Console keep personal data in the right hands: who holds what, why, for how long, and what Polymath Tech and each client agree. It is written with Sri Lanka's **Personal Data Protection Act, No. 9 of 2022 (PDPA)** in mind; clients in other countries (for example the Maldives) follow their own law as well.

> **This is guidance, not legal advice.** Parts of the PDPA come into force in stages and rules under it are still being issued. Have a lawyer review your client contract and data agreement wording, and check current requirements with the Data Protection Authority of Sri Lanka.

## 1. Who holds what

The design keeps personal data where it belongs: **each client's data lives in the client's own Firebase project**, separate from every other client and from Polymath Tech's console.

| Where | What | Whose data |
|---|---|---|
| **The client's Firebase project** (`noura-kitchen-pos`) | Bills and checks, menu, recipes, stock, suppliers, books; **customers** (CRM: names, phone numbers, visits, loyalty); **employees** (names, roles, PINs stored only as salted hashes, time cards); back-office logins (email); bill photos; audit trail | The client's guests, customers, employees and suppliers |
| **The Polymath Console** (`polymath-console`) | Client records (business and legal name, address, contact person); licences; payments; each system's check-in health (versions, device ids, error counts, business names, numbers of employees and logins); daily totals **only if the owner shares them**; requests to open a business (the requester's name and email); the staff audit log | Clients (businesses) and their contact people; Polymath Tech staff |

**The console never receives** guests', customers' or employees' details, bills, menus or books. Check-ins carry versions, counts and — if the owner leaves *Share daily figures with Polymath Tech* on (About) — yesterday's totals per business (bills, covers, net sales, total).

## 2. Roles under the PDPA

| Data | Controller (decides why and how) | Processor (acts on the controller's instructions) |
|---|---|---|
| A client's customers, employees, bills (in the client's project) | **The client** | **Polymath Tech**, when it installs, updates or supports the client's system; **Google** (Firebase, Google Cloud) as Polymath Tech's and the client's infrastructure provider |
| Client records, licences, payments, check-in health and shared totals (in the console) | **Polymath Tech** | Google (the console's Firebase project) |

So each client needs, with Polymath Tech, a **data processing agreement** (§5), and each client remains responsible to its own guests and staff (privacy notice at the counter or on the bill, answering their requests: §6).

## 3. Why the console holds what it holds (lawful basis)

| Data | Purpose | Basis |
|---|---|---|
| Client records, licences, subscription and payments | Providing the software, billing, renewals | The contract with the client; tax law for payment records |
| Check-in health (versions, devices, errors, counts) | Keeping the client's system working and updated, security | The contract (support and updates); legitimate interest in the security of the service |
| Daily totals | Reports for the client and Polymath Tech's service analytics | The owner's choice: on by default, off with one switch (About) |
| Requests to open a business (requester's name and email) | Two-step validation: checking that the person asking is entitled to (docs/22 §9) | The contract; legitimate interest in preventing misuse and duplicates |
| Staff audit log | Accountability for every change | Legitimate interest; the console's security |

## 4. How data is protected

- **Separation:** one Firebase project per client; nothing is shared between clients. The console is a separate project.
- **Access by role:** in each client's system, owners, administrators, managers, accountants, storekeepers, auditors, viewers and POS terminals see only what their role needs (docs/16). In the console, five staff roles (owner, admin, sales, support, engineer), and staff can only *read*: every change goes through the console's server, which checks the role and writes the audit log.
- **No shared secrets:** client systems prove who they are to the console with their own Google identity; licences, suspensions and business approvals are signed with Polymath Tech's key and checked by the client's system. Employee PINs are stored only as salted hashes; card numbers are not stored by the POS.
- **Encryption:** every connection uses HTTPS; Google encrypts stored data.
- **Audit:** every change in a client's books and master data is in its audit trail (hash-chained POS journal, sealed audit log); every console action is in the console's audit log.
- **Location:** Firestore data is stored in the region chosen when the project was created (normally `asia-south1`, Mumbai). Storing Sri Lankan personal data outside Sri Lanka is a **cross-border transfer**: cover it in the data agreement (§5) and check the PDPA's current conditions with your lawyer.
- **Minimum data:** the console receives counts and totals, not people. Sharing totals can be switched off by the owner.

## 5. The data agreement with each client

Record each signed agreement in the console: **Privacy & data → Data agreements → Agreement** (date, version, the client's data protection contact). The page shows how many clients have signed.

A data processing agreement should cover at least:

1. **Subject, duration, nature and purpose:** installing, hosting set-up, updating and supporting the POS Suite in the client's Firebase project, for the term of the contract.
2. **Data and people:** the client's customers, employees, suppliers and users; the categories in §1.
3. **Instructions:** Polymath Tech processes the client's personal data only to provide and support the system, and on the client's documented instructions.
4. **Confidentiality** of Polymath Tech staff who have access.
5. **Security measures** (§4).
6. **Sub-processors:** Google (Firebase and Google Cloud), and any other the client approves.
7. **Cross-border transfer:** where the data is stored and the safeguards.
8. **Help with rights requests** (§6) and with the client's own obligations.
9. **Personal data breaches:** Polymath Tech tells the client without undue delay, with what is known, and helps them notify the Data Protection Authority and the people affected where required (§8).
10. **End of contract:** the client receives an export of its data, then Polymath Tech removes its own access and erases what it holds (§9).
11. **Audits and information** the client may ask for.

## 6. Requests from people (access, correction, erasure)

- **A guest, customer or employee of a client** asks **the client** (the controller). The owner or administrator can find, correct and remove customers (CRM → Customers) and employees (People & Security → Employees: set *Terminated* to remove access; their past bills and time cards stay as accounting and tax records). Polymath Tech helps when asked (support).
- **A client** asks Polymath Tech what the console holds about it: **Privacy & data → Export** (owners and admins) downloads everything the console holds about that client as one file: its record, payments, daily figures, licences (without the keys), business requests, update rollouts and the audit entries about it. Corrections are made on the client's page.

## 7. How long data is kept

Set under **Privacy & data → How long data is kept** (owners and admins); applied every morning.

| Data | Default | |
|---|---|---|
| Daily figures (usage) | 730 days | Then deleted |
| Decided business requests | 730 days after the decision | Then deleted |
| Unregistered check-ins | 90 days | Then deleted |
| Deployment records | 730 days | Then deleted |
| Check-in health | Latest only | Each check-in replaces the last |
| Payments, licences | Kept | Financial and contract records, as tax law requires |
| Staff audit log | Kept | Accountability |

In each client's system, bills, books and the audit trail are kept as the client's accounting and tax records require; the client decides on anything beyond that.

## 8. If something goes wrong (personal data breach)

1. **Contain:** remove the access (a compromised login: Back-office logins → remove; a lost POS device: Devices → remove; a compromised Polymath account: Staff → deactivate).
2. **Assess:** what data, whose, how many people, what could follow. The audit trails show who did what.
3. **Tell the client** (when it is their data) without undue delay; the client, as controller, decides on notifying the Data Protection Authority and the people affected, with Polymath Tech's help.
4. **Record** what happened and what was done, and fix the cause.

## 9. When a contract ends

1. Give the client an **export** of its system (Administration → Excel import & export, the books' reports, and on request a Firestore export of its project, which is the client's own).
2. Remove Polymath Tech's access to the client's Firebase project (IAM) and its release-PC sign-in.
3. Cancel the client in the console (Clients → the client → Status), then **Privacy & data → Erase**: removes the contact details, notes, town, check-in health, daily figures and business requests the console holds. Payments, licences and the audit log stay as financial and contract records.

## 10. Checklist for each new client

- [ ] Data agreement signed and recorded in the console (Privacy & data).
- [ ] The client's data protection contact recorded.
- [ ] The owner knows about *Share daily figures with Polymath Tech* (About) and has chosen.
- [ ] A privacy notice for guests (on the bill footer or at the counter) if the client collects customer details (CRM, loyalty, delivery).
- [ ] Back-office logins limited to the people who need them, each with the narrowest role.
