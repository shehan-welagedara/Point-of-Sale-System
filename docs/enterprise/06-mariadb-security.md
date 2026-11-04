# 06 — MariaDB security baseline (all databases, hotel and cloud)

Applies to the `pos`, `pms` and `erp` databases on the hotel servers and in Google Cloud. Aligned with the CIS benchmark for MariaDB, PCI DSS scope reduction, ISO 27001-style controls and Sri Lanka's Personal Data Protection Act (No. 9 of 2022).

## 1. Version and patching

- One LTS line of MariaDB for all systems. It must be supported by the ERPNext release in use (currently 10.6 or 10.11).
- Monthly security patch window; emergency patches within 72 hours for critical issues.
- Same version in hotel and cloud, so replication and restores are predictable.

## 2. Network

- Databases listen only on private addresses:
  - hotel: the server VLAN;
  - cloud: a private VPC subnet with no public IP.
- Host firewall allows the database port only from the application services, the replica and the backup job.
- POS terminals, guest Wi-Fi and office PCs **never reach the database directly**. They talk to the services.
- Hotel ↔ cloud traffic only over the site-to-site VPN.
- Administration through a bastion host or Identity-Aware Proxy, with MFA. Never by opening the database port.

## 3. Encryption

| Where | Control |
|---|---|
| In transit | TLS 1.2+ required for every connection (`require_secure_transport = ON`), including replication; certificates from an internal CA, rotated yearly |
| At rest | Data-at-rest encryption for tables, logs, temporary files and binary logs, with a **key management plugin**. Recommended: MariaDB's HashiCorp Vault key-management plugin, with Vault auto-unsealed by Google Cloud KMS, so keys never sit on the database host. Simpler alternative for a single hotel: the file key plugin, with the key file encrypted and kept on a separate protected volume. Key rotation is yearly. |
| Backups | Encrypted before upload; Cloud Storage with customer-managed keys ([07](07-backup-dr.md)) |
| Sensitive fields | Guest ID and passport numbers, dates of birth, bank account numbers: application-level encryption (envelope encryption with KMS), so a database dump alone doesn't reveal them |
| Card data | Never stored: integrated terminals return tokens and masked numbers only |

## 4. Accounts and privileges

| Account | Rights |
|---|---|
| `pos_app`, `pms_app` | `SELECT/INSERT` on transaction tables; `UPDATE` only on mutable working tables (open checks, room status); **no `UPDATE/DELETE` on financial and journal tables** |
| `config_agent` | Write configuration tables only |
| `erp_app` | Frappe's own database user, limited to the `erp` schema |
| `replica` | Replication only |
| `backup` | Backup privileges only; it can't read application secrets |
| `report_ro` | Read-only on reporting views |
| `dba_*` (named people) | Administrative, MFA through the bastion, every session audited |

- No shared or anonymous accounts.
- `root` only through the local socket.
- Authentication with the `ed25519` plugin and strong passwords enforced with `simple_password_check`.
- Passwords held in Secret Manager or Vault, never in code or `.env` files in the repository.
- Rotated every 90 days and when staff leave.

## 5. Auditing and tamper evidence

- **MariaDB Audit Plugin** (`server_audit`) records:
  - connections and failed logins;
  - DDL, privilege changes;
  - DML on financial and configuration tables.

  Logs ship to Cloud Logging buckets with retention locks.
- **Application audit:** append-only journals with hash chains:
  - POS journal per workstation;
  - guest-system journal;
  - invoice chains;
  - `config_applied`.

  These carry the Model 1 approach to SQL. The integrity check of the Audit Center is extended to verify them in MariaDB.
- Alerts are raised on:
  - privilege grants;
  - schema changes outside a release;
  - logins from unknown hosts;
  - spikes of failed logins;
  - replication lag;
  - audit-log gaps.

## 6. Personal data (PDPA)

- Purpose and consent recorded on guest profiles; marketing only with consent.
- Retention schedule per data type (for example guest profiles kept N years after the last stay; tax records kept as the law requires).
- Anonymisation job for expired profiles.
- Data subject requests: export and erasure workflows, logged.
- Access to profiles limited by role and logged.
- Data stays in-region (Mumbai, plus the second backup region). Any processing outside Sri Lanka is documented in the client agreement.

## 7. Operations

- Hardening at installation:
  - remove test databases and anonymous users;
  - `local_infile = OFF`;
  - `secure_file_priv` restricted;
  - `skip_name_resolve`;
  - a strict `sql_mode`.
- Monitoring: disk, connections, slow queries, replication health, backup success.
- Vulnerability scanning of hosts and containers on every release.
- An external penetration test before the first go-live and yearly after.
