# ADR-0004: Single-host Docker Compose deployment (deployment decision record)

- Status: Accepted
- Date: 2026-09-28
- Deciders: Engineering lead, IT operations, Records section

## Context

Phase 0's completion criterion is "clean machine → `docker compose up` → healthy stack",
and Phase 7 requires a production-like environment where migrations run on both an empty
and a representative database, plus a demonstrated Postgres + MinIO restore.

The institution hosts on-premise. Documents are official records, some restricted, so the
object store and database must stay inside the institutional network. The operations team
is small and does not run Kubernetes.

## Decision

Deploy **the same `docker-compose.yml` topology on a single institutional host** for
pilot and production, with per-environment `.env` values. The topology is:

| Service   | Image                     | Role                                            |
| --------- | ------------------------- | ----------------------------------------------- |
| `postgres`| `postgres:16-alpine`      | System of record; named volume `postgres_data`   |
| `redis`   | `redis:7-alpine`          | BullMQ queues, AOF persistence; `redis_data`     |
| `minio`   | MinIO                     | Private object store for file versions; `minio_data` |
| `clamav`  | `clamav/clamav:stable`    | Malware scanner, fail-closed; `clamav_data`      |
| `migrate` | api image, `restart: 'no'`| One-shot migration runner, gates `api`           |
| `api`     | api image                 | HTTP API, `/api/v1`                              |
| `worker`  | api image, `worker.js`    | Outbox relay, scans, exports                     |
| `web`     | web image                 | Next.js client                                   |

Ordering is expressed as health dependencies, not sleeps: `api` waits for
`postgres`/`redis`/`minio`/`clamav` to be `service_healthy` **and** for `migrate` to be
`service_completed_successfully`; `worker` and `web` wait on `api` being healthy.

Every stateful service uses a **named volume**, never a bind mount, so backup and restore
operate on one documented set of volumes.

## Consequences

- One `docker compose up` reproduces the entire stack on a laptop or the server, which is
  what makes the Phase 0 criterion checkable rather than aspirational.
- `migrate` running as a gate means the API can never serve traffic against an un-migrated
  schema, including on a cold start after a rollback.
- **Single host means no automatic failover.** Recovery is restore-from-backup, so the
  Phase 7 backup/restore rehearsal is not optional — it is the availability plan. Postgres
  and MinIO must be backed up as a **coordinated pair**; a database restored to a point
  where MinIO lacks the corresponding object is a corrupt system.
- Host resources are shared. ClamAV's definition database alone needs roughly 2 GB of RAM,
  which has to be reflected in the server specification given to IT.
- Secrets live in the host `.env`. Anyone with host shell access has them; file permissions
  and restricted SSH are the compensating control.
- Horizontal scale is out of scope. If it is ever needed, `api` and `worker` are already
  stateless (sessions are JWTs, files are in MinIO), so the change is a load balancer and
  external Postgres/Redis — not a redesign.

## Alternatives considered

- **Kubernetes.** Rejected: no in-house operator, no availability requirement that pays
  for the complexity.
- **Managed cloud (RDS/S3).** Rejected: official records must remain on institutional
  infrastructure.
- **Bare-metal installs without containers.** Rejected: "clean machine → healthy stack"
  stops being verifiable, and the scanner/object-store versions drift per environment.
