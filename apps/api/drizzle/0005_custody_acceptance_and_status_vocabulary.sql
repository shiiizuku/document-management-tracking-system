-- Custody acceptance on the route row, and one source for the status vocabulary.
-- See docs/adr/0005-custody-acceptance-on-the-route-row.md.

ALTER TABLE "document_routes" ADD COLUMN "for_information" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document_routes" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_routes" ADD COLUMN "accepted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "document_routes" ADD CONSTRAINT "document_routes_accepted_by_id_users_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_routes_unaccepted_idx" ON "document_routes" USING btree ("document_id") WHERE "document_routes"."accepted_at" is null;--> statement-breakpoint

-- Every route recorded before this migration predates the acceptance column. Routing was a
-- hand-over that completed on the spot, so those hops are backfilled as accepted by whoever made
-- them: leaving them null would retroactively mark every historical hop as outstanding and show
-- the whole back catalogue as pending. This runs before the insert below, which must stay null.
UPDATE "document_routes" SET "accepted_at" = "created_at", "accepted_by_id" = "routed_by_id" WHERE "accepted_at" IS NULL;--> statement-breakpoint

-- A PENDING document is one that was registered and never accepted. It keeps exactly that meaning
-- by entering the trunk at IN_PROCESS and gaining the unaccepted route row the derived condition
-- reads, rather than being silently promoted to work in progress.
INSERT INTO "document_routes" ("document_id", "from_division_id", "to_division_id", "to_section_id", "routed_by_id", "remarks")
SELECT "id", NULL, "division_id", "section_id", "created_by_id", 'Registered but not yet accepted at the time of the custody-acceptance migration.'
FROM "documents" WHERE "status" = 'PENDING';--> statement-breakpoint

-- The timeline keeps the vocabulary it was written in. `workflow_events` records what happened, so
-- its status columns become free text rather than a live enum that every vocabulary change would
-- rewrite — a history a migration edits is not evidence. `action` is already varchar for the same
-- reason. Historical rows therefore keep the literal 'PENDING' they were written with.
ALTER TABLE "workflow_events" ALTER COLUMN "from_status" SET DATA TYPE varchar(40);--> statement-breakpoint
ALTER TABLE "workflow_events" ALTER COLUMN "to_status" SET DATA TYPE varchar(40);--> statement-breakpoint

-- Postgres cannot drop a value from an enum type, so the type is replaced. PENDING leaves the
-- vocabulary entirely: it is now derived from the route rows above, never stored.
DROP INDEX "documents_scope_status_idx";--> statement-breakpoint
ALTER TYPE "public"."workflow_status" RENAME TO "workflow_status_superseded";--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('IN_PROCESS', 'FOR_REVISION', 'FOR_INITIAL', 'FOR_SIGNATURE', 'SIGNED', 'FOR_RELEASE', 'RELEASED', 'COMPLIED', 'ARCHIVED');--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DATA TYPE "public"."workflow_status" USING (CASE WHEN "status" = 'PENDING' THEN 'IN_PROCESS' ELSE "status"::text END)::"public"."workflow_status";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'IN_PROCESS';--> statement-breakpoint
DROP TYPE "public"."workflow_status_superseded";--> statement-breakpoint
CREATE INDEX "documents_scope_status_idx" ON "documents" USING btree ("division_id","section_id","status");
