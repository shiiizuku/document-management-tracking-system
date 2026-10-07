# Risk register

_Raised 2026-10-07 (box E0, Slice 0.1). Last reviewed: 2026-10-07, after the E2 traceability
matrix ([`traceability-matrix.md`](traceability-matrix.md))._

The delivery, policy, infrastructure, security and performance risks that remain once the build is
done. It is seeded from the unresolved items in [`CONTEXT.md`](CONTEXT.md), the open items in
[`phase-7-sequencing.md`](phase-7-sequencing.md), and the caveats in the Wave D evidence under
[`evidence/`](evidence/). Policy _questions_ live in [`policy-register.md`](policy-register.md),
where every row is `AGREED`. A risk here may still sit on an agreed answer, because the answer can
leave a gap behind it.

**Owner.** The project lead owns every risk until it is reassigned (decided 2026-10-06). To hand
one on, change its owner here and record the date in its entry.

**Scales**

| Rating | Likelihood                               | Impact                                                                        |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| High   | Expected during the pilot year           | Records or files lost, access wrongly granted, or the pilot stops             |
| Medium | Plausible; has happened in a rehearsal   | Service degraded for hours, or days of rework                                 |
| Low    | Needs an unusual event                   | An inconvenience with a known workaround                                      |

**Status values**

- `OPEN`: needs a decision or work before the pilot.
- `MONITORING`: a control is in place. Watch the trigger.
- `ACCEPTED`: the owner accepts what is left, for the reason given.
- `CLOSED`: no longer a risk. Kept for the record.

## Unresolved questions

Box E0 is done when every unresolved question appears as a risk with an owner. These are the
questions still open on 2026-10-07:

| Question                                                                                      | Source                                     | Risk |
| --------------------------------------------------------------------------------------------- | ------------------------------------------ | ---- |
| Who may place or release an emergency evidence hold, what it covers, how it is audited        | Decision 150; `CONTEXT.md` policy gates    | R-05 |
| How pilot users on other computers reach a deployment that stays on localhost                 | Decision of 2026-10-07                     | R-09 |
| When the records office and a pilot division run UAT and sign off                             | Final MVP exit criteria; delivery assumptions | R-02 |
| Who delivers the items deferred to the UAT contingency (monitoring, RC build, guides, UAT scripts, training data, browser matrix) | `phase-7-sequencing.md`, deferred list | R-03 |
| Whether the registry shows a capped count ("1,000+"): the UX call behind F2                   | `d2-performance-fixes.md`                  | R-19 |
| Which host receives audit events once they turn five                                          | P-08; deferred to 2031                     | R-08 |
| Whether to close the second auth gap E1 found: password reset and session revival             | E1 drills                                  | R-22 |
| Whether to build the six stories E2 found short of their decision, or amend the decisions      | E2 traceability matrix                     | R-23 |

## Summary

| ID   | Risk                                                    | Area           | L      | I      | Owner        | Status       |
| ---- | ------------------------------------------------------- | -------------- | ------ | ------ | ------------ | ------------ |
| R-01 | One developer carries the whole system                  | Delivery       | Medium | High   | Project lead | `MONITORING` |
| R-02 | UAT and sign-off have not been scheduled                | Delivery       | Medium | High   | Project lead | `OPEN`       |
| R-03 | Pilot-readiness work deferred to the contingency        | Delivery       | High   | Medium | Project lead | `OPEN`       |
| R-04 | The traceability matrix may surface gaps late           | Delivery       | Medium | Medium | Project lead | `CLOSED`     |
| R-05 | No emergency evidence hold                              | Policy         | Low    | High   | Project lead | `OPEN`       |
| R-06 | Overdue counts cannot back a working-day compliance claim | Policy       | Medium | Low    | Project lead | `ACCEPTED`   |
| R-07 | The signature record is mistaken for a legal signature  | Policy         | Medium | Medium | Project lead | `MONITORING` |
| R-08 | The audit archive host is not chosen until 2031         | Policy         | Low    | Medium | Project lead | `ACCEPTED`   |
| R-09 | The deployment stays on localhost                       | Infrastructure | High   | High   | Project lead | `OPEN`       |
| R-10 | Single host, no failover                                | Infrastructure | Medium | High   | Project lead | `MONITORING` |
| R-11 | The attachment mirror stops or falls behind unnoticed   | Infrastructure | Medium | High   | Project lead | `MONITORING` |
| R-12 | MinIO is built from source with no upstream image       | Infrastructure | Medium | Medium | Project lead | `MONITORING` |
| R-13 | ClamAV down parks scans that never retry on their own   | Infrastructure | Medium | Medium | Project lead | `MONITORING` |
| R-14 | Redis data loss strands queued scans                    | Infrastructure | Low    | Medium | Project lead | `MONITORING` |
| R-15 | Weak repository controls on the free plan               | Security       | Medium | Medium | Project lead | `ACCEPTED`   |
| R-16 | Five moderate advisories are accepted                   | Security       | Low    | Low    | Project lead | `ACCEPTED`   |
| R-17 | No MFA or SSO; tokens are revoked only by expiry        | Security       | Low    | Medium | Project lead | `ACCEPTED`   |
| R-18 | Secrets sit in the host `.env`                          | Security       | Low    | High   | Project lead | `MONITORING` |
| R-19 | Registry counts grow until reads miss their target      | Performance    | Medium | Medium | Project lead | `MONITORING` |
| R-20 | A sign-in rush stalls every other request               | Performance    | High   | Low    | Project lead | `OPEN`       |
| R-21 | The default `SESSION_SECRET` lets anyone forge a session | Security      | High   | High   | Project lead | `CLOSED`     |
| R-22 | No password reset; reactivation revives old sessions    | Security       | Medium | Medium | Project lead | `OPEN`       |
| R-23 | Six stories are built short of their decision           | Delivery       | Medium | Medium | Project lead | `OPEN`       |
| R-24 | Five stories have no test                               | Delivery       | Medium | Low    | Project lead | `OPEN`       |

