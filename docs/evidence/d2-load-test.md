# D2: load test against pilot-sized data

_2026-10-04. Phase 7 sequencing, Wave D, box D2._

> **Update, same day: the target is now met, with headroom.** Three changes were applied and each
> was measured in its own run (see [Follow-up](#follow-up-f4-f1-and-jit-off) below): F4 (fail fast
> at saturation), F1 (one scan for the dashboard) and turning off Postgres JIT for the API's
> connections. With all three, read p95 is **126 ms at 15/s** and **166 ms at 30/s**, with no failed
> requests at any rate. The rest of this page records the original run that the fixes started from.

**Verdict: the target is not met.** The system holds the estimated pilot peak, about 5 actions a
second, with almost no margin. It misses the read target from 10 actions a second, and it
**collapses between 20 and 30**: requests queue for tens of seconds and a fifth of them fail with
500. Writes, uploads and the API process are not the problem. **Postgres CPU is**, spent on
full-table `count(*)` scans of `documents` behind the registry, search and dashboard.

| File | What it holds |
| --- | --- |
| [`d2-load-run.md`](d2-load-run.md) | Every phase, every request type: n, rate, p50/p95/p99/max, failures. Generated. The baseline. |
| [`d2-load-run-f4-f1.md`](d2-load-run-f4-f1.md) | The same, after F4 and F1, with JIT left on (`DATABASE_JIT=true`). Generated. |
| [`d2-load-run-jit-off.md`](d2-load-run-jit-off.md) | The same, after F4, F1 and JIT off (the shipped default). Generated. |
| `apps/api/perf/load.ts` | The harness (`npm run perf:load -w @dts/api`). Its header explains the target and the method. |
| `apps/api/perf/load-journeys.ts` | The two acceptance-scenario journeys, cut into interleavable steps. |
| `apps/api/perf/load-client.ts` | One signed-in session, and why each sends its own `X-Forwarded-For`. |

## The target

Nothing in the decision register sets a serving target. P-13's numbers are about recovery. So the
demand is an estimate, written into the harness header where it can be corrected:

- **158 accounts** (D1's organization), and in the busiest hour **every one active**, each
  performing one action every 30 seconds. An action is a search, opening a document, the dashboard,
  an upload or a workflow step. That is **5.3 actions a second**, a whole office working flat out at
  once.
- **Target: three times that, 15 actions a second, held for ten minutes.** Reads p95 ≤ 500 ms,
  workflow writes p95 ≤ 1 s, a 512 KiB upload p95 ≤ 2 s, under 0.5 % of requests failing, and no
  5xx at all.

## Results

The mix is search 30 %, registry 20 %, opening a document 25 % (three requests, as the detail page
makes them), dashboard 10 %, upload 5 % and a workflow step 10 %. The steady phase followed a
60 s warm-up, and the steps ran back to back after it.

| Phase | Actions/s | Requests/s | Read p95 | Write p95 | Upload p95 | Failed | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| step 5 (2 min) | 5 | 8.3 | 491 ms | 94 ms | 1,206 ms | 0 | Holds, barely |
| step 10 (2 min) | 10 | 15.2 | 589 ms | 171 ms | 580 ms | 0 | Reads miss |
| **steady (10 min)** | **15** | **22.3** | **653 ms** | **312 ms** | **782 ms** | **0** | **Reads miss** |
| step 20 (2 min) | 20 | 29.8 | 1,196 ms | 1,010 ms | 1,388 ms | 0 | Reads and writes miss |
| step 30 (2 min) | 30 | 42.2 | 15,249 ms | 32,672 ms | 33,189 ms | 22 % (all 500) | Collapsed |

The generator was not the bottleneck. Dispatch lag p99 stayed at 15 ms and its event-loop delay at
24 ms in every phase, and every phase served the arrival rate it was offered.

The slowest reads at the 15/s target:

| Request | p50 | p95 |
| --- | ---: | ---: |
| `GET /dashboard/summary` | 583 ms | 1,207 ms |
| `GET /documents?divisionId` (custody filter) | 389 ms | 907 ms |
| `GET /documents?search` | 313 ms | 694 ms |
| `GET /documents` (registry, unfiltered) | 216 ms | 515 ms |
| `GET /documents/:id` and its two siblings | 10 ms | ~130 ms |

## Why: Postgres CPU, spent counting

At 15 actions a second **the API used 7 % of one core** and Postgres used 2 to 3.3 cores. The
statements active when sampled were almost all `count(*) from documents where … <scope>`:

- **The registry runs a count beside every page**, and for a scoped user that count evaluates the
  scope predicate over the whole table. D1 found that this is the right plan for one query, because
  a division head can read 42 % of the rows (150 to 250 ms). D1 measured one query at a time, though.
  Ten concurrent ones contend for the same cores.
- **The dashboard summary runs three scoped scans in sequence** (counts by status, overdue,
  pending), plus the pending-by-division and activity queries alongside. That is why it is the
  slowest screen.
- **Search is `ILIKE '%term%'` over five columns** (D1: a sequential scan), and it is counted as
  well.

**The collapse at 30 is the connection pool.** `createDatabase` gives the API ten connections and a
5 s `connectionTimeoutMillis`. Once Postgres is saturated, every request waits for a connection,
including the 10 ms detail reads, whose p50 went to 13.5 s. Any request that waits more than 5 s
fails with a generic 500. The failures are spread evenly over every request type for that reason.
The system does not degrade gracefully past saturation: it fails across the board.

**Caveat on the absolute numbers.** Everything ran on one 6-core desktop: generator, API, worker
and the compose stack, with Postgres inside Docker Desktop's VM on Windows. A dedicated database
host would move every row of the table above. The shape would not change, because the cost is CPU
per scan and it grows with the table.

## Two smaller findings

- **Sign-in is CPU-bound in the API process.** `bcryptjs` is pure JavaScript at cost 12. Eight
  concurrent sign-ins took about 1.8 s each, and the whole office's 157 took 36 s. While that runs,
  the event loop is busy hashing, so every other request in the API waits behind it. A morning
  sign-in rush will be felt by everyone already working. A native or worker-thread hash would fix
  this, but it is not done here.
- **Writes are not the concern.** Registration allocates its tracking number from a single
  counter row, and the obvious worry was contention on it. `POST /documents` stayed at p50 19 ms and
  p95 343 ms at 15/s.

## Follow-up: F4, F1 and JIT off

Applied on branch `wave-d-perf-f4-f1`. Both runs used the same build (`fcee93a`), each after a
fresh reseed. The only difference between them is `DATABASE_JIT`, so the second column is F4 and F1
alone and the third adds JIT off. The two generated reports both name `fcee93a` in their header,
so only this page records that the F4 + F1 run had JIT on.

**Read p95**, with failures where there were any:

| Phase | Baseline | F4 + F1 (JIT on) | + JIT off |
| --- | ---: | ---: | ---: |
| step 5 | 491 ms | 324 ms | 118 ms |
| step 10 | 589 ms | 366 ms | 123 ms |
| **steady 15/s** | **653 ms** ❌ | **441 ms** ✅ | **126 ms** ✅ |
| step 20 | 1,196 ms ❌ | 534 ms ❌ | 135 ms ✅ |
| step 30 | 15,249 ms, 22 % failed (500) ❌ | 13,134 ms, 5.7 % failed (503) ❌ | 166 ms, 0 failed ✅ |

The slowest reads at 15/s, as p50 / p95:

| Request | Baseline | F4 + F1 | + JIT off |
| --- | ---: | ---: | ---: |
| `GET /dashboard/summary` | 583 / 1,207 ms | 351 / 659 ms | 93 / 140 ms |
| `GET /documents?divisionId` | 389 / 907 ms | 374 / 690 ms | 126 / 151 ms |
| `GET /documents?search` | 313 / 694 ms | 302 / 559 ms | 110 / 190 ms |
| `GET /documents` | 216 / 515 ms | 210 / 354 ms | 33 / 45 ms |

What each change did:

- **F1** cut the dashboard's p50 by about 40 % and was the only change to the read path in the
  F4 + F1 run. That run's other read types improved a little too, so freeing the database from the
  dashboard's extra scans helped the requests competing with them.
- **F4** did not raise capacity, as expected. At 30/s the F4 + F1 run still saturated, but every
  failure was a `503 SERVICE_BUSY` with `Retry-After` instead of a 500.
- **JIT off** was the largest single gain, and it was not on the original list. The scope
  predicate's subplans give the scoped counts cost estimates above Postgres's `jit_above_cost`, so
  each one was compiled before running. For a division head's dashboard query on this seed,
  compiling took 235 ms of 268 ms, and the scan itself about 30 ms. With JIT off, the registry
  went from 210 to 33 ms p50.

**One open blip.** In the JIT-off run, step 20 missed on writes (p95 1,035 ms) and uploads
(p95 4,240 ms) while reads in the same step stayed at 135 ms, and step 30 then passed everything.
An earlier run that combined all three changes, set aside because its report named the wrong
commit, hit the same shape at step 30 instead (upload p95 5,263 ms). A stall that hits writes but
spares reads suggests something on the write path, such as a checkpoint or autovacuum flush on
Docker Desktop's disk, or the scan pipeline. That is not verified. It is worth watching on the
pilot's database host before treating it as a finding.

## What would close the gap, in order of cost

_This was the list before the follow-up. Items 1 and 4 are now done (F1, F4), and with JIT off the
target is met without items 2 and 3._

Not done in this box. Each changes product code or a recorded decision, and each wants its own
rerun of this harness. Expanded, with code locations, decisions needed and a suggested order, in
[`../d2-performance-fixes.md`](../d2-performance-fixes.md).

1. **One scan for the dashboard counts**: `count(*) filter (where …)` grouped by status, instead
   of three sequential queries. Small and local, but the dashboard is only 10 % of the mix, so
   expect 10 to 15 % off Postgres CPU.
2. **Stop counting the whole scope on every registry page.** Options include a capped count
   ("1,000+") or counting only on the first page and when filters change. This is the largest lever,
   and it is a UX decision.
3. **Trigram indexes for search** (`pg_trgm` GIN on the five searched columns). Decision 118
   defers them "until measured volume requires it". This is that measurement, but a common term
   like `permit` matches about 17 % of rows, so the index only helps selective terms.
4. **Fail fast at saturation**: a statement timeout, and a pool sized to the database host. A
   slow 503 is better than a 30 s wait followed by a 500. This changes how the system fails, not
   where.
5. **The policy question from Wave C** grows the `document_routes_unaccepted_idx` and the Pending
   count every day. It is not a cause here, but it compounds item 2.

## Rerunning

```bash
ALLOW_DATABASE_RESET=true npm run perf:seed -w @dts/api
npm run build -w @dts/api
npm run perf:load -w @dts/api
```

The harness starts the **built** API and worker itself, on ports 4101/4102, against `dts_perf`. It
uses Redis database 3 and `NODE_ENV=production`, so the compose stack must be up and `dist/` must
be current. The run takes about 25 minutes. It writes documents, so reseed before any run whose
numbers will be compared with another's. To change the rate, the phase lengths or the upload size,
set `LOAD_TARGET_OPS`, `LOAD_STEADY_S`, `LOAD_STEPS` (comma-separated), `LOAD_STEP_S` or
`LOAD_UPLOAD_BYTES`.
