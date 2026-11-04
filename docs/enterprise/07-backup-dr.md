# 07 — Backup and disaster recovery (Google Cloud Storage)

## 1. Principles

- **3-2-1:** three copies (live database, hotel backup disk, Cloud Storage), on two kinds of storage, one off site. Plus a second cloud region.
- **Immutable:** backups can't be deleted or changed before their retention ends. This holds even for an administrator or an attacker with stolen credentials.
- **Proven:** a restore drill every month. A backup that has never been restored doesn't count.

## 2. What is backed up

| System | Method | Frequency |
|---|---|---|
| `pos`, `pms` (hotel primary) | `mariabackup` full + incremental; continuous binary-log upload | Full nightly after End of Day; incremental hourly; binary logs every 5 minutes |
| `erp` (option 1: hotel; option 2: cloud) | `mariabackup` as above, plus ERPNext's own backup of files and attachments | Nightly full, hourly incremental, binary logs every 5 minutes |
| Cloud replicas | Snapshot of the replica volume | Nightly (fast disaster recovery) |
| Firestore (console configuration) | Managed Firestore export to Cloud Storage | Nightly (paid feature: small cost) |
| Hotel server configuration | Container definitions, certificates (without private keys), agent settings | On every change (also kept in the repository) |
| Audit and database logs | Cloud Logging buckets with retention lock | Continuous |

ERPNext's built-in backup to S3-compatible storage also works with Cloud Storage, through its interoperability endpoint with HMAC keys.

## 3. Cloud Storage setup

- A **separate Google Cloud project for backups**. The backup service account can **create** objects but not delete or overwrite them. Nobody's daily account has delete rights.
- Buckets in the Mumbai region, replicated to a second region.
- A **retention policy locked with Bucket Lock**, for example 35 days for hourly and daily backups and 7 years for month-end and year-end sets (to match tax and audit retention).
- Encryption with customer-managed keys (Cloud KMS).
- Lifecycle rules move older backups to Nearline, Coldline and Archive storage classes to keep cost low.
- Object names: `{client}/{property}/{system}/{yyyy}/{mm}/{dd}/{type}-{timestamp}.xbstream.enc`. Each backup has a manifest with its checksum.

## 4. Recovery targets

| System | RPO (most data that can be lost) | RTO (time to be running again) |
|---|---|---|
| POS (hotel server failure) | 0 (standby replica) | ≤ 2 minutes (automatic failover) |
| Guest system (hotel server failure) | 0 | ≤ 2 minutes |
| POS / guest system (both hotel servers lost) | ≤ 5 minutes | ≤ 1 hour on the cloud replicas; new hardware within 1–2 days |
| ERP option 2 (cloud failure) | ≤ 5 minutes | ≤ 4 hours |
| ERP option 1 (hotel failure) | ≤ 5 minutes | ≤ 4 hours on the cloud replica |
| Console configuration (Firestore) | ≤ 24 hours (nightly export; changes are also in the audit trail) | ≤ 4 hours |

These are targets for the build. They are confirmed in the contract per client.

## 5. Drills and monitoring

- **Monthly:** restore the latest backup of each system into an isolated restore environment and run the integrity checks (journals, invoice chains, ledger balances). Record the result.
- **Quarterly:** full disaster-recovery exercise per hotel: fail over to the cloud, run a test check and a test check-in, fail back.
- **Alerts:** a backup is missed or late, a checksum mismatches, replication lags by more than 5 minutes, the retention lock is missing, or the storage bucket changes.

## 6. Cost note

Backup storage is a small part of the monthly cost: tens of gigabytes per hotel, mostly in cheap storage classes. Firestore exports, the second region and KMS keys add small fixed amounts. Exact figures go in the client proposal from the Google Cloud pricing calculator.
