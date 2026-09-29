# Issue tracker

Issues for this project live in **two places**, kept in sync:

1. **Local markdown (source of truth):** one file per ticket under `.scratch/document-management-system/issues/`, named `NN-<slug>.md`, numbered in dependency order (blockers first). Each file's "Blocked by" line lists the blocking ticket numbers/titles.
2. **GitHub:** `shiiizuku/document-management-system` (private). One issue per ticket, created in the same dependency order, labeled `ready-for-agent` plus a type label (`feature`/`infra`/`security`/`cross-cutting`/`polish`) and an `area:*` label. Each issue's "Blocked by" section references the real GitHub issue numbers.

All 29 tickets are published (2026-09-26). Ticket numbers map 1:1 to issue numbers (`07` → `#7`); the authoritative mapping lives in `.scratch/document-management-system/_gh_issues.json`. Bodies follow Format B: What to build / Covers user stories / Acceptance criteria / Blocked by / Related.

## Conventions

- Ticket titles are prefixed with their number (`NN: Title`) in both places; the local file number is the canonical ordering.
- Every ticket is agent-grabbable by construction: `ready-for-agent` label (GitHub) / `Status: ready-for-agent` (local).
- When a ticket's status changes, update both the local file and the GitHub issue.
- Do not close or modify parent issues.
