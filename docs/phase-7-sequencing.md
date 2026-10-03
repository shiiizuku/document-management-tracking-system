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

**Nine open boxes and four policy-encoding gaps.** Not five — see the correction below. **Wave B
landed on 2026-10-03** and closed the EICAR test, the CI harness and the oversize upload; **Wave A
landed the same day** and closed three of the four policy gaps. Seven boxes and one gap remain.

| Open boxes |                                                                              |
| ---------- | ---------------------------------------------------------------------------- |
| Slice 0.1  | traceability matrix · acceptance scenarios · risk register                    |
| Tests      | ~~EICAR integration test~~ · Playwright E2E · axe sweep · load test          |
| Ops        | backup/restore rehearsal · runbooks for incident, scanner-down and Redis-loss |

| Policy gap                                                           | Register row |
| -------------------------------------------------------------------- | ------------ |
| Audit retention — decided, unimplemented                             | P-08         |
| ~~Release methods — decided, the enum is short of it~~               | P-15         |
| ~~Decision 152's other half — Records Unit as a Section in the ORD~~ | —            |
| ~~The Director's development password~~                              | — (ADR-0006) |

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

1. ~~**Decision 152 changes the seed**~~, and the seed is what E2E fixtures and load-test data
   build on. Closed by Wave A: there is no standalone `RECORDS` division any more, so C1's
   scenarios and D1's pilot seed can be written against the structure that will ship.
2. **Acceptance scenarios are the script E2E automates.** Writing them first makes the E2E work
   transcription rather than design — so the Slice 0.1 item that looks like paperwork is a
   prerequisite, not a trailing chore.
3. ~~**CI has no MinIO and no ClamAV.**~~ Closed by Wave B: the `integration` job starts both from
   compose, so the EICAR test and the "proven on real storage" audit box are done and the
   Playwright harness has the pattern it needs to copy (C2 below).
4. **Three items are blocked on people, not code.** Chase them now so they are unblocked when their
   turn comes.

---

## Wave A — settle the data model and the seed

**Done 2026-10-03.** ~5 sessions. Two migrations, `0009` and `0010`, and the organization tree C1
and D1 build fixtures on is now fixed.

- [x] **A0** (0.5h) Strike the parallel-route "deferred" note from both docs; Phase 3 backend → `✅`;
      comment `completed_at` as deliberately unused. _Done-when:_ the docs no longer claim an open
      policy that ADR-0005 closed.
- [x] **A1** (2h) Migration `0009`: the Records Unit becomes a Section inside the ORD.
      _Done-when:_ the seeded records officer sits inside the ORD, so its drafts take the
      `FOR_SIGNATURE` path and ADR-0007's exemption is reachable without hand-editing rows.

  **The `RECORDS` division is deactivated, not dropped.** This box said "drop"; decision 152 says
  "deactivated, never deleted: division codes are embedded in reference numbers already issued",
  and the decision wins. It also dissolves A2's hardest question — dropping the division would mean
  deciding what happens to its `reference_counters` rows, and there is no answer to that which
  cannot reissue a number. Keeping the row keeps the counter, and nothing can allocate from it
  because no account is placed there.

  The prediction held: **no application change at all.** The ORD is identified by division code and
  `isOrdDivision` reads that code, so the exemption kept working untouched.

  One thing the plan did not anticipate: **the migration must not create the ORD unconditionally.**
  `ORD_DIVISION_CODE`'s comment already says the pilot's ORD row is created by configuration rather
  than by a migration, and `files.int.test.ts` / `scanner.int.test.ts` prove it — they migrate a
  fresh schema and then insert their own ORD at a fixed id, so an unconditional `INSERT` collided
  on `divisions_code_unique`. Every statement in `0009` is now conditional on a `RECORDS` division
  existing; a database that never had one is left entirely alone and gets its tree from the seed.

