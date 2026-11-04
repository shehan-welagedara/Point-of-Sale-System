# 15 — Licensing and modules

Clients buy an **edition** plus optional **add-on modules**, with **usage limits**. You (the vendor) issue a signed **licence key**. The client's administrator activates it, then switches on the modules they need within it. This follows current cloud/SaaS practice: subscriptions with entitlements, as in Salesforce, Oracle Cloud, Keygen and Cryptlex.

## 1. Editions

| Edition | Modules | Limits (properties / revenue centres / workstations / employees / back-office users) | Add-ons |
|---|---|---|---|
| **Starter** | POS, tables, customers, LankaQR, PayHere, sales reports | 1 / 2 / 3 / 40 / 3 | Recipes, inventory, purchasing, loyalty, WhatsApp, accounting |
| **Professional** | Starter + recipes and costing, inventory, purchasing, loyalty, WhatsApp | 2 / 8 / 12 / 200 / 10 | Accounting |
| **Enterprise** | Everything, including the general ledger and audit | 25 / 150 / 300 / 5,000 / 250 | — |
| Trial | Everything, 30 days | 1 / 3 / 3 / 25 / 3 | — |
| Demo | Everything, for your demonstrations (not for live trading) | 5 / 20 / 20 / 500 / 20 | — |

Limits can be raised for an individual licence (`--limits workstations=20`). The editions are defined in `packages/core/src/licensing.ts` and are easy to adjust to your price list.

## 2. How it works

```mermaid
sequenceDiagram
  participant V as You (vendor)
  participant A as Client admin
  participant F as licenceApi (client's Firebase)
  V->>V: pnpm licence issue (signs with your private key)
  V->>A: licence key (POSL1.…)
  A->>F: Administration → Licence & modules → Activate
  F->>F: verify signature (public key), project, dates
  F->>F: write edition, entitlement, licence; clamp modules
  A->>A: switch licensed modules on/off
```

- **Key:** the entitlement as JSON, signed with ECDSA P-256 (SHA-256). It cannot be edited to add modules or capacity, because any change breaks the signature.
- **Binding:** each key is bound to one Firebase project id, and optionally to one business id. A key issued for one client doesn't work for another.
- **Validity:** a subscription runs to an end date with a grace period (default 14 days). After that, modules switch off and data is kept. Perpetual licences use the end date for support and updates.
- **Enforcement:**
  - Only the licence function may write the edition, entitlement and licence (security rules).
  - Module switches must stay inside the entitlement (security rules).
  - Accounting operations check the entitlement on the server.
  - The app refuses to add workstations or employees beyond the limits.
- **New businesses** start as a 30-day trial with the modules chosen at installation, or as the demo.

## 3. Your vendor workflow

```bash
pnpm licence keygen
```

- Run `keygen` once. It writes `licence-keys/vendor-key.txt`, which git ignores.
- Back that file up offline. Losing it means re-issuing every licence.

Put the public key it prints in each deployment:

```bash
# apps/web/.env.local
VITE_LICENCE_PUBLIC_KEY=MFkw…
# apps/functions/.env
LICENCE_PUBLIC_KEY=MFkw…
```

Issue a licence for a client. The client finds their project and business ids under Administration → Licence & modules.

```bash
pnpm licence issue --licensee "Lagoon Hotels (Pvt) Ltd" --edition professional --addons accounting --project lagoon-hotels-prod --months 12
```

Inspect a key:

```bash
pnpm licence show POSL1.…
```

Every issued licence is also saved under `licence-keys/issued/` as your register of sales.

The repository ships a **demo key pair** (`tools/licence/demo-key.txt`), so you can demonstrate activation (`--demo`). Its private key is public: anyone can issue demo-signed keys. A deployment that still uses the demo public key shows a warning on the Licence page. Always use your own key pair for clients.

## 4. Where enforcement stops

When a client runs the system in **their own** Firebase project, they control that project, including its rules and code. The licence then works as a strong deterrent and a contractual record, not as an unbreakable lock. This is the same position as any self-hosted software.

For hard enforcement, host clients as tenants on **your** platform project. The code supports this already:
- each business is a tenant;
- you hold the project;
- clients only sign in.

Choose per client.
