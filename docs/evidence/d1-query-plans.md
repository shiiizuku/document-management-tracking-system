# D1: query plans against pilot-sized data

_2026-10-04. Phase 7 sequencing, Wave D, box D1._

**Verdict: one index was missing, and it was the one that mattered.** Before migration `0011`,
four of the critical reads took **more than 30 seconds** on pilot-sized data. They were the
registry's custody division and section filters, and the dashboard's pending-by-division chart for
both the Records Unit and a division head. After `0011`, every critical read runs in **under
300 ms**. No other index is needed at this size.

| File | What it holds |
| --- | --- |
| [`d1-explain-plans.md`](d1-explain-plans.md) | Every plan after `0011`, with its SQL and parameters. Generated. |
| [`d1-explain-plans-before-0011.md`](d1-explain-plans-before-0011.md) | The same pass before `0011`, with a 30 s ceiling. Generated. |
| `apps/api/perf/pilot-seed.ts` | Builds the dataset (`npm run perf:seed -w @dts/api`). |
| `apps/api/perf/explain.ts` | Runs the pass (`npm run perf:explain -w @dts/api`). |

## The dataset

**60,000 documents over five years**, about 48 per working day. No volume is stated anywhere in the
decision register, so this is an assumption, written into the seed's header where it can be
corrected. It was chosen for two reasons:

- **Five years** is the most history the primary database ever holds. P-08 relocates audit events
  once they are five years old, so these are the largest tables the pilot's plans have to survive.
- **48 a day** is deliberately generous for one regional office. If the real figure is lower, every
  number below is pessimistic.

| Table | Rows | Size |
| --- | ---: | ---: |
| `audit_events` | 597,865 | 191 MB |
| `workflow_events` | 285,036 | 60 MB |
| `document_routes` | 127,341 | 36 MB |
| `notifications` | 67,341 | 27 MB |
| `documents` | 60,000 | 44 MB |
| `file_versions` | 51,276 | 22 MB |

The organization is the end-to-end suite's tree, kept verbatim with its ids and passwords, widened
to eight divisions, 13 sections and 158 accounts. The load test (D2) can therefore sign in as the
same principals the acceptance scenarios name.

Every query was produced by calling the **real repository method** and capturing the SQL Drizzle
sent, so the plans describe the queries production actually runs. Each one was explained with
`ANALYZE, BUFFERS` through node-postgres's unnamed-statement path, which gives the same custom plan
production gets. Times are the median of five runs of Postgres's own `Execution Time`, so they
exclude the network and the driver.

## The finding: no index led with `document_routes.document_id`

`custodyDivisionId()` and `custodySectionId()` in `query-scope.ts` find a document's current lead
hop with a correlated subquery:
`… where lead_hop.document_id = documents.id and not for_information order by created_at desc limit 1`.
The table had two indexes, and neither could serve that lookup:

- `document_routes_unaccepted_idx` is partial: it covers only unaccepted rows.
- `document_routes_recipient_idx` leads with the recipient unit, not the document.

So each evaluation of the subquery scanned all 127,000 routes, once per document. The custody
filter evaluates it for every row it considers, which is 60,000 scans of 127,000 rows.

| Scenario | Before `0011` | After |
| --- | ---: | ---: |
| Registry, custody division filter (dashboard chart click-through) | > 30 s ¹ | 115 ms |
| Registry, custody section filter | > 30 s | 272 ms |
| Dashboard pending by division, Records Unit | > 30 s | 80 ms |
| Dashboard pending by division, division head | > 30 s | 117 ms |
| Routing slip (`listRoutes`) | 5.0 ms | 0.04 ms |
| Registry Pending filter, division head | 156 ms | 69 ms |

¹ Observed at about 90 seconds before the pass had a timeout.

**Every user who opened the dashboard would have waited out the division chart.** The fix is
`document_routes_document_idx (document_id, created_at, id)`. The lead-hop subquery becomes a
backward index scan that stops at the first lead hop, and the routing slip's ascending read uses
the same index.

It is deliberately not partial on `for_information = false`. The routing slip reads copies too, and
a document has few enough hops that skipping its copies inside an index scan costs nothing.

The existing tests could not have found this. Their fixtures hold a dozen rows, where a sequential
scan is the right plan.

## What is fine, and why

- **The scoped reads (division head, section staff) still sequential-scan `documents`: 150–250 ms.**
  That is the right plan at this selectivity. The pilot division is set up to receive 30% of the
  work, so its head can read about 25,000 of the 60,000 rows. An index can't help a predicate that
  matches 42% of the table. Each scope `EXISTS` (assignment, share, routed-to-unit) runs once as a
  hashed subplan, not once per row, and `document_routes_recipient_idx` serves the routed-to-unit
  half as an index-only scan.
- **Text search sequential-scans `documents`: 80 ms office-wide, 250 ms for section staff.**
  `ILIKE '%term%'` cannot use a b-tree. Decision 118 says trigram or full-text indexing comes "only
  when measured volume requires it", and at 250 ms on five years of data it does not. Pasting a
  tracking number takes the same path (~100 ms). An exact-match shortcut for strings shaped like
  `DTS-YYYY-NNNNNN` would make that instant, but nobody needs it yet.
- **The audit log: 30–45 ms per statement**, scanning the 600,000-row table to sort by
  `occurred_at`. That is fine for a screen only administrators open. P-08 relocation also caps the
  table at five years.
- **The dashboard activity feed: 65–82 ms**, sorting all of `workflow_events` for the top ten.
  An index on `workflow_events (occurred_at)` would make it sub-millisecond. It is not added
  because it isn't a bottleneck, and the plan only gets worse linearly. This is the first thing to
  revisit if D2 shows the dashboard is the slowest screen.
- **Detail, timeline, my work, monthly report, notifications, outbox lease: all under 3 ms.**

## Two things the dataset surfaced that are not about indexes

**The Pending tile will be wrong by two orders of magnitude.** This is the Wave C open question,
now with a number. The seed reproduces current behaviour: nothing can accept a for-information copy,
so a copy never stops being outstanding. On this data `documentIsPending` holds for **10,609**
documents, while only **113** are actually waiting for someone to take custody. The other 10,496
are archived or complied-with documents that were once copied to a second division. They stay in
the dashboard tile and the registry's _Pending_ filter for good.

This is a policy question, not a performance one. Either copies get an acknowledge action, or the
predicate excludes them. _(Decided 2026-10-04: an acknowledge action. The numbers above are the
seed's, which acknowledges nothing.)_ It also means `document_routes_unaccepted_idx` will not stay small, which
its comment assumes. For now that costs nothing measurable.

**The custody section filter is the slowest read left, at 272 ms.** The `CASE` in
`custodySectionId()` evaluates the lead-hop subquery twice per row, once in `anyLeadHop` and once
in `leadHopOf`. It could be rewritten as a single lateral join if it ever needs to be faster.
Recorded here, not changed: 272 ms is inside any target D2 is likely to set.

## Rerunning

```bash
ALLOW_DATABASE_RESET=true npm run perf:seed -w @dts/api
npm run perf:explain -w @dts/api
```

The seed writes to `dts_perf` (override with `PERF_DATABASE_URL`, which must contain `perf`). It
takes about 90 seconds and is deterministic: two runs produce the same distribution. To reproduce
the "before" file, seed with `0011` removed from the journal and run with `EXPLAIN_TIMEOUT_MS=30000`
and `EXPLAIN_OUTPUT` pointing at a different file.