- [x] **A2** (2h) The same migration's data half: existing `documents.division_id = RECORDS` rows
      repointed. _Done-when:_ **already-issued `RECORDS-<year>-<n>` reference numbers are unchanged.**

  Asserted in `migration.int.test.ts`, which seeds the pre-`0009` shape and checks the reference
  after. The reversibility note is at the head of the migration; the one thing the reverse cannot
  recover is which former section a row sat in, because the forward direction collapses every
  section of the old division into one — lossless for the pilot's single `INTAKE`, and called out
  for a deployment with more.

  Two judgement calls the box did not mention, both in the migration's comments:

  - **`document_routes` recipients are repointed**, even though a hop is evidence of where a
    document went. `query-scope.ts` resolves read scope through those columns, so a hop left
    pointing at the retired division would hide the document from the unit that now holds it.
  - **Only `PENDING` account requests are repointed.** A decided request is a record of what was
    asked for and granted, so rewriting it would falsify it — but approval runs `resolvePlacement`,
    which refuses an inactive division, so an open one would become unapprovable.

- [x] **A3** (2h) The Director account becomes deployment configuration rather than seed data.
      _Done-when:_ a production boot with no Director account fails loudly at config validation
      instead of silently seeding a development password.

  `DIRECTOR_EMAIL` / `DIRECTOR_PASSWORD`, validated by `validateDirectorAccount`, which both
  `validateEnvironment` and the seed call. Three outcomes: both set and that account is created;
  neither set outside production and `director@dts.local` is still planted, because a developer's
  first `db:seed` has to yield a signatory; neither set **in** production and it throws. A
  half-configured pair is always an error — falling back to the development account because only
  the password was given is how a deployment ends up signing as a default.

  It is a separate exported function rather than part of `validateEnvironment` for one reason: the
  seed runs in the migrator image, which is handed a `DATABASE_URL` and little else, so making it
  validate the whole environment would turn an absent `REDIS_URL` into a failure to seed.

  **The same hazard remains for `SEED_ADMIN_PASSWORD`**, which still falls back to
  `Admin@12345!` in any environment. Out of this box's scope, and worth its own.

- [x] **A4** (2h) P-15: `release_method` stops being a pgEnum and becomes configurable rows, seeded
      Emailed / Postal / LBC / JRS / Picked Up / Personally Delivered. _Done-when:_ LBC and JRS are
      recordable.

  Migration `0010`. `release_events.method_id` is an FK, the four old values map forward, and
  `GET /release-methods` feeds the dialog's picker — which no longer holds a code-to-label table,
  because the label is served.

  **Scoped wider than this box, deliberately.** Decision 27 as amended has a second half the box
  did not carry: "a method may be flagged as requiring a tracking reference, which is then
  mandatory at release." Implementing the list without it would have left P-15 half-encoded, which
  is exactly the failure mode this document keeps finding. So `release_methods.requires_tracking_reference`
  exists, LBC and JRS are flagged, `release_events.tracking_reference` holds the consignment number,
  and `WorkflowService` makes it mandatory for a flagged method — and **refuses it for an
  unflagged one**, because a tracking number against "Picked up" asserts that something can be
  traced when it cannot.

  The cost of configurability, paid in one place: an unknown or deactivated code is a 400 from
  `DocumentsService` rather than a schema rejection, because which codes exist is a row and not a
  Zod enum. The wire value is still shape-constrained (`releaseMethodCodeSchema`, upper snake
  case).

  An administration screen for the list is **not** here. The decision asks for a list that is
  configurable, which it now is — a seventh carrier is an INSERT, not a migration — and a CRUD UI
  for it is a separate box.

## Wave B — give CI the dependencies it lacks

**Done 2026-10-03.** ~4 sessions, and it unblocked three later boxes.

