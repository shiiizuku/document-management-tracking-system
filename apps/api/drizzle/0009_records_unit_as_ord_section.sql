-- Decision 152's other half: the Records Unit becomes a **Section inside the Office of the
-- Regional Director**, rather than the standalone `RECORDS` division the seed used to create.
-- With it, a draft the records officer registers is owned by the ORD, so it takes the
-- `IN_PROCESS → FOR_SIGNATURE` path and ADR-0007's exemption is reachable without hand-editing
-- rows.
--
-- **The `RECORDS` division is deactivated, not dropped.** The sequencing plan said "drop"; decision
-- 152 says "deactivated, never deleted: division codes are embedded in reference numbers already
-- issued", and the decision wins. Deleting it would also mean deciding what happens to its
-- `reference_counters` rows, and there is no answer to that which cannot reissue a number.
--
-- So this migration moves **placement** and touches **no** `reference_number`. Already-issued
-- `RECORDS-<year>-<n>` references stay exactly as they were stamped (decision 153 makes them
-- permanent and they exist on paper), which means a repointed outgoing document carries a
-- reference whose prefix no longer matches its division. That is correct and deliberate: the
-- reference records where the document was registered, the division records where it lives now.
--
-- Reversibility, which is the whole risk here. Nothing is destroyed, so the way back is:
--
--   UPDATE divisions SET active = true WHERE code = 'RECORDS';
--   -- repoint users/documents/routes/assignments whose section_id is the ORD's RECORDS section
--   -- back to the RECORDS division and its INTAKE section, then
--   UPDATE sections SET active = false WHERE code = 'RECORDS'
--     AND division_id = (SELECT id FROM divisions WHERE code = 'ORD');
--
-- The one thing the reverse cannot recover is which former section each row sat in, because the
-- forward direction collapses every section of the old division into one. The pilot has a single
-- `INTAKE` section, so for the pilot that is lossless; a deployment with more than one must
-- capture the old `section_id` before running this.

-- Everything below is conditional on a `RECORDS` division existing, including the creation of the
-- ORD and its Records Unit. On a database that never had one there is nothing to move, and the
-- organization tree is then configuration rather than migration output — ORD_DIVISION_CODE's
-- comment says why, and a migration that seeded an ORD row unconditionally would collide with the
-- id every fixture and every `db:seed` picks for it.
--
-- The ORD has to exist before anything can be moved into it, and a database seeded before the
-- revision has no ORD row at all.
INSERT INTO "divisions" ("code", "name")
SELECT 'ORD', 'Office of the Regional Director'
WHERE EXISTS (SELECT 1 FROM "divisions" WHERE "code" = 'RECORDS')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- "Records Unit", not "Records Office": `docs/CONTEXT.md` retires the latter, because "Office" now
-- means the ORD.
INSERT INTO "sections" ("division_id", "code", "name")
SELECT "id", 'RECORDS', 'Records Unit' FROM "divisions"
WHERE "code" = 'ORD' AND EXISTS (SELECT 1 FROM "divisions" WHERE "code" = 'RECORDS')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Each repointing below preserves whether the row was narrowed to a section at all: a row with no
-- section keeps none, so this never tightens a scope that was division-wide. `section_id` is set
-- from the join rather than copied, because the old sections are being retired with the division.
UPDATE "users" SET
  "division_id" = "ord"."id",
  "section_id" = CASE WHEN "users"."section_id" IS NULL THEN NULL ELSE "unit"."id" END,
  "updated_at" = now()
FROM "divisions" "ord", "sections" "unit", "divisions" "old"
WHERE "old"."code" = 'RECORDS'
  AND "ord"."code" = 'ORD'
  AND "unit"."division_id" = "ord"."id"
  AND "unit"."code" = 'RECORDS'
  AND "users"."division_id" = "old"."id";
