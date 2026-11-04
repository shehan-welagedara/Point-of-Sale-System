# 08 — Infrastructure and deployment

## 1. Hotel servers

A **pair of servers** in every hotel (active/standby), as with an on-property Simphony service host.

| | Small hotel (≤ 150 rooms, ≤ 6 outlets) | Large hotel (150–1,000 rooms, many outlets) |
|---|---|---|
| CPU | 8 cores | 16–32 cores |
| Memory | 32 GB (option 2) / 64 GB (option 1, with ERPNext) | 64–128 GB |
| Storage | 2 × 1 TB NVMe SSD, RAID 1 | 4 × 2 TB NVMe SSD, RAID 10 |
| Power | Dual power supplies, UPS with at least 30 minutes, generator-backed circuit | Same |
| Form | Rack server in the hotel's server room (or a robust tower) | Rack servers |
| Operating system | Ubuntu Server LTS with containers (Docker / Podman) | Same, or a small Kubernetes (k3s) cluster |

Database high availability on the pair uses MariaDB replication with automatic failover:
- a Galera cluster with an arbitrator; or
- primary/replica with a failover manager.

The choice is made in phase 4 after load and failover tests. The services move with a floating IP address.

## 2. Hotel network

- **Separate VLANs:**
  - POS (workstations, card terminals, printers, KDS);
  - servers;
  - management;
  - office;
  - guest Wi-Fi (fully isolated from everything else).
- Firewall between the VLANs; card terminals on their own segment (PCI scope).
- **Two internet links:** main fibre plus a 4G/5G backup.
- Site-to-site VPN to Google Cloud (Cloud HA VPN) over both links.
- Wired connections for fixed workstations and printers; managed Wi-Fi for handhelds and tablets, with WPA3-Enterprise for staff devices.

## 3. Google Cloud (per client project, as in Model 1)

| Service | Use |
|---|---|
| Compute Engine | Cloud MariaDB (self-managed; Cloud SQL doesn't offer MariaDB), ERPNext in option 2 |
| Cloud Run | Central POS and guest services, integration hub workers, config distribution |
| Pub/Sub | Messages between hotels and cloud |
| Cloud HA VPN | Hotel connections |
| Firebase (Auth / Identity Platform, Firestore, Hosting, Functions, Cloud Messaging) | Console, configuration master, live figures, alerts, mobile apps |
| BigQuery | Group analytics |
| Cloud Storage | Backups (separate project, [07](07-backup-dr.md)) |
| Secret Manager, Cloud KMS | Secrets and encryption keys |
| Cloud Logging, Cloud Monitoring | Logs, audit-log retention, uptime and alerting |
| Identity-Aware Proxy | Administrator access to ERPNext and servers without public ports |

Infrastructure is described as code (Terraform) in `deploy/gcp/`, so every client project is created the same way.

## 4. Releases

- **Containers** built and signed in CI, versioned with the repository tag (for example `2027.1.0`).
- **Staged rollout:** test environment → pilot hotel → all hotels of the client. The sync agent pulls approved versions only, in the hotel's maintenance window (for example 03:00–05:00 after night audit). It rolls back automatically if health checks fail.
- **Database migrations** are versioned (`db/migrations/{pos,pms}`) and backward compatible for one release, so the standby server can be updated first.
- ERPNext and Frappe HR are upgraded separately, after testing the connector app against the new version.

## 5. Monitoring and support

- Health of services, databases, replication, VPN, backups, printers, card terminals and interfaces, all reported to Cloud Monitoring and to a support dashboard.
- On-call alerts by phone (Firebase Cloud Messaging and e-mail) for critical issues.
- Remote support through the VPN, with named accounts and session recording.
- Service levels (for example response within 30 minutes for "POS down") are set in the support contract.
