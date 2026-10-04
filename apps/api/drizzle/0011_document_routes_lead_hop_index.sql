-- D1 of the Phase 7 sequencing plan: the EXPLAIN pass over pilot-sized data
-- (`docs/evidence/d1-query-plans.md`) found that no index on `document_routes` leads with
-- `document_id`.
--
-- Two indexes already exist and neither serves a per-document lookup: the partial
-- `document_routes_unaccepted_idx` covers only unaccepted rows, and `document_routes_recipient_idx`
-- leads with the recipient unit. So every correlated subquery that asks "what is this document's
-- current lead hop" — `custodyDivisionId` and `custodySectionId` in `query-scope.ts`, composed by
-- the registry's division and section filters and by the dashboard's pending-by-division chart —
-- scanned the whole routes table once **per document**. Against 60,000 documents and 127,000
-- routes the registry's division filter took about ninety seconds.
--
-- Ordered (document, created_at, id) so the lead-hop subquery's `ORDER BY created_at DESC, id DESC
-- LIMIT 1` is a backward index scan that stops at the first lead hop, and so the routing slip's
-- ascending read of a document's routes is served by the same index. Deliberately **not** partial
-- on `for_information = false`: the slip reads the copies too, and a document has few enough hops
-- that filtering the copies out of an index scan costs nothing.
--
-- Reversible with `DROP INDEX "document_routes_document_idx";`. No data is touched.

CREATE INDEX IF NOT EXISTS "document_routes_document_idx"
  ON "document_routes" USING btree ("document_id", "created_at", "id");
