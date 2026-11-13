# Trainer's guide

How to train a client's team before go-live: the plan, the training environment, the sessions and the sign-off.

## 1. Before training

1. **Training business.** In the client's back office, an owner or administrator chooses **+ Business → Try a demo business → Load Spice Lagoon** (approved by Polymath Tech first on a linked system). This creates a separate business with a full sample menu, staff, tables and seven days of sales. Sales made there never touch the real business. In a client deployment the demo works for 30 days, which covers training. (For a laptop demo without the cloud, open the system with `?mode=local`.)
2. **Devices.** Have at least one terminal (or PC) and two phones ready, signed in to the training business, with the mobile style the client chose (POS Configuration → Mobile app style). Connect a bill printer if you have one; otherwise set the workstations to *On-screen only* printing.
3. **Logins.** Trainees use the demo employees below. Give back-office trainees a back-office login on the training business with their real role.
4. **Copies.** Print the trainee's role manual and the quick-reference card. PDFs: `pnpm manual:pdf`.

**Demo employees (training business)**

| No. | Name | Role | PIN | Card |
|---|---|---|---|---|
| 1001 | Kasun Perera | Outlet Manager (restaurant manager) | 1111 | CARD1001 |
| 1002 | Nimali Fernando | Cashier (Restaurant, Takeaway) | 2222 | — |
| 1003 | Tharindu Silva | Server / Steward (Restaurant) | 3333 | — |
| 1004 | Fathima Rizwan | Server / Steward (Restaurant, Bar) | 4444 | — |
| 1005 | Suresh Kumar | Kitchen (chef de partie) | 5555 | — |
| 1006 | Dilan Jayasuriya | Supervisor (captain) | 6666 | CARD1006 |
| 1007 | Ishara Gunawardena | Bartender (Bar) | 7777 | — |
| 9000 | Owner (demo) | Owner / General Manager | 9999 | — |

## 2. Suggested schedule (two days before go-live)

| Day | Time | Session | Who |
|---|---|---|---|
| 1 | 09:00–11:00 | Steward / waiter (phones) | All front-of-house |
| 1 | 11:00–13:00 | Cashier | Cashiers, supervisors |
| 1 | 14:00–15:00 | Bar and kitchen | Bar, kitchen |
| 1 | 15:00–18:00 | Supervisor and manager | Supervisors, managers |
| 2 | 09:00–12:00 | Storekeeper | Stores, head chef |
| 2 | 09:00–13:00 | Accountant | Finance |
| 2 | 14:00–18:00 | Administrator and owner | Owner, IT |
| 2 | 18:00–20:00 | **Dress rehearsal**: a full service with real menu, real devices, in the training business | Everyone |

## 3. Running a session

1. **Show** each task once on a projector or a phone mirrored to a screen.
2. **Do:** trainees repeat it on their own device, using the exercises in their manual.
3. **Check:** trainees do the sign-off tasks without help; tick them off.

Keep the group small (up to six per trainer for POS sessions). Let trainees make mistakes in the training business: voids, wrong PINs and approvals are part of learning.

## 4. Go-live checklist

- [ ] Real business details entered and checked on a printed bill (Administration → Business & tax).
- [ ] Menu, prices and photos loaded and checked (Menu Management, or Excel import).
- [ ] Tables, order types, tenders and discounts set (POS Configuration).
- [ ] Workstations and printers set, each printer tested (POS Configuration → Workstations & printers).
- [ ] Mobile app style and bill layout chosen (POS Configuration).
- [ ] Every employee added with their own role and PIN; demo employees not used in the real business.
- [ ] Back-office logins given; owner and one administrator have access.
- [ ] Licence activated (Administration → Licence & modules).
- [ ] Every trainee signed off.
- [ ] Phones and terminals switched from the training business to the real business.

## 5. Sign-off sheet

| Name | Role | Manual | Trainer | Date | Signature |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