## Delivery

### R-01 One developer carries the whole system

Decision 149 sizes the plan for one full-stack developer at 20–25 hours a week. Illness, a move or
a long gap stops all work, and knowledge held only by that person is lost.

- **Mitigation:** the system's knowledge is written down in the repo. That means ADRs for each
  architectural choice, a policy register tied to the code, runbooks, evidence for each Wave D box,
  and CI that runs the full quality and integration suites. Nothing needs to be rebuilt from memory.
- **Revisit when:** any box sits untouched for two weeks, or the pilot date is set.

### R-02 UAT and sign-off have not been scheduled

The final MVP exit criteria need the Records Unit and one division to sign off the end-to-end
scenarios. The delivery assumptions say the organization provides a product owner, a pilot-division
representative and an infrastructure contact. None of these is booked.

- **Mitigation:** `acceptance-scenarios.md` is written to be run by someone who has not read the
  code, and the E2E specs in `apps/e2e/tests/` transcribe it, so a UAT session can start
  without preparation.
- **Open question:** when UAT happens, and who attends from the records office and the division.

### R-03 Pilot-readiness work deferred to the contingency

`phase-7-sequencing.md` moves monitoring and alerts, the release-candidate build on a
production-like environment, user guides, UAT scripts, training data and the viewport/browser
matrix out of Phase 7 into the 25–30 week contingency. The same reserve also absorbs overruns.

- **Mitigation:** none yet. The work is listed, but nobody is assigned to it and it has no
  schedule.
- **Open question:** who writes the guides and training material, and whether monitoring waits
  on R-09.

### R-04 The traceability matrix may surface gaps late

E2 maps 75 stories to decisions, scope, code and tests. It runs last on purpose, so its test
column names real files. A story with no decision or no test would then be found after the
hardening work.

- **Mitigation:** the policy register and the Wave A–D reconciliations already checked the
  decisions against the code. Gaps E2 finds go into the backlog and into this register.
- **Closed 2026-10-07.** E2 is done ([`traceability-matrix.md`](traceability-matrix.md)). It
  found gaps, and they are now R-23 and R-24. R-22, R-19 and R-03 already tracked the rest.

### R-23 Six stories are built short of their decision

The E2 matrix found six stories that work but don't do everything their decision says. UAT may
reject them, or users may work around them without saying so.

- **D-22 (amended 2026-10-02):** lists still page by `offset` with numbered pages. Keyset pages
  and continuous scroll for the registry and my-work were never built. The amendment's reason
  still holds: offset pages repeat or skip rows when documents change state between pages.
- **D-11:** overdue is visible but not actionable. The dashboard tile has no link, and the
  registry can't filter or mark overdue rows.
- **D-14:** accept and assign happen on the record, not from the dashboard.
- **D-20:** the web filter bar has no section filter, although the API takes one.
- **D-35, D-36:** there is no dedicated incoming view and no division-grouped outgoing view.
  Each is the registry with a filter.

- **Mitigation:** none yet. Each needs either the code or an amendment to the decision in
  `CONTEXT.md`, recorded the way the 2026-10-02 revision was.
