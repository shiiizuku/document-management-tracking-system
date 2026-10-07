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
landed the same day** and closed three of the four policy gaps. **Waves C and D** (2026-10-04)
closed the acceptance scenarios, E2E, the axe sweep, the load test and the last policy gap. **Four
boxes remain:** the traceability matrix, the risk register, the backup/restore rehearsal (local dry
run done, second machine owed) and the runbooks.

| Open boxes |                                                                              |
| ---------- | ---------------------------------------------------------------------------- |
| Slice 0.1  | traceability matrix · ~~acceptance scenarios~~ · risk register                |
| Tests      | ~~EICAR integration test~~ · ~~Playwright E2E~~ · ~~axe sweep~~ · ~~load test~~ |
| Ops        | backup/restore rehearsal · runbooks for incident, scanner-down and Redis-loss |

| Policy gap                                                           | Register row |
| -------------------------------------------------------------------- | ------------ |
| ~~Audit retention — decided, unimplemented~~                         | P-08         |
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

  **The same hazard remained for `SEED_ADMIN_PASSWORD`**, which fell back to `Admin@12345!` in any
  environment. Closed 2026-10-04 by `validateSeedAdminPassword`: unset in production, the seed
  throws. It is checked by the seed only — the API never reads the variable, and demanding it at API
  boot would keep a bootstrap password in the long-running process's environment.

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

