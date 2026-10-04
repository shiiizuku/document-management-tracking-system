# D2 follow-up: potential performance fixes

_Written 2026-10-04 from the D2 load test ([`evidence/d2-load-test.md`](evidence/d2-load-test.md)).
Each item is a candidate box, with what it costs and what it needs decided._

> **Status, later the same day:** F4 and F1 are applied, and so is a fix that was not on this list,
> F7 (Postgres JIT off). With all three the D2 target is met with headroom: read p95 126 ms at
> 15/s, 166 ms at 30/s, no failures. Measured one change per run; the numbers are in
> [`evidence/d2-load-test.md`](evidence/d2-load-test.md#follow-up-f4-f1-and-jit-off). F2, F3 and F5
> are no longer needed for the target. They stay listed for growth, and F6 still waits on policy.

## The problem these fixes address

At the target of 15 actions a second, read p95 is 653 ms against a 500 ms target. The system
collapses between 20 and 30 actions a second. **The API is not the cost: Postgres CPU is**, and it
is spent on `count(*)` scans of `documents` that evaluate `documentScopeFor` over the whole table.

At 15/s, here is roughly where the time goes, taking each request type's p50 × count from
`evidence/d2-load-run.md`:

| Source | Share of the mix | Scoped scans per action | p50 at 15/s |
| --- | ---: | ---: | ---: |
| Search (`GET /documents?search`) | 30 % | 2 (count + page) | 313 ms |
| Dashboard (`GET /dashboard/summary`) | 10 % | 3 sequential + 2 parallel | 583 ms |
| Registry (`GET /documents`, filters) | 20 % | 1 full count + a cheap page | 103–389 ms |
| Opening a document | 25 % | 0 | 10 ms |

So the levers are, in order, **how often the full scope is counted**, **how much each count
costs**, and **what happens once the database is saturated**.

**How to judge any fix:** reseed, rebuild and rerun `npm run perf:load -w @dts/api`, then compare
against `evidence/d2-load-run.md`. One fix per run, so each result can be attributed. The bar is the
steady phase holding at 15/s, with no 5xx up to the highest step.

---

## F1 — One scan for the dashboard counts

**Applied.** Dashboard p50 583 → 351 ms at 15/s with JIT on. The `EXISTS` warning below was right:
inside a `FILTER` it made the Records Section's summary five times slower (188 ms against 37 ms).
Pending is counted with an `IN` form of the same predicate (`documentIsPendingInRollup`), which
Postgres reads once into a hash. The other dashboard queries already ran in parallel.

**Cost:** ~1 h. **Decision needed:** none. **Expected effect:** small, about 10–15 % off Postgres CPU;
the dashboard's p95 roughly halves.

`DocumentsRepository.summary` (`documents.repository.ts`) runs three scoped queries one after
another: counts grouped by status, the overdue count, and the pending count. They could become one
pass:

```sql
select status,
       count(*)                                                       as total,
       count(*) filter (where due_at < now() and status not in ('RELEASED','ARCHIVED')) as overdue,
       count(*) filter (where <documentIsPending()>)                  as pending
from documents where deleted_at is null and <scope>
group by status
```

- **Check the plan for `pending` before committing.** Today the separate pending query can drive
  from `document_routes_unaccepted_idx`. Inside a `FILTER` the `EXISTS` becomes a subplan evaluated
  per row. If `EXPLAIN` shows that costs more than the scan it saves, fold only `overdue` in, which
  takes it from 3 scans to 2.
- `dashboard.int.test.ts` already asserts the tiles against the registry, so the safety net exists.
- Also worth doing here: run the remaining queries with `Promise.all` instead of in sequence. This
  shortens latency but saves no CPU.

## F2 — Stop counting the whole scope on every registry and search page

**Cost:** 0.5–1 day. **Decision needed: yes, UX.** **Expected effect:** the largest lever. It removes
about half the scoped scans from search and most of the registry's cost.

`DocumentsRepository.search` runs `select count(*) … where <scope + filters>` beside every page.
The page query itself is cheap: `order by created_at desc limit 20` stops early. The count is what
scans. The web client uses `total` for "x–y of N" and the page count (`list-shell.tsx`).

Options, cheapest to most involved:

1. **Capped count.** Use `select count(*) from (select 1 … limit 1001) s`, and the client shows
   "1,000+" and "Page 1 of 50+". The cost becomes bounded by the cap instead of by the table.
   Decision: whether a registry may say "1,000+".
2. **Count once per query, not per page.** The client asks for `total` only on page 1 or when a
   filter changes, and reuses it while paging. This halves paging cost, but leaves every first page
   paying.
3. **Keyset pagination with "Next" only.** No total at all. This is the biggest UX change.

Option 1 is the recommendation. Its only visible effect is on queries matching more than 1,000
documents, which is exactly where nobody is reading the exact number.

## F3 — Trigram indexes for search

**Cost:** ~0.5 day plus a migration. **Decision needed: yes**, it is decision 118's trigger.
**Expected effect:** large for selective terms, small for common ones.

Search is `ILIKE '%term%'` across five columns (`title`, `tracking_number`, `reference_number`,
`sender`, `company`), which is a sequential scan. A `pg_trgm` GIN index per column lets Postgres
`BitmapOr` the five and evaluate scope only on the rows that matched.

- Decision 118 defers trigram or full-text indexing "until measured volume requires it". D2 is
  that measurement, so the decision owner should be told it has been met.
- **It does not help common terms.** `permit` matches about 17 % of the seeded rows, and at that
  selectivity Postgres will still scan. It pays off for names, reference numbers and tracking
  numbers, which is most of what people actually type.
- It is cheaper alongside F2: with a capped count, a common term stops costing a full scan anyway.
- A smaller version: short-circuit strings shaped like `DTS-YYYY-NNNNNN` to an equality lookup on
  the unique tracking-number index. D1 already suggested this.
- Watch the write cost. Five GIN indexes on `documents` slow registration and metadata edits, so
  rerun D2's write numbers.

## F4 — Fail fast at saturation

**Applied.** `DATABASE_POOL_MAX` (default 10, API and worker) and `DATABASE_STATEMENT_TIMEOUT_MS`
(default 10 s, API only), both in compose. A pool-acquire timeout or a cancelled statement is
answered `503 SERVICE_BUSY` with `Retry-After: 2`. The web client already retries 5xx. Separate
pools for the outbox relay were not done.

**Cost:** ~2 h. **Decision needed:** small, an ops one (timeouts). **Expected effect:** does not
raise capacity. It changes *how* the system fails past it.

At 30/s every request, including 10 ms detail reads, queued behind scans for one of the pool's ten
connections, waited past `connectionTimeoutMillis: 5000`, and returned a generic 500.

- **Set a `statement_timeout`** on the pool (e.g. 10 s), so one runaway scan cannot hold a
  connection indefinitely.
- **Map a pool-acquire timeout to 503 with `Retry-After`** instead of 500, so the client can say
  "busy, retrying" rather than "unexpected error".
- **Size the pool to the database host**, not a constant: `max: 10` is in `database/client.ts`,
  and an env var such as `DATABASE_POOL_MAX` would need a compose entry too (see the `TRUST_PROXY`
  lesson). A bigger pool does not help a CPU-bound database. It only lengthens the queue inside
  Postgres instead of inside the API. So this is about matching cores, not about raising the number.
- Optional: separate pools for interactive reads and for the outbox relay, so background work
  cannot starve a user's page.

## F5 — Sign-in off the event loop

**Cost:** ~2–3 h. **Decision needed:** none, if the hash format is kept. **Expected effect:** a
morning sign-in rush stops stalling everyone else.

`bcryptjs` is pure JavaScript and runs on the API's only event loop at cost 12. Eight concurrent
sign-ins took about 1.8 s each, and every other request waited behind them.

- Swap to the native `bcrypt` package. It hashes on libuv's thread pool and reads existing `$2a$` /
  `$2b$` hashes unchanged, so no rehash or migration is needed. Check that the Docker image builds
  it, since it needs a prebuilt binary or a toolchain.
- Or keep `bcryptjs` and move `compare` into a `worker_threads` pool.
- Do **not** lower the cost factor. That trades security for speed, and the lockout and throttle
  assume it.
- Verify with the harness's sign-in table: p50 should fall well under 400 ms at eight concurrent.

## F6 — The for-information copies (Wave C's open question)

**Cost:** depends on the answer. **Decision needed: yes, policy.** **Expected effect:** not a
cause of the D2 miss. It compounds F1 and F2 over time.

Never-acknowledged copies keep `documentIsPending` true forever: 10,609 against 113 real on the
seed. Every pending count and filter therefore does more work every day, and
`document_routes_unaccepted_idx` grows without bound. Either answer, an acknowledge action or
excluding copies from the predicate, also shrinks that index. This is listed here only so whoever
picks up F1/F2 knows the Pending numbers they are optimising are currently wrong.

## F7 — Postgres JIT off for the API's connections

**Applied. Found while checking F1's plans, and the largest single gain.** The scope predicate's
subplans give every scoped count a cost estimate above Postgres's `jit_above_cost`, so each was
JIT-compiled before running. On the perf seed, compiling took 235 ms of a 268 ms dashboard query
whose scan took about 30 ms. JIT pays off for long analytic queries. For this API's short ones it
was pure overhead, paid on every request.

`DATABASE_JIT` (default `false`) sets `jit` on the API's pool. It is in compose and
`.env.example`, and `true` restores the server default. With F4 and F1 already in, it took steady
read p95 from 441 to 126 ms and turned the 30/s step from a collapse into a pass.

---

## Suggested order

_Superseded: F4, F1 and F7 are done and the target is met. What remains is for growth or policy._

| Order | Fix | Why then |
| ---: | --- | --- |
| 1 | **F4** fail fast | Cheap. Makes every later rerun's overload behaviour readable. |
| 2 | **F1** dashboard single scan | No decision needed, local, measurable. |
| 3 | **F2** capped count | The real lever. Needs the UX call first, so ask now. |
| 4 | **F5** native bcrypt | Independent. Do it whenever a session is free. |
| 5 | **F3** trigram | After F2, so its measured gain is its own. |
| — | **F6** | Waits on the policy owner. |

If F1 and F2 together do not bring the steady phase under target on this machine, the next
question is hardware: rerun on a host shaped like the pilot's database server before optimising
further.
