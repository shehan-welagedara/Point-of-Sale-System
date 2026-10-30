# Point-of-Sale-System

A restaurant **POS + Enterprise Management Console (EMC) + People Management + Inventory** platform. It is offline-first and cloud-ready (Firebase/Firestore), and its features are on par with Oracle MICROS Simphony.

> **Status:** Design phase. The documents below are drafts for review, and no application code exists yet.

## Delivery phases
1. **Phase 1, Offline**: one POS machine with a local Store Hub. The restaurant runs fully without internet.
2. **Phase 2, Online**: about a month after go-live, the existing database syncs to Firebase. EMC, People Management, Insights reports and WhatsApp reporting then move to the cloud. Selling is not interrupted.
3. **Phase 3, Website and growth**: the restaurant website (online ordering, reservations and loyalty) connects to the POS and inventory.

## Design documents
| # | Document | Contents |
|---|----------|----------|
| 01 | [Architecture](docs/01-architecture.md) | Local-first Store Hub, data model, offline→online sync and cutover, reliability, security, payments, tech stack |
| 02 | [Core feature catalogue](docs/02-feature-catalog.md) | Simphony/EMC-parity scope: POS, tender media, cash, kitchen, People Management, inventory, reports |
| 03 | [Proposed extra features](docs/03-proposed-features.md) | Optional features for you to choose (X01–X42) |
| 04 | [Roadmap](docs/04-roadmap.md) | Milestones per phase |
| 05 | [Open questions](docs/05-open-questions.md) | Answers needed to finalise the design |