--> statement-breakpoint
UPDATE "documents" SET
  "division_id" = "ord"."id",
  "section_id" = CASE WHEN "documents"."section_id" IS NULL THEN NULL ELSE "unit"."id" END,
  "updated_at" = now()
FROM "divisions" "ord", "sections" "unit", "divisions" "old"
WHERE "old"."code" = 'RECORDS'
  AND "ord"."code" = 'ORD'
  AND "unit"."division_id" = "ord"."id"
  AND "unit"."code" = 'RECORDS'
  AND "documents"."division_id" = "old"."id";
--> statement-breakpoint
-- `document_routes` is evidence of where a document went, and repointing it rewrites that record.
-- It is repointed anyway, and for one reason: `query-scope.ts` resolves read scope through the
-- recipient columns, so a hop left pointing at the retired division would hide the document from
-- the very unit that now holds it. The history that matters — who routed it, when, and whether they
-- accepted — is untouched; only the name of the place it was routed to moves.
UPDATE "document_routes" SET
  "to_division_id" = "ord"."id",
  "to_section_id" = CASE WHEN "document_routes"."to_section_id" IS NULL THEN NULL ELSE "unit"."id" END
FROM "divisions" "ord", "sections" "unit", "divisions" "old"
WHERE "old"."code" = 'RECORDS'
  AND "ord"."code" = 'ORD'
  AND "unit"."division_id" = "ord"."id"
  AND "unit"."code" = 'RECORDS'
  AND "document_routes"."to_division_id" = "old"."id";
--> statement-breakpoint
UPDATE "document_routes" SET "from_division_id" = "ord"."id"
FROM "divisions" "ord", "divisions" "old"
WHERE "old"."code" = 'RECORDS'
  AND "ord"."code" = 'ORD'
  AND "document_routes"."from_division_id" = "old"."id";
--> statement-breakpoint
UPDATE "document_assignments" SET
  "division_id" = "ord"."id",
  "section_id" = CASE WHEN "document_assignments"."section_id" IS NULL THEN NULL ELSE "unit"."id" END,
  "updated_at" = now()
FROM "divisions" "ord", "sections" "unit", "divisions" "old"
WHERE "old"."code" = 'RECORDS'
  AND "ord"."code" = 'ORD'
  AND "unit"."division_id" = "ord"."id"
  AND "unit"."code" = 'RECORDS'
  AND "document_assignments"."division_id" = "old"."id";
--> statement-breakpoint
-- Only the open ones. A decided account request is a record of what was asked for and what was
-- granted, so rewriting its requested placement would falsify it — and an inactive division is
-- still a legal foreign key. A `PENDING` request is different: approval runs `resolvePlacement`,
-- which refuses an inactive division, so leaving it alone would make it unapprovable.
UPDATE "account_requests" SET
  "requested_division_id" = "ord"."id",
  "requested_section_id" = CASE
    WHEN "account_requests"."requested_section_id" IS NULL THEN NULL ELSE "unit"."id" END,
  "updated_at" = now()
FROM "divisions" "ord", "sections" "unit", "divisions" "old"
WHERE "old"."code" = 'RECORDS'
  AND "ord"."code" = 'ORD'
  AND "unit"."division_id" = "ord"."id"
  AND "unit"."code" = 'RECORDS'
  AND "account_requests"."requested_division_id" = "old"."id"
  AND "account_requests"."status" = 'PENDING';
--> statement-breakpoint
-- Retire the old placement. `reference_counters` rows keyed on the RECORDS division are left
-- untouched on purpose: they are the record of how far that division's yearly sequence got, the
-- division row they point at still exists, and no account is placed there any more so nothing can
-- allocate from them again.
UPDATE "sections" SET "active" = false, "updated_at" = now()
WHERE "division_id" = (SELECT "id" FROM "divisions" WHERE "code" = 'RECORDS');
--> statement-breakpoint
UPDATE "divisions" SET "active" = false, "updated_at" = now() WHERE "code" = 'RECORDS';
