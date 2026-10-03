# Phase 7 sequencing

_Written 2026-10-03, after the backlog was reconciled against the code (PR #89)._

Everything the pilot needs is built. What is left is the evidence that it is safe, fast, accessible
and recoverable, plus four policy answers that exist on paper but not in code. This document orders
that work and says what each item depends on, because the dependencies are not obvious and getting
them wrong means writing fixtures twice.

Companions: `IMPLEMENTATION_STATUS.md` holds the boxes and their _done-when_ checks;
`policy-register.md` holds the policy rows; `TO - IMPLEMENT.md` holds the inherited constraints the
core workflow revision imposes on new code.

## The count

**Nine open boxes and four policy-encoding gaps.** Not five — see the correction below.

| Open boxes |                                                                              |
| ---------- | ---------------------------------------------------------------------------- |
| Slice 0.1  | traceability matrix · acceptance scenarios · risk register                    |
| Tests      | EICAR integration test · Playwright E2E · axe sweep · load test              |
| Ops        | backup/restore rehearsal · runbooks for incident, scanner-down and Redis-loss |

| Policy gap                                                      | Register row    |
| --------------------------------------------------------------- | --------------- |
| Audit retention — decided, unimplemented                        | P-08            |
| Release methods — decided, the enum is short of it              | P-15            |
| Decision 152's other half — Records Unit as a Section in the ORD | —               |
| The Director's development password                             | — (ADR-0006)    |

### Correction: parallel-route completion semantics is not open

Decision 24 was **amended on 2026-10-02** — exactly one recipient is the lead and takes custody, the
rest are for-information, and progress gates on the lead alone (ADR-0005). It is implemented:
`leadRouteOutstanding` in `workflow.service.ts` gates `ACCEPT` and onward action,
`documents.service.ts` splits leads from copies, and `query-scope.ts` resolves scope through
`lead_hop.for_information = false`.

The pre-revision docs carried a "deferred as an open policy" note that nobody struck, and the
2026-10-03 reconciliation propagated it instead of catching it. Both docs are corrected and Phase 3's
backend reads `✅`. The one nearby loose end, `document_routes.completed_at`, is deliberately unused
and now says so in the schema.

## What drives the order

1. **Decision 152 changes the seed**, and the seed is what E2E fixtures and load-test data build on.
   Do it before anything that writes fixtures.
2. **Acceptance scenarios are the script E2E automates.** Writing them first makes the E2E work
   transcription rather than design — so the Slice 0.1 item that looks like paperwork is a
   prerequisite, not a trailing chore.
3. **CI has no MinIO and no ClamAV.** That single gap blocks the EICAR test, the "proven on real
   storage" audit box, and the Playwright harness. It is the highest-leverage box on the list.
4. **Three items are blocked on people, not code.** Chase them now so they are unblocked when their
   turn comes.

---

## Wave A — settle the data model and the seed

Nothing downstream is stable until this lands. ~5 sessions.

- [x] **A0** (0.5h) Strike the parallel-route "deferred" note from both docs; Phase 3 backend → `✅`;
      comment `completed_at` as deliberately unused. _Done-when:_ the docs no longer claim an open
      policy that ADR-0005 closed.
- [ ] **A1** (2h) Migration `0009`: the Records Unit becomes a Section inside the ORD. Drop the
      `RECORDS` division, create the `RECORDS` section under `ORD`, repoint the records officer.
      _Done-when:_ the seeded records officer sits inside the ORD, so its drafts take the
      `FOR_SIGNATURE` path and ADR-0007's exemption is reachable without hand-editing rows.
- [ ] **A2** (2h) The same migration's data half: existing `documents.division_id = RECORDS` rows
      repointed. _Done-when:_ **already-issued `RECORDS-<year>-<n>` reference numbers are unchanged.**
      Decision 153 makes them permanent and they exist on paper, so the migration moves placement
      without touching `reference_number`. This is the whole risk in A1 — write the reversibility note
      before the migration.
- [ ] **A3** (2h) The Director account becomes deployment configuration rather than seed data;
      `director@dts.local` drops out of the non-development seed path. _Done-when:_ a production boot
      with no Director account fails loudly at config validation instead of silently seeding a
      development password. ADR-0006 makes this a deployment-ordering constraint — release is gated on
      a signature nobody else may make.
- [ ] **A4** (2h) P-15: `release_method` stops being a pgEnum and becomes configurable rows, seeded
      Emailed / Postal / LBC / JRS / Picked Up / Personally Delivered. _Done-when:_ LBC and JRS are
      recordable. Touches the enum, `releaseMethodSchema`, the `RELEASE` dialog's picker, and
      `release_events.method` → FK. The four existing values map forward, `MAILED` → Postal.

A1 needs almost no application change: the ORD is identified by division **code**
(`organization.constants.ts`) and `isOrdDivision` reads that code, so the exemption keeps working.
The work is the data migration and its reversibility note.

## Wave B — give CI the dependencies it lacks

~4 sessions, and it unblocks three later boxes.

- [ ] **B1** (2h) ClamAV in CI, then the EICAR test: upload → auto-scan → download, asserting the
      version stays `INFECTED` and the download stays closed. _Done-when:_ fail-closed is proven
      against a real scanner in CI.

  **Do not use a GitHub Actions `services:` block.** The service needs `infra/clamav/clamd.conf`
  bind-mounted, and services start _before_ the repo is checked out, so the mount cannot resolve. Use
  `docker compose up -d clamav` in a step. Budget for the definition download — `start_period` is 90s
  and freshclam adds more; cache `clamav_data`. `.gitattributes` already pins `infra/**` to LF, so the
  CRLF failure that kept clamd from starting cannot recur.

- [ ] **B2** (2h) MinIO in CI; re-point `files.int.test.ts` at the real adapter. _Done-when:_ the file
      suites run against real object storage, which is what makes the M3 audit box honest.

  Harder than it looks: there is no pullable image. AIStor is license-gated and the community image is
  gone, which is why `./minio` is vendored and built from source. Build it in the integration job with
  a buildx cache keyed on `minio/go.sum`.

- [ ] **B3** (1h) The oversize upload. _Done-when:_ an over-`UPLOAD_MAX_BYTES` upload is refused by a
      test. The limit is validated at boot today but nothing asserts the refusal.

## Wave C — write the scenarios, then automate them

~7 sessions.

- [ ] **C1** (2h) **Acceptance scenarios** (Slice 0.1). One incoming→archive journey and the outgoing
      release path, given/when/then. _Done-when:_ both journeys are executable as written by someone
      who has not read the code.

  Write them against the **post-A1** org structure, and name the Director step explicitly: ADR-0006
  means the outgoing path needs a Director actor for exactly one hop, which is the thing fixtures get
  wrong.

- [ ] **C2** (2h) Playwright harness. Nothing is installed today. It needs the full stack, so it
      inherits B1/B2's compose-in-CI pattern. Decide once: per-test truncation or a seeded snapshot
      restored per spec. _Done-when:_ one trivial spec is green in CI.
- [ ] **C3** (2h) The E2E flow: login → register → upload → workflow → release, transcribing C1 rather
      than inventing coverage. _Done-when:_ green in CI.
- [ ] **C4** (2h) The axe sweep via `@axe-core/playwright` on the C2 harness — login, registry,
      document detail, dashboard, reports, audit, `/my-work`, and the three admin screens.
      _Done-when:_ no critical violations. Cheaper here than in jsdom, and the only way to catch
      focus-order problems.

## Wave D — evidence

~5 sessions.

- [ ] **D1** (2h) Pilot-sized seed + the `EXPLAIN` pass. The indexes exist; this proves they are the
      right ones. _Done-when:_ each critical query's plan is recorded against pilot-sized data.

  Watch the `documentIsPending` predicate: `PENDING` is derived from unaccepted route rows through a
  correlated subquery that the registry filter, the dashboard tiles and `pendingByDivision` all
  compose, so it is the query most likely to want an index the schema does not have.

- [ ] **D2** (2h) Load test (search + upload + workflow) over D1's data. _Done-when:_ latency and
      throughput are recorded against a stated target. The target needs setting — P-13's numbers are
      about recovery, not serving.
- [ ] **D3** (2h) Backup/restore rehearsal. The scripts and `runbooks/backup-restore.md` are already
      thorough; what is missing is a **performed** restore, timed against P-13's 2–4 hour window, with
      the evidence written down. _Done-when:_ a restore is verified against a checklist.

  Rehearse the real failure — loss of the application host — which means restoring from an archive on
  different storage, not from `./backups` on the same machine.

- [ ] **D4** (2h) Audit retention (P-08). _Done-when:_ the relocation path exists and a test asserts
      no purge path does.

  Scope this honestly. The decision is retain 5 years, then relocate to a separate database, never
  purge. The code already preserves everything, so for five years the correct behaviour is what is
  running. What is genuinely owed is the relocation path and a test that no purge exists — **not** a
  retention window that would delete things. Needs one input from IT: where the separate database
  lives.

## Wave E — the writing that needs the rest done

~4 sessions.

- [ ] **E1** (2h ×3) Three runbooks: incident response, scanner-down, Redis-loss. Match
      `backup-restore.md`'s shape. _Done-when:_ each describes observed behaviour, not inferred.

  Write scanner-down _after_ B1 and Redis-loss _after_ watching the outbox relay recover. Scanner-down
  must carry the requeue one-liner the README already has — BullMQ parks a job after 5 attempts and
  nothing retries it on its own.

- [ ] **E2** (2h) Traceability matrix (Slice 0.1): 75 stories → D-1–D-151 → MVP or deferred →
      implementation area → test. _Done-when:_ every story has a decision, a scope verdict, and either
      a test or an explicit deferral. Last, because the "test" column should name real files and C3/C4
      change what those are.

## Blocked on people, not code

Chase these now; they are not engineering work.

| Item                       | Needs                                                      | From                                    |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| Risk register (Slice 0.1)  | A named owner per risk                                     | Engineering lead, with the admin office |
| Phase 0 sign-off           | The IT infrastructure blocker (P-13) cleared               | IT operations                           |
| D4 — audit retention       | Where the post-5-year database lives                       | IT operations                           |
| A4 — release methods       | Confirmation that `MAILED` → Postal is the right mapping   | Records section                         |

The risk register is the one to start today: it needs nothing but a conversation, and Phase 0's gate
cannot be signed off without it.

## Shape

~25 sessions, so 5–6 weeks at 2 h/day. Start with **Wave B** for the biggest unblock, or **Wave A** to
get the riskiest migration done while the tree is quiet.
