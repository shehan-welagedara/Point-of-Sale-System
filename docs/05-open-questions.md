# 05 — Open Questions

These answers shape the architecture, the scope and the build order. Short answers are fine.

## Business and scope
- **Q1. Product or bespoke?** Is this system for **this one restaurant (and its future branches)**, or do you plan to **sell it to other restaurants** as a product or subscription? The answer decides multi-tenancy, licensing, billing and white-labelling.
- **Q2. Country, currency and tax.** Which country and currency? Which taxes apply (VAT and its rate, other levies, service charge %, and whether tax is charged on service charge)? Are prices tax-inclusive or tax-exclusive? Is fiscal or e-invoicing registration with the tax authority required?
- **Q3. Restaurant profile.** What concept is it (fine dining, casual, café, quick service, bar)? How many seats and tables? Which revenue centres (dining, bar, takeaway, delivery, outdoor)? Roughly how many checks are expected per day and at peak hour? Is it inside a hotel (room charge or PMS)? Do staff get service charge or tip distribution?
- **Q4. What does "offline" mean in Phase 1?** Is there **no internet at all**, or is internet available but you don't want the cloud yet? If internet exists, WhatsApp reports and IPG payments could start in Phase 1.

## Hardware
- **Q5. Devices.** Which POS machine (brand or model, Windows or Android or iPad)? Receipt printer model? Kitchen printers, **KDS screens**, or both? Do you need a cash drawer, customer display, barcode scanner or weighing scale? Will waiters use tablets or handhelds? Do you already own any of this hardware?

## Payments
- **Q6. Payment providers.** Which **bank or card terminal** will you use (and is it able to integrate with a POS)? Which **IPG provider**? Which **QR or mobile wallet** schemes are popular locally? Do you need gift vouchers, house/credit accounts, foreign currency or tips?

## Inventory
- **Q7. Inventory depth.**
  - How many storage locations are there (main store, kitchen, bar)?
  - Should every sold item deduct stock through a **recipe**?
  - Which costing method do you want: weighted average, FIFO, or "you decide"?
  - Do purchase orders need approval levels?
  - Is there central or batch production?
  - Is the menu available as a spreadsheet to import?

## People Management
- **Q8. HR scope.** Do you need **time and attendance** (clock in/out) at the POS? Shift scheduling? **Payroll export**, and if so, which payroll system? Biometric or card login?

## Finance and reports
- **Q9. Accounting.** Which accounting software do you use (or plan to use), if any?
- **Q10. Reports and WhatsApp.**
  - What are the **5–10 reports** management looks at most?
  - Who should get WhatsApp reports, and how often (end of day, weekly, real-time alerts)?
  - Does the business have, or can it register, a **WhatsApp Business** account and phone number? Meta requires business verification.

## Future website
- **Q11. Website plans.** Which features do you want: online ordering (pickup or delivery), reservations, loyalty, gift cards? Will you build the website yourself, or should it be part of this project?

## Cloud and operations
- **Q12. Google Cloud.** Who will own the Firebase/Google Cloud account and billing? Do you have a preferred **data region** or data residency requirement? Is there a monthly running-cost budget?
- **Q13. Branding and language.** Do you have brand guidelines or a logo? Which languages are needed for the POS, receipts and the website?
- **Q14. Team and timeline.** Should I build this incrementally in this repository? What is the target **Phase 1 go-live date**? Who will provide support after go-live?
- **Q15. Existing system.** Is the restaurant running another POS today? Is there data to migrate (menu, employees, customers, stock)?