- **Open question:** which to build before UAT, and which to amend. D-22 matters most, because
  the registry is the busiest screen.

### R-24 Five stories have no test

The E2 matrix found five MVP stories with no test that exercises them, so a regression would go
unnoticed.

- **D-6:** the profile photo API (`POST/GET /me/photo`, `GET /users/:id/photo`) exists, but no
  screen uses it and no test calls it.
- **D-8:** no API test creates a user through `POST /users`. Only the screen is tested, against a
  mock.
- **D-64:** no test checks that the approved seal is on the routing slip PDF.
- **D-72, D-73:** no test covers the motion rules in `apps/web/app/theme.css`, including the
  reduced-motion override.

- **Mitigation:** none yet. Each is a small test, except D-6, which also needs a screen or a
  decision to drop the story.
- **Closes when:** each story names a test in `traceability-matrix.md`, or D-6 is amended out.

## Policy

### R-05 No emergency evidence hold

Decision 150 leaves emergency retention and hold unresolved, and says it must not be implemented
silently through archive or delete. The system has no hold. A document needed for an
investigation can be archived or soft-deleted by anyone allowed to do that.

- **Mitigation:** nothing is ever hard-deleted (P-09). Soft-deleted documents can be restored,
  and audit events are never purged (P-08). Evidence is therefore not destroyed, only harder to
  find.
- **Open question:** who may place and release a hold, what it covers, how it overrides archive,
  and how it is audited. Records section and general counsel.

### R-06 Overdue counts cannot back a working-day compliance claim

P-04 counts overdue in elapsed calendar days with no holiday calendar. `CONTEXT.md` warns that
this is not enough for a formal compliance claim.

- **Accepted because:** the Admin office agreed the rule. Overdue figures are internal tracking,
  not a statutory report.
- **Revisit when:** someone wants to cite DTS figures in a compliance report.

### R-07 The signature record is mistaken for a legal signature

P-05 records the Director's signature as tracking metadata with no legal effect. Users who see a
"Signed" state may believe the system signed the document.

- **Mitigation:** the agreed meaning is in the policy register. The user guides (R-03) must say
  it plainly.
- **Revisit when:** the guides are written, or a qualified e-signature is requested (a later-phase
  item).

### R-08 The audit archive host is not chosen until 2031

P-08 keeps audit events for five years and then moves them to a separate database. That host is
deliberately not chosen until the first event turns five.

- **Accepted because:** nothing needs it before 2031. `npm run audit:relocate` refuses to run
  until `AUDIT_ARCHIVE_DATABASE_URL` is set, and `runbooks/audit-relocation.md` records the
  procedure.
- **Revisit when:** 2031, or earlier if storage on the host runs short.

## Infrastructure

### R-09 The deployment stays on localhost

Decided 2026-10-07: the project stays on localhost, with no production hostname, TLS, or
organization-hosted environment. `CONTEXT.md` plans an organization-hosted pilot with TLS, and its
exit criteria have a records office and a division using the system from their own computers.
The consequences:

- Only a browser on the host reaches `http://localhost:3001`. Staff on other computers cannot,
  unless `WEB_ORIGIN` and `PUBLIC_API_URL` name an address they can reach.
- Over plain HTTP on the office network, `COOKIE_SECURE` must stay `false`, so session cookies
  cross the network in clear text. The API refuses `NODE_ENV=production` without HTTPS, so the
  production guards from D6 (HTTPS-only origins, secure cookies, `/api/docs` off) never run.
- In development mode the seed plants the shared development password for the Director
  (`director@dts.local`), and Postgres defaults to `dts`/`dts`. Anyone who reads the repo knows
  both. Real records must never be stored under those defaults.
- `SESSION_SECRET` used to fall back to a value printed in `docker-compose.yml`, which let
  anyone sign a session as any user (R-21). The API now refuses it, so a stack without its own
  secret doesn't start.

- **Mitigation:** none yet. If it stays localhost, set `SESSION_SECRET`, `SEED_ADMIN_PASSWORD`,
  `DIRECTOR_EMAIL`, `DIRECTOR_PASSWORD` and `POSTGRES_PASSWORD` before the first real record. Set
  `API_DOCS=false`.
- **Open question:** how pilot users on other computers reach the system. If they need to, the
  next step is an HTTPS reverse proxy on an `mgb.gov.ph` subdomain and `NODE_ENV=production`.

### R-10 Single host, no failover

ADR-0004 runs the whole stack on one host. If the host is lost, the only recovery is a restore.

