-- Reference Documents: an outgoing document names the incoming documents it answers, and each of
-- those reads the inverse as its replies (decisions 165–167, 178–179).
--
-- A *relationship*, not a string. `documents.reference_number` already carries two different
-- things — the office's identifier for an outgoing document, the sender's free text on an incoming
-- one — so nothing here is named `reference` unqualified. `REFERENCES` is a SQL reserved word
-- besides, which would force quoting at every mention.
--
-- Direction is **not** a constraint in this file: `outgoing_document_id` must name an OUTGOING
-- document and `incoming_document_id` an INCOMING one, which SQL cannot express across tables
-- without a trigger. The rule lives in `DocumentsService.linkReferenceDocument`, and enforcing it
-- there makes cycles unrepresentable — an incoming document can never be the naming side — so no
-- cycle check, depth limit or recursive guard belongs anywhere in this feature.
--
-- The unique pair is what makes a link idempotent without a read-before-write (`ON CONFLICT DO
-- NOTHING`), and the separate index on the incoming id serves the reverse read, which is the half
-- a composite index leading with the outgoing id does not. The `CHECK` catches the one malformed
-- row the direction rule would miss if the service check were ever bypassed.
CREATE TABLE IF NOT EXISTS "document_references" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outgoing_document_id" uuid NOT NULL REFERENCES "documents" ("id"),
  "incoming_document_id" uuid NOT NULL REFERENCES "documents" ("id"),
  "created_by_id" uuid NOT NULL REFERENCES "users" ("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_references_not_self"
    CHECK ("outgoing_document_id" <> "incoming_document_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_references_pair_uq"
  ON "document_references" ("outgoing_document_id", "incoming_document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_references_incoming_idx"
  ON "document_references" ("incoming_document_id");