~7 sessions. **Done 2026-10-04.** C2–C4's done-when is _green in CI_, and the `e2e · axe
(playwright)` job has passed on every main build since (e.g. run 37199254073, the merge of #102).

Two product bugs fell out of performing the scenarios, which is the argument for writing them first:

- **`COMPLY` was unreachable from the UI.** The server requires remarks (decision 163) and the
  action runner never asked for them, so **Record compliance** sent an empty command and toasted a
  failure. The terminal state of every incoming document could not be reached. Fixed in
  `use-action-runner.tsx`, with a unit test.
- **The rail never said _Pending_.** It badged the stored column, which is `IN_PROCESS` from
  creation, so a fresh document read _In process_ beside **Accept custody**. Fixed with
  `presentedStatus` (lead hop only). The registry and _My work_ rows still badge the column; see
  the open question below.

And three harness traps worth knowing before touching `apps/e2e`:

- `config.rootDir` is the **test** directory, not the config's — `fixtures/paths.ts` resolves from
  `configFile` instead. Resolving from `rootDir` put `.auth/` and the repository root one level off.
- `next build` leaves `.next/static` out of the standalone output, and the standalone server
  **indexes static files at boot** — so they must be copied before it starts, not in the global
  setup (which Playwright runs after `webServer`). `start-web.mjs` does the Dockerfile's two copies
  and then imports `server.js` in-process.
- Stopping a run from outside Playwright (killing the npm process) orphans the three servers on
  Windows; the next run then fails on "port already used".

**Open question for the policy owner — closed 2026-10-04.** `documentIsPending` counts an
unacknowledged for-information copy as outstanding, and `query-scope.int.test.ts` pins that
deliberately — but nothing could ever acknowledge one, so any document forwarded with a copy stayed
in the registry's _Pending_ filter and the dashboard tile forever. **Copies now get an
`ACKNOWLEDGE` action**, as ADR-0005's "outstanding acknowledgement" anticipates. It stamps the
copy's own `accepted_at`, so the predicate, its partial index and the pin are unchanged: a copy is
outstanding until its division acknowledges it. It reuses `DOCUMENT_ACCEPT`, and since a copy is
readable only by the division's head (decision 160), in practice the head acknowledges.

Building it found a bug the docs had wrong: the copied head was **already offered Accept
custody**, because the engine never checked `forInformation`. Pressing it would have stamped the
copy as custody, and a unit that was both lead and copied in could stamp the copy and leave its
custody hop outstanding. `ACCEPT` is now lead hops only and `ACKNOWLEDGE` copies only. The E2E
journey still does not sign in as the Lands head, because the login throttle is per client IP and
the five-account budget is spent, so the acknowledgement is proven by `workflow.test.ts`,
`documents.int.test.ts` and the web tests instead.

- [x] **C1** (2h) **Acceptance scenarios** (Slice 0.1). One incoming→archive journey and the outgoing
      release path, given/when/then. _Done-when:_ both journeys are executable as written by someone
      who has not read the code.

  Write them against the **post-A1** org structure, and name the Director step explicitly: ADR-0006
  means the outgoing path needs a Director actor for exactly one hop, which is the thing fixtures get
  wrong.

  Done in `docs/acceptance-scenarios.md`: both journeys plus the ORD variant (ADR-0007), with the
  Director named for exactly one hop and asserted to hold exactly one button.

- [x] **C2** (2h) Playwright harness. Nothing is installed today. It needs the full stack, so it
      inherits B1/B2's compose-in-CI pattern. Decide once: per-test truncation or a seeded snapshot
      restored per spec. _Done-when:_ one trivial spec is green in CI.

  `apps/e2e`, and an `e2e` job in `ci.yml`. **Truncation, of the document side only**: the accounts
  must survive because a saved session is a JWT keyed on the user id and login is throttled to five a
  minute, and a per-spec template restore is impossible while the API holds a pool open on the
  database. The reasoning is at the head of `fixtures/database.ts`.
- [x] **C3** (2h) The E2E flow: login → register → upload → workflow → release, transcribing C1 rather
      than inventing coverage. _Done-when:_ green in CI.
- [x] **C4** (2h) The axe sweep via `@axe-core/playwright` on the C2 harness — login, registry,
      document detail, dashboard, reports, audit, `/my-work`, and the three admin screens.
      _Done-when:_ no critical violations. Cheaper here than in jsdom, and the only way to catch
      focus-order problems.

## Wave D — evidence

~5 sessions. **D1, D2 and D4 done 2026-10-04**, on branch `wave-d-evidence`. Two migrations: `0011`
adds an index and `0012` adds the audit triggers.

- [x] **D1** (2h) Pilot-sized seed + the `EXPLAIN` pass. The indexes exist; this proves they are the
      right ones. _Done-when:_ each critical query's plan is recorded against pilot-sized data.

  Watch the `documentIsPending` predicate: `PENDING` is derived from unaccepted route rows through a
  correlated subquery that the registry filter, the dashboard tiles and `pendingByDivision` all
  compose, so it is the query most likely to want an index the schema does not have.

  The warning pointed at the right table but the wrong query. `documentIsPending` is fine: its
  partial index serves it. The missing index was **any index leading with
  `document_routes.document_id`**. The current-lead-hop subquery behind `custodyDivisionId` /
  `custodySectionId` therefore scanned all 127,000 routes once per document. The registry's custody
  filters and the dashboard's pending-by-division chart took **more than 30 s** (about 90 s
  observed) on 60,000 documents. Migration `0011`'s `document_routes_document_idx` brings them to
  80–272 ms. **Every critical read is now under 300 ms**, and no other index is warranted at this
  size. Verdicts: `docs/evidence/d1-query-plans.md`. Generated plans, before and after:
  `d1-explain-plans*.md`.

  The dataset is 60,000 documents over five years. That is an assumption, because the decision
  register states no volume; it is written down in `apps/api/perf/pilot-seed.ts`. It extends
  `apps/e2e/fixtures/accounts.ts` verbatim, so D2 can sign in as the acceptance scenarios'
  principals. The plans come from the **real repository methods**, with their emitted SQL captured
  rather than hand-copied.

  The seed also put a number on Wave C's open question. Nothing can accept a for-information copy,
  so `documentIsPending` holds for **10,609** documents while only **113** await custody. The Pending
  tile and filter would be wrong by two orders of magnitude on day one of a real year.

- [x] **D2** (2h) Load test (search + upload + workflow) over D1's data. _Done-when:_ latency and
      throughput are recorded against a stated target. The target needs setting — P-13's numbers are
      about recovery, not serving.

  **Check before measuring:** the API rate-limits per client IP (120/min default, 5/min login), and
  nothing sets Express `trust proxy`. Behind the pilot's TLS ingress, every user would share one
  bucket. A load test from one machine hits the same ceiling, so it would measure the throttle, not
  the server. Settle how the limiter identifies a client first.

  Settled by PR #97 (`TRUST_PROXY`, per-user buckets). The harness starts the API with
  `TRUST_PROXY=loopback` and gives each of the 157 sessions its own forwarded address, standing
  where the ingress stands. The throttle therefore stays on and is not what gets measured.

  **Recorded, and the target is not met.** The target is stated in `apps/api/perf/load.ts`: the
  pilot's busiest hour is estimated at 5.3 actions a second, and the target is three times that,
  15/s for ten minutes. The system holds 5/s with almost no margin (read p95 491 ms against
  500). Reads miss from 10/s, and at 15/s read p95 is 653 ms. Writes and uploads pass at every rate
  up to 20/s. The system **collapses between 20 and 30/s**: latencies reach tens of seconds and 22 %
  of requests fail with 500, because the 10-connection pool's 5 s timeout fires on everything,
  including 10 ms detail reads. The cause is **Postgres CPU spent on full-scope `count(*)` scans**
  (registry totals, the dashboard's three sequential counts, search). The API process used 7 % of
  a core. Sign-in is a second, smaller finding: `bcryptjs` hashes on the event loop, so a sign-in
  rush stalls every other request.

  The fixes are ranked in `docs/d2-performance-fixes.md` and are **not applied here**. Each one
  changes product behaviour or decision 118, and each wants its own rerun. All numbers come from
  one shared 6-core desktop with Postgres in Docker Desktop. A real host moves the numbers but not
  the shape. Generated detail: `d2-load-run.md`.

  **Follow-up, same day: the target is met.** Applied F4 (fail fast: statement timeout, 503 with
  `Retry-After`), F1 (one scan for the dashboard) and F7, found on the way: Postgres JIT off for
  the API's connections, since compiling took most of each scoped count's run time. Measured one
  change per run. With all three, read p95 is 126 ms at 15/s and 166 ms at 30/s, with no failures.
  F2, F3 and F5 are no longer needed for the target. Detail: `d2-load-test.md` § Follow-up.
- [x] **D3** (2h) Backup/restore rehearsal. The scripts and `runbooks/backup-restore.md` are already
      thorough; what is missing is a **performed** restore, timed against P-13's 2–4 hour window, with
      the evidence written down. _Done-when:_ a restore is verified against a checklist.

  Rehearse the real failure — loss of the application host — which means restoring from an archive on
  different storage, not from `./backups` on the same machine.

  **Done 2026-10-06, restored from the NAS.** Pilot-sized data under load, the host killed, its
  volumes and local archive deleted, and a fresh compose project restored from what was on the NAS
  alone. Serving again **7 min 33 s** after the decision to restore. The database came back to
  **47 s** before the failure, the attachments to **3 min 1 s**. The whole checklist passed,
  including a restored file downloading with a matching checksum. Docker Desktop cannot write to a
  mapped drive (it silently mounts an empty local folder), so the archive is written locally and
  pushed to the share every minute (`scripts/push-archive.ps1`). The pilot server is expected to be
  Windows Server; the setup is `runbooks/nas-backup-target.md`. The object mirror runs every
  **3 minutes**, not 5: with the push, 5 comes to about 6 in the worst case. Detail:
  `evidence/d3-restore-rehearsal.md`.

  _Local dry run, 2026-10-04:_ A host loss was rehearsed on one machine
  with pilot-sized data: two compose projects sharing one archive folder, the source killed rather
  than stopped. Serving again **6 min 55 s** after the decision to restore, most of it image builds
  and ClamAV's first start. The database came back to **37 s** before the failure. Two findings:
  WAL archiving did nothing on a fresh deployment until the first `backup.sh` (fixed: the archive
  command creates its directory), and **attachments recover only to the last nightly mirror**, so
  P-13's 5-minute recovery point does not hold for files. That one needs a decision. Still owed:
  the restore from a second machine or NAS. Detail: `evidence/d3-restore-rehearsal.md`.

  **Decided 2026-10-06; this is what closes the box.**

  - **The archive moves to the NAS.** It is an SMB share, storage only, so it cannot run the stack.
    The rehearsal therefore restores onto this machine as a fresh compose project that reads
    **only** from the share. That proves what P-13 asks for: the backups survive the loss of the
    application host's disks. WAL archiving and `backup.sh` write to the share. Docker Desktop
    reaches an SMB path through a bind mount of the mapped drive or UNC path. Check that first,
    because the Postgres archive command runs inside the container. _Checked: it cannot. A mapped
    drive mounts as an empty local folder and a UNC path is refused, so the archive is written
    locally and pushed to the share (see the result above)._
  - **Attachments meet the database's recovery point.** The MinIO mirror runs every 5–15 minutes,
    or continuously, rather than nightly. Rehearse again afterwards and record the file recovery
    point next to the database's. _Done: every 3 minutes, since 5 plus the push can exceed P-13._

- [x] **D4** (2h) Audit retention (P-08). _Done-when:_ the relocation path exists and a test asserts
      no purge path does.

  Scope this honestly. The decision is retain 5 years, then relocate to a separate database, never
  purge. The code already preserves everything, so for five years the correct behaviour is what is
  running. What is genuinely owed is the relocation path and a test that no purge exists — **not** a
  retention window that would delete things. Needs one input from IT: where the separate database
  lives.

  Built as scoped. `AuditRelocator` and `npm run audit:relocate` copy rows older than five years
  into `AUDIT_ARCHIVE_DATABASE_URL`, then read back a fingerprint of each copy. A row is deleted from
  the primary **only after its fingerprint matches**, so an interrupted run loses nothing and a rerun
  is a no-op. Timestamps travel as Postgres JSON, because a JS `Date` would round off the
  microseconds. The cutoff is always computed from the current time; no caller can pass one.

  The test that no purge exists comes in **two layers**. `audit-relocation.test.ts` scans every
  place SQL lives and fails on any `DELETE`, `TRUNCATE` or `UPDATE` of audit rows outside the
  relocator. Migration `0012` makes the table refuse the same statements at runtime: `UPDATE`
  always, and `DELETE`/`TRUNCATE` unless `dts.allow_audit_removal` is set. Exactly two places set
  it: the relocator, and the E2E suite's reset of its disposable database. The archive's table is
  append-only with no override at all. This guards against mistakes, not against a DBA. Withholding
  `UPDATE`/`DELETE` from the runtime role is the real boundary, and it stays an M6 item.

  The IT input is now configuration, not code. Until it arrives, the command refuses to run, which
  is correct for the next five years. Procedure: `docs/runbooks/audit-relocation.md`.

- [x] **D5** (2h ×2) Release methods, two levels (P-15 as decided 2026-10-06). Migration `0013`:
      a method (Mailed, Emailed, Personally delivered, Picked up) and, for Mailed, a carrier
      (Postal, LBC, JRS). _Done-when:_ the release dialog asks for the carrier only when Mailed;
      a tracking number is required for every carrier and refused otherwise; old `MAILED` rows read
      "carrier not recorded" and Records staff can set the carrier through an audited correction.

  Old rows stay exempt from the tracking-number rule. Requiring a number they never recorded would
  make the correction impossible to submit.

  **Done 2026-10-06.** Migration `0013` adds `release_carriers` (Postal, LBC, JRS, each requiring
  a tracking reference), a `MAILED` method flagged `requires_carrier`, and
  `release_events.carrier_id`. The tracking-reference flag moves from the method to the carrier.
  `WorkflowService` requires a carrier for Mailed and refuses one otherwise. It requires the
  carrier's tracking reference and refuses one where no carrier takes it. The dialog asks for the
  carrier with no default, so Postal is never recorded for someone who did not look.
  `GET /release-methods` serves each method with its carriers. The correction is
  `POST /documents/:id/release/carrier` under a new `DOCUMENT_RELEASE_CORRECT` capability, held by
  Records staff and the administrator, and not by a division head. It only ever replaces a null.
  The update is conditional, so two corrections cannot both succeed. It is audited as
  `document.release.carrier-recorded`.

  **How `0013` tells the old rows apart.** `0010` collapsed `MAILED` into `POSTAL` without a
  trace, so a historic mailed row and a genuine Postal release look the same. The Drizzle journal
  could not separate them: its `when` is the file's timestamp, not when it was applied. The
  `POSTAL` method row's own `created_at` could, because `0010` inserted it. A POSTAL release older
  than that row was a `MAILED` one and gets no carrier. `migration.int.test.ts` asserts both
  cases. The `POSTAL`/`LBC`/`JRS` method rows are deleted after the re-point, because nothing
  cites them any more. Decision 27's amendment is recorded in `CONTEXT.md`.

- [x] **D6** (2h ×2) Security pass (Phase 7 task 3). A threat-model pass over the trust
      boundaries, and Dependabot plus a dependency and container scan (Trivy or CodeQL) in CI. Also a
      recorded check of secure headers, the CORS allowlist, the upload and report rate limits, and
      log redaction against P-14. _Done-when:_ no open critical findings, and the checks run in CI.

  **Done 2026-10-06.** Six trust boundaries, eight findings, all fixed. Trivy reports 0 critical
  and 0 high findings in the API, web and MinIO images, and `npm audit` reports none at either
  level. The new `security` CI job fails on a critical; the header, CORS, rate-limit and P-14
  checks are unit suites in `quality`. The findings that mattered most were in the containers. The
  images ran as root with npm and every dev dependency aboard, and MinIO's vendored server, built on
  Go 1.24, carried 4 criticals and 54 highs. Its modules were bumped and the build moved to Go 1.26.
  Trivy is pinned by commit because its action's tags were hijacked in March 2026. CodeQL was not
  used: the repository is private and code scanning is not enabled. Detail, the threat model and the
  two accepted moderates: `evidence/d6-security-pass.md`.

## Wave E — the writing that needs the rest done

~4 sessions.

- [ ] **E1** (2h ×3) Three runbooks: incident response, scanner-down, Redis-loss. Match
      `backup-restore.md`'s shape. _Done-when:_ each describes observed behaviour, not inferred.

  Write scanner-down _after_ B1 and Redis-loss _after_ watching the outbox relay recover. Scanner-down
  must carry the requeue one-liner the README already has — BullMQ parks a job after 5 attempts and
  nothing retries it on its own.

- [x] **E0** (2h) Risk register (Slice 0.1). The project lead owns every risk until it is reassigned
      (decided 2026-10-06). That unblocks it. Seed it from `CONTEXT.md` and this document's open
      items. _Done-when:_ every unresolved question appears as a risk with an owner.

  **Done 2026-10-07.** [`risk-register.md`](risk-register.md) holds 20 risks. Six questions are
  still open: the emergency evidence hold, how users reach a deployment that stays on localhost
  (decided 2026-10-07), UAT scheduling, the contingency items, F2's capped-count UX call, and the
  2031 audit archive host. Each maps to a risk. The largest is R-09: development-mode defaults
  (shared Director password, `dts`/`dts` Postgres) must be replaced before real records go in.

- [ ] **E2** (2h) Traceability matrix (Slice 0.1): 75 stories → D-1–D-151 → MVP or deferred →
      implementation area → test. _Done-when:_ every story has a decision, a scope verdict, and either
      a test or an explicit deferral. Last, because the "test" column should name real files and C3/C4
      change what those are.

## Blocked on people, not code

**Resolved 2026-10-06.** Every item has an answer, so nothing in Phase 7 waits on a person now.

| Item                      | Answer                                                                                                  | Now                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| Risk register (Slice 0.1) | The project lead owns every risk for now                                                                | Box E0                      |
| Phase 0 sign-off          | Not an infrastructure blocker. P-13 is agreed, so the gate is Slice 0.1's documents: the risk register (E0) and the traceability matrix (E2) | E0 + E2                     |
| D3 — off-host storage     | A NAS, as an SMB share, storage only                                                                    | D3                          |
| D3 — attachment recovery  | Mirror often enough to meet the database's recovery point                                               | D3                          |
| D4 — audit archive host   | Deferred to 2031. The command refuses to run until it is configured                                     | Revisit 2031                |
| A4 — release methods      | Not "Postal". A two-level model replaces the flat list                                                  | Box D5; P-15 is `DECIDED`   |

**Deferred to the UAT/pilot contingency**, out of Phase 7: monitoring and alerts, the
release-candidate build on a production-like environment, and guides, UAT scripts, training data
and the viewport/browser matrix (Phase 7 tasks 4–6 in `TO - IMPLEMENT.md`). Of the brief's items
missing from this plan, only the security pass was added (D6).

## Shape

~25 sessions, so 5–6 weeks at 2 h/day; Waves A–C's ~16 are spent and closed. In **Wave D**, D1–D6 are done (D2 now meets its target after F4, F1 and JIT off; see
its box; D3 restored from the NAS on 2026-10-06).
