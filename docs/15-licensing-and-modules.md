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
- **Demo businesses** are unlimited only where the deployment uses the public demo key (your own demo environment). In a client deployment with your key, a demo business works for 30 days as a training copy, so it can't be used to trade without a licence.

## 3. Your vendor workflow

**From 1.7.0, issue and renew licences in the [Polymath Console](22-polymath-console.md)** (Clients → the client → Licence): from any browser, signed in Secret Manager with the same key, kept in the console's licence history, and **delivered to the client's system by itself** at its daily check-in (or at once with About → Check now). The client's administrator doesn't paste anything. A licence reaches every business in the client's project (or one business you choose), and is applied only if it is newer than the one in use. The console can also **suspend** a client: a message and a grace period first, then the licensed modules stop as when a licence expires; data is kept, and **Restore** undoes it. Licences and suspensions are both verified by the client with the public key, so nobody else can issue or suspend.

The command-line tool below still works, for emergencies and for a client whose system can't reach the console (paste the key into Licence & modules).

```bash
pnpm licence keygen
```

- Run `keygen` once. It writes `licence-keys/vendor-key.txt`, which git ignores.
- Back that file up offline. Losing it means re-issuing every licence.

`pnpm deploy:setup` puts the public key it prints in the two settings files for you (deployment manual F). By hand, it goes in:

```bash
# apps/web/.env.production
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

Every licence issued with the command line is also saved under `licence-keys/issued/`; licences issued in the console are in its Licences page.

The repository ships a **demo key pair** (`tools/licence/demo-key.txt`), so you can demonstrate activation (`--demo`). Its private key is public: anyone can issue demo-signed keys. A deployment that still uses the demo public key shows a warning on the Licence page. Always use your own key pair for clients.

## 4. Where enforcement stops

When a client runs the system in **their own** Firebase project, they control that project, including its rules and code. The licence then works as a strong deterrent and a contractual record, not as an unbreakable lock. This is the same position as any self-hosted software.

For hard enforcement, host clients as tenants on **your** platform project. The code supports this already:
- each business is a tenant;
- you hold the project;
- clients only sign in.

Choose per client.