- [x] **B1** (2h) ClamAV in CI, then the EICAR test: upload → auto-scan → download, asserting the
      version stays `INFECTED` and the download stays closed. _Done-when:_ fail-closed is proven
      against a real scanner in CI.

  Done in `scanner.int.test.ts`, which drives the production path — upload, outbox relay, BullMQ,
  `scanUploadedVersion`, clamd INSTREAM — and then checks that download and preview both refuse and
  that a manual `CLEAN` override is rejected. One thing the plan did not anticipate: **EICAR cannot
  be uploaded as itself.** The upload gate sniffs the media type from the magic bytes, so plain text
  is refused before the scanner ever sees it; the fixture is therefore the EICAR string inside a PDF
  stream, which clamd detects and the gate accepts. It is held as base64 so a checkout does not trip
  the developer's own desktop scanner.

  **Do not use a GitHub Actions `services:` block.** The service needs `infra/clamav/clamd.conf`
  bind-mounted, and services start _before_ the repo is checked out, so the mount cannot resolve. Use
  `docker compose up -d clamav` in a step. Budget for the definition download — `start_period` is 90s
  and freshclam adds more; cache `clamav_data`. `.gitattributes` already pins `infra/**` to LF, so the
  CRLF failure that kept clamd from starting cannot recur.

  The whole stack now comes up through `docker compose up -d --wait --wait-timeout 420` rather than
  only clamav, which keeps one set of service definitions for CI and for a developer. The definitions
  are **not** cached after all: they ship in the image, freshclam tops them up in the start period,
  and a stale signature database is the one thing that would make a fail-closed test pass for the
  wrong reason.

- [x] **B2** (2h) MinIO in CI; re-point `files.int.test.ts` at the real adapter. _Done-when:_ the file
      suites run against real object storage, which is what makes the M3 audit box honest.

  Harder than it looks: there is no pullable image. AIStor is license-gated and the community image is
  gone, which is why `./minio` is vendored and built from source. Build it in the integration job with
  a buildx cache keyed on `minio/go.sum`.

  Built with `docker compose build minio` and cached as a `docker save` tarball keyed on
  `minio/go.sum` + `go.mod` + the Dockerfile, which is simpler than threading a buildx cache through
  compose and skips the build entirely on a hit. The suite's storage override is gone. One trap for
  C2/C3: `setup-int-env.ts` used to default the `MINIO_*` variables, which **shadowed** the
  credentials the running MinIO was actually started with and surfaced as an authentication failure
  mid-suite. It now defaults none of them — they come from `.env` locally (compose reads the same
  file) and from the job environment in CI.

- [x] **B3** (1h) The oversize upload. _Done-when:_ an over-`UPLOAD_MAX_BYTES` upload is refused by a
      test. The limit is validated at boot today but nothing asserts the refusal.

  The refusal could not be asserted as specified, because `UPLOAD_MAX_BYTES` was **dead
  configuration**: it was validated at boot and then read by nothing, while the enforced limit was
  the compiled 25 MiB `MAX_ATTACHMENT_BYTES`. A deployment configuring 5 MiB got 25 MiB. So the box
  grew a small fix: `AttachmentsService` reads the variable, and boot validation refuses a value
  above `MAX_ATTACHMENT_BYTES`, which stays the hard ceiling because it is a decorator argument on
  the multipart parser and cannot be raised from the environment. `upload-limit.test.ts` covers all
  three — over-limit refused, under-limit accepted, and a too-high configuration refused at boot.

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

A4's confirmation is now the only one that is **chasing applied code rather than blocking it**. The
mapping was applied as planned because the alternative — reading `MAILED` as a courier and splitting
it across LBC and JRS — would invent a carrier the row never recorded. If the answer comes back
differently, the correction is an `UPDATE` of `release_events.method_id`: the old value survives in
the method row it maps to rather than having been overwritten in place.

The risk register is the one to start today: it needs nothing but a conversation, and Phase 0's gate
cannot be signed off without it.

## Shape

~25 sessions, so 5–6 weeks at 2 h/day; Waves A and B's ~9 are spent. **Wave C** is next, and C1 —
the acceptance scenarios — is the one to start: it is the script C3 transcribes, and it can now be
written against the organization structure that will actually ship.
