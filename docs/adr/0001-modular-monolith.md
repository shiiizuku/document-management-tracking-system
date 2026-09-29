# ADR-0001: Modular monolith over microservices

- Status: Accepted
- Date: 2026-09-28
- Deciders: Engineering lead, IT operations

## Context

The DTS has eleven bounded contexts (Identity, Authorization, Organization, Documents,
Workflow, Routing, Files, Notifications, Reports, Audit, Outbox/Jobs). Every
state-changing use case must write its domain change, `workflow_event`, `audit_event`,
and `outbox_event` **in one transaction** — that invariant is the backbone of the whole
design.

The deployment target is a single institution with on-premise infrastructure and a small
operations team. There is no independent-scaling requirement and no second team that
would own a service boundary.

## Decision

Ship **one deployable API process** (`apps/api`) plus **one worker process**
(`apps/api/src/worker.ts`) that shares the same codebase and domain contracts. Contexts
are separated as **modules inside that process** (`apps/api/src/modules/<name>/`), each
with its own controller / service / repository / policy, not as network services.

Modules may depend on each other only through service interfaces, never by reaching into
another module's tables from a foreign repository.

## Consequences

- The one-transaction invariant is enforceable with a plain database transaction. No
  sagas, no two-phase commit, no eventual-consistency window inside a use case.
- A single Postgres schema means foreign keys and `SELECT … FOR UPDATE` are available
  across contexts (used by `reference_counters` and the outbox relay).
- Operations run one image, one migration path, one log stream per process type. The
  worker exists as a separate process only so slow jobs (virus scanning, exports) cannot
  block HTTP request handling.
- The cost is discipline: nothing but module boundaries stops a cross-context query, so
  the repository-per-module rule has to be reviewed in PRs.
- Extraction remains possible later. Each module already owns its tables, and the outbox
  gives an integration seam a future service could subscribe to.

## Alternatives considered

- **Microservices per context.** Rejected: it converts the single-transaction requirement
  into a distributed-transaction problem, and there is no team or scaling pressure that
  would pay for that complexity.
- **Serverless functions.** Rejected: on-premise deployment, long-running scan/export
  jobs, and persistent WebSocket fan-out all fit poorly.
