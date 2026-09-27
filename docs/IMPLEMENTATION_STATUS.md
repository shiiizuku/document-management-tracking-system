# Implementation status

## Completed in this repository

The repository contains an executable, test-driven first vertical slice and the production-oriented schema/deployment foundation. Public seams cover workflow, authorization, immutable version rules, metadata search, durable notification semantics, reports, and the versioned REST API.

## Not yet pilot-ready

The planning document describes a 30-week delivery program. This initial implementation is intentionally not represented as completion of those 30 weeks. Before operational pilot use, the following adapters and evidence remain mandatory:

1. Replace the in-process application store with Drizzle/PostgreSQL repositories and transaction boundaries.
2. Wire file upload/download endpoints to private MinIO quarantine objects and the ClamAV scanner; retain the existing fail-closed file-state domain rules.
3. Implement the transactional outbox publisher and BullMQ worker instead of the current worker entry-point skeleton.
4. Add authenticated realtime notification fan-out and reconnect tests on top of persisted notifications.
5. Complete account-request approval, organization administration, profile photos, routing/forwarding UI, logical deletion UI, and metadata revision UI.
6. Add PostgreSQL/MinIO integration tests, Playwright end-to-end tests, accessibility automation, security tests, representative-load tests, and recovery evidence.
7. Validate open records-policy decisions, branding, reference format, SLA calendar, signature meaning, file allowlist/limits, and retention.
8. Rehearse coordinated PostgreSQL/MinIO backup restoration in the organization-hosted environment.

No unresolved policy is encoded as permanent behavior. Audit retention remains preserve-by-default for development only, with no automated purge.
