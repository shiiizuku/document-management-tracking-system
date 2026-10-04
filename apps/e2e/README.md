# End-to-end and accessibility suites

Wave C of [`docs/phase-7-sequencing.md`](../../docs/phase-7-sequencing.md). Two journeys from
[`docs/acceptance-scenarios.md`](../../docs/acceptance-scenarios.md), driven through a real browser
against the whole stack, plus an axe sweep of every screen.

## Running it

The suite starts the **application** (API, worker, web) and expects the **infrastructure** to be
there already — the same split the `integration` CI job uses.

```bash
docker compose up -d --wait --wait-timeout 420 postgres redis minio clamav
npm run build
npm run test:e2e -w @dts/e2e
```

The first `docker compose up` is slow: MinIO is compiled from the vendored AGPL source in `./minio`
(there is no pullable image) and ClamAV downloads its definitions during a 90-second health start
period.

`npm run build` is not optional and is not done for you. The global setup refuses to continue
without `apps/api/dist` and `apps/web/.next/standalone`, because otherwise the run fails as three
servers that never became ready — and building silently would hide which commit is under test.

Afterwards: `npm run report -w @dts/e2e` opens the HTML report, including the axe findings attached
to each sweep.

### `npm run dev` must not be running

The servers use the ordinary development ports (web 3001, API 4001, worker health 4002) because the
web client's API base is compiled into its bundle; a private port would need a build made specially
for the suite, and then the artefact under test would not be the artefact that ships.
`reuseExistingServer` is off everywhere, so a dev server is never silently adopted — it would be
pointed at your own database. Stop it first; otherwise the failure is a port-in-use error.

### There is deliberately no `test` script

`npm test` at the repository root runs `--workspaces --if-present`, and a Playwright run needs a
compose stack and a build. The entry point is `test:e2e`, so the unit suites stay runnable with
nothing installed but npm packages.

## What is where

| Path                             | What it is                                                               |
| -------------------------------- | ------------------------------------------------------------------------ |
| `global-setup.ts`                | Creates the database, migrates, seeds the organization and accounts      |
| `tests/auth.setup.ts`            | Signs in once per principal and saves the session                        |
| `tests/smoke.spec.ts`            | The harness itself: stack up, session accepted, reset ran                |
| `tests/incoming-archive.spec.ts` | Acceptance scenario 1, step by step                                      |
| `tests/outgoing-release.spec.ts` | Acceptance scenario 2, and the ORD variant (ADR-0007)                    |
| `tests/accessibility.spec.ts`    | The axe sweep: ten screens and the registration dialog                   |
| `fixtures/accounts.ts`           | The organization and the accounts, at fixed ids                          |
| `fixtures/database.ts`           | Create / reset / seed / truncate, and the guards on the destructive ones |
| `fixtures/screens.ts`            | The screens in the words printed on their controls                       |

## Two constraints worth knowing before changing anything

**Five logins per run, total.** `POST /auth/login` is throttled to five a minute per client
(decision register 68), so `SIGNED_IN_ROLES` is capped at five and the whole run shares those saved
sessions. A sixth principal is seeded (the Lands Division head) and is never signed in as: its side
of the for-information behaviour is asserted from the forwarding officer's own timeline.
`assertLoginBudget` fails readably if the cap is ever raised by accident.

**The accounts survive every reset; documents do not.** A session is a stateless JWT keyed on the
user's id (ADR-0002), so reseeding users would invalidate every saved session and force exactly the
logins there is no budget for. `truncateDocuments` therefore clears the document side and the
counters — which also makes `DTS-<year>-000001` deterministic and assertable — and leaves the tree
alone. The reasoning against a snapshot restore is at the head of `fixtures/database.ts`.

## One known behaviour the specs have to work around

The scan verdict is written by the worker and no realtime message is published for it, so an open
detail page shows `Scan pending` until it is reloaded. `waitForScanClean` reloads in a loop, and
`docs/acceptance-scenarios.md` §1.3 records the same thing for a human executor. If that is ever
fixed, both become a plain assertion.