- **Mitigation:** P-13 sets the recovery point at 5 minutes and the restore window at 2–4 hours.
  On 2026-10-06 a host loss was rehearsed from the office NAS (`evidence/d3-restore-rehearsal.md`).
  The procedure is `runbooks/backup-restore.md` and `runbooks/nas-backup-target.md`.
- **Revisit when:** the host changes, or the data grows enough to stretch the restore time. Rerun
  the rehearsal then.

### R-11 The attachment mirror stops or falls behind unnoticed

Files meet P-13's recovery point only if the 3-minute mirror keeps running. D3 found two silent
failures. Docker Desktop shows an empty folder when it is asked to bind-mount a mapped drive.
And a pass over a large store takes longer. If the mirror stops, rows still come back through WAL,
but their files do not (146 such versions in the dry run).

- **Mitigation:** `scripts/push-archive.ps1` and the Linux cron entries check a marker file
  before writing, so a "backup" cannot land on the host. Files that lost their bytes fail closed:
  nobody downloads the wrong file. There is no alert when a pass fails (monitoring is deferred,
  R-03).
- **Revisit when:** in the first week, check the pass times in the task history. Repeat after any
  change to the host or the NAS.

### R-12 MinIO is built from source with no upstream image

The community `minio/minio` image no longer exists. `docker-compose.yml` compiles AGPLv3 MinIO
(`RELEASE.2025-10-15T17-29-55Z`) from `./minio`. Its vendored server carried 4 critical and 54
high findings before D6 bumped its modules. A full 43-module bump (#114) did not compile.

- **Mitigation:** Trivy fails CI on a critical. Dependabot alerts and security updates were
  enabled on 2026-10-07. Version-update PRs stay off because they don't compile. The first scan
  raised 19 alerts on `minio/go.mod` (6 high, all in `nats-server`). None was in the built binary:
  `nats-server` is imported only by tests, and Trivy found 0 highs in `usr/bin/minio`. PR #123
  bumps only the flagged modules, and the result builds.
- **Revisit when:** a Dependabot security PR for `./minio` fails to build, or a critical finding
  has no fixed module.

### R-13 ClamAV down parks scans that never retry on their own

P-07 fails closed: a file that is not `CLEAN` is never downloadable. Observed in E1: BullMQ parks
a scan job after 5 attempts (about 36 s), and the file stays `PENDING`. It never becomes
`SCAN_FAILED`, which P-07's row had claimed. Nothing retries it when ClamAV recovers. Every health
check stays green throughout, so nothing reports the outage. ClamAV also needs about 2 GB of RAM
for its definitions on the shared host.

- **Mitigation:** [`runbooks/scanner-down.md`](runbooks/scanner-down.md), drilled 2026-10-07. The
  requeue takes under a second and is safe to repeat. Detection still depends on someone noticing
  pending files, because monitoring is deferred (R-03).
- **Revisit when:** monitoring lands. An alert on parked jobs or on a growing `PENDING` count
  would close this.

### R-14 Redis data loss strands queued scans

Redis is treated as reconstructible (`Document-management-tracking-system.md` §2.11). E1 showed
two cases. An **outage** loses nothing: the relay published the waiting events 7 s after Redis
came back. A **data loss** drops every job already in Redis. The outbox rows behind those jobs are
already marked published, so the relay never re-sends them. A scan lost this way leaves its file at
`PENDING` permanently, and the README requeue can't reach it. The same thing happens after every
host restore, because Redis is not backed up.

- **Mitigation:** [`runbooks/redis-loss.md`](runbooks/redis-loss.md), drilled 2026-10-07. One SQL
  statement marks the stranded uploads unpublished, and the relay re-sends them within a second.
  It is safe to repeat.
- **Revisit when:** monitoring lands (R-03), or the relay learns to re-send stranded scans itself.

## Security

### R-15 Weak repository controls on the free plan

The repository is private on GitHub's free plan. It has no branch protection, no auto-merge and
no code scanning. A red CI run does not block a merge, and CodeQL does not run.

- **Accepted because:** one maintainer merges through PRs with merge commits. The `quality`,
  `integration` and `security` jobs run on every PR. Trivy is pinned by commit after its action
  tags were hijacked in March 2026.
- **Revisit when:** a second person gets write access, or the plan changes.

### R-16 Five moderate advisories are accepted

D6 accepted the `minio` npm client's moderates. On 2026-10-07 Dependabot counted four:
`decode-uri-component` (#21) and three in `stream-json` (#22–#24, one of them prototype pollution).
8.0.7 is still the newest client, and it pins `stream-json ^1` and `query-string ^7`, so no fixed
version can be installed. The code parses only our own MinIO server's responses. D6 also
accepted the `esbuild` dev-server advisory via `drizzle-kit` (#20). Nothing runs `esbuild serve`,
and the package is pruned from the image. The alerts stay open on purpose, so a fix shows up when
one is released.

- **Accepted because:** see `evidence/d6-security-pass.md`.
- **Revisit when:** a `minio` client release after 8.0.7 appears, or a Dependabot PR for one of
  these alerts.

### R-17 No MFA or SSO; tokens are revoked only by expiry

MFA, organization SSO and instant token revocation are later-phase items in `CONTEXT.md`. A stolen
password works until it is reset (there is no in-app way to do that; R-22). A stolen session works
until it expires, or until `SESSION_SECRET` is rotated.

- **Accepted because:** they are out of MVP scope by decision. The 30-minute inactivity timeout
  (P-10), the 5-per-minute sign-in limit and administrator-only provisioning (P-11) limit the
  exposure.
- **Revisit when:** the pilot widens beyond one division, or after any credential incident.

### R-18 Secrets sit in the host `.env`

ADR-0004 keeps secrets in the host's `.env`. Anyone with shell access to the host can read them.

- **Mitigation:** file permissions and restricted shell access (ADR-0004). A secrets manager is a
  later-phase item.
- **Revisit when:** anyone besides the project lead gets access to the host.

### R-21 The default `SESSION_SECRET` lets anyone forge a session

`docker-compose.yml` falls back to `local-development-session-secret-change-before-pilot` when
`.env` doesn't set `SESSION_SECRET`. `validateEnvironment` checks only that it is 32+ characters,
so the API accepts it in every mode, `NODE_ENV=production` included. In the E1 drill, an HS256
token for `admin@dts.local` signed with that string got `200` from `GET /me`. No password was
needed. D6 did not catch it.

The `.env.example` placeholder (`replace-with-at-least-32-random-characters`) had the same
problem, and a `.env` copied from it kept it.

- **Closed 2026-10-07.** `validateEnvironment` refuses both published values in every mode except
  `test`: development too, because the local stack publishes the API on every interface.
  `PUBLIC_SESSION_SECRETS` in `environment.ts` lists them, and `environment.test.ts` fails if
  `docker-compose.yml` or `.env.example` ever ships a value that isn't on that list. A stack that
  ran on one before this should still rotate (`runbooks/incident-response.md`).

### R-22 No password reset; reactivation revives old sessions

Nobody can change a password in the app, and administrators can't reset one. Sessions are
stateless JWTs (ADR-0002). Deactivation refuses a session at once, but in the E1 drill
reactivating the account made the same session valid again.

- **Mitigation:** `runbooks/incident-response.md` resets a password from the API container
  (drilled), and orders the steps: deactivate, let sessions expire or rotate the secret, reset,
  reactivate.
- **Fix:** a change-password screen, an administrator reset, and a per-user session version (a
  claim checked against the user row) so a reset or reactivation invalidates older sessions.

## Performance

### R-19 Registry counts grow until reads miss their target

D2's target is now met (F4, F1 and JIT off). But the registry still counts the user's whole scope
on every page, and that cost grows with the table. On the test desktop the system collapsed
between 20 and 30 actions a second. All of D2 ran on one 6-core desktop, not the pilot's hardware.

- **Mitigation:** F4 fails fast with a 503 instead of a 30 s wait. F2 (capped count) and F3
  (trigram search) are written up in `d2-performance-fixes.md` for growth.
- **Open question:** the UX call on a capped count ("1,000+"), which F2 needs.
- **Revisit when:** the load harness is rerun on the pilot host, or after the first year's volume.

### R-20 A sign-in rush stalls every other request

`bcryptjs` hashes at cost 12 on the API's only event loop. In D2, 157 concurrent sign-ins took
36 s, and every other request waited behind them. A morning rush will be felt by everyone already
working.

- **Mitigation:** none yet. F5 in `d2-performance-fixes.md` swaps in native `bcrypt`, which reads
  the existing hashes. It is independent of everything else.
- **Closes when:** F5 lands and the D2 sign-in burst is rerun.

## Changing an entry

1. Edit the entry and its summary row together, and update _Last reviewed_.
2. A risk that needs a policy answer also gets a row in `policy-register.md`. A risk that needs
   an architectural decision gets an ADR.
3. Close a risk by setting `CLOSED` and saying what closed it. Don't delete the entry.
