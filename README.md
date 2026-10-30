# Point-of-Sale-System

A cloud-native restaurant **POS + Enterprise Management Console (EMC) + People Management + Inventory** platform for Sri Lanka.
- Built on Firebase/Firestore.
- Multi-tenant, so it can be sold to many restaurants.
- Features on par with Oracle MICROS Simphony, plus modern extras.

> **Status:** design approved (online-first). Development started: the calculation engine (`packages/engine`) is in place.

## Release plan
1. **R1 Core POS go-live**: POS, EMC, People Management, IRD-format bills, cash, card, LankaQR and other tenders, End of Day, reports, WhatsApp EOD reports.
2. **R2 Extended**: inventory module (recipes, FIFO), alerts, menu engineering, accounting export, digital receipts, remote monitoring.
3. **R3 Product-ready**: platform admin for onboarding clients, QR ordering and pay (optional module).
4. **R4 Website**: online ordering (optional).

## Design documents
| # | Document |
|---|----------|
| 01 | [Architecture (online-first, multi-tenant)](docs/01-architecture.md) |
| 02 | [Core feature catalogue](docs/02-feature-catalog.md) |
| 03 | [Proposed / selected extra features](docs/03-proposed-features.md) |
| 04 | [Roadmap](docs/04-roadmap.md) |
| 05 | [Decisions log & remaining questions](docs/05-open-questions.md) |
| 06 | [Sri Lanka tax & bill compliance](docs/06-sri-lanka-compliance.md) |
| 07 | [Payments & hardware](docs/07-payments-and-hardware.md) |
| 08 | [Accounting integration](docs/08-accounting-integration.md) |
| 09 | [Running-cost plan & client proposal](docs/09-costing-proposal.md) |

## Development
```bash
pnpm install
pnpm test        # runs all package tests
```
| Package | Purpose |
|---------|---------|
| `packages/engine` | Money, check calculation (discounts, service charge, SSCL, VAT, inclusive/exclusive pricing, rounding), tenders and change, IRD invoice numbers |
