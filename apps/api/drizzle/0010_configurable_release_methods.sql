-- Release methods become configurable rows (policy register P-15; decision 27 as amended).
--
-- The `release_method` pgEnum carried four values — `MAILED`, `EMAILED`, `PICKED_UP`, `DELIVERED` —
-- against a decision that has always said "or another configured allowed method". The office uses
-- LBC and JRS, and neither could be recorded at all; adding one meant an `ALTER TYPE` and a
-- deployment. Six rows are seeded here, and a seventh is now an INSERT.
--
-- The mapping of the four old values, which is the only part of this file that is a judgement
-- rather than a mechanism:
--
--   EMAILED   → EMAILED                 (unchanged)
--   PICKED_UP → PICKED_UP               (unchanged)
--   MAILED    → POSTAL                  (the decision's name for the same act)
--   DELIVERED → PERSONALLY_DELIVERED    (the decision's name for the same act)
--
-- `MAILED → POSTAL` is **awaiting confirmation from the Records section** (phase-7-sequencing.md,
-- "Blocked on people"). It is applied now because the alternative — reading `MAILED` as a courier
-- and splitting it across LBC and JRS — would invent a carrier that the row never recorded. If the
-- confirmation comes back differently, a correcting migration re-points the affected
-- `release_events.method_id`; nothing is lost here, because the old value survives in the
-- `release_methods` row it maps to rather than being overwritten in place.
--
-- A flat list, not couriers nested under a "Mailed" parent — decision 27 is explicit about that.
CREATE TABLE IF NOT EXISTS "release_methods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(40) NOT NULL UNIQUE,
  "label" varchar(80) NOT NULL UNIQUE,
  "requires_tracking_reference" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- LBC and JRS are the two that require a tracking reference: they are the two that issue one, and
-- a consignment recorded without it cannot be traced, which is the only reason to record the
-- carrier at all.
INSERT INTO "release_methods"
  ("code", "label", "requires_tracking_reference", "sort_order")
VALUES
  ('EMAILED', 'Emailed', false, 1),
  ('POSTAL', 'Postal', false, 2),
  ('LBC', 'LBC', true, 3),
  ('JRS', 'JRS', true, 4),
  ('PICKED_UP', 'Picked up', false, 5),
  ('PERSONALLY_DELIVERED', 'Personally delivered', false, 6)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "release_events" ADD COLUMN IF NOT EXISTS "method_id" uuid;
--> statement-breakpoint
ALTER TABLE "release_events" ADD COLUMN IF NOT EXISTS "tracking_reference" varchar(120);
--> statement-breakpoint
UPDATE "release_events" SET "method_id" = "m"."id"
FROM "release_methods" "m"
WHERE "m"."code" = CASE "release_events"."method"::text
    WHEN 'MAILED' THEN 'POSTAL'
    WHEN 'DELIVERED' THEN 'PERSONALLY_DELIVERED'
    ELSE "release_events"."method"::text
  END;
--> statement-breakpoint
-- `SET NOT NULL` is the assertion that the backfill above was total. If any release event failed
-- to map, this migration fails here rather than leaving a release with no recorded method — which
-- would be a hole in the evidence the whole table exists to hold.
ALTER TABLE "release_events" ALTER COLUMN "method_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "release_events"
  ADD CONSTRAINT "release_events_method_id_release_methods_id_fk"
  FOREIGN KEY ("method_id") REFERENCES "release_methods" ("id");
--> statement-breakpoint
ALTER TABLE "release_events" DROP COLUMN IF EXISTS "method";
--> statement-breakpoint
DROP TYPE IF EXISTS "release_method";
