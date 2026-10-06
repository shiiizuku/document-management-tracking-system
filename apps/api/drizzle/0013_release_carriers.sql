-- Release methods become two questions (policy register P-15 as decided 2026-10-06; decision 27
-- amended again). Releasing asks how the document left — Mailed, Emailed, Personally delivered,
-- Picked up — and, only when it was mailed, by which carrier: Postal, LBC or JRS. Every carrier
-- requires a tracking reference, Postal included; no other method takes one.
--
-- This reverses one line of `0010`, which said "a flat list, not couriers nested under a Mailed
-- parent". The Records section has since answered the question `0010` left open, and the answer
-- is the nested shape.
--
-- What happens to the releases already recorded, which is the only part of this file that is a
-- judgement rather than a mechanism:
--
--   LBC, JRS                  → Mailed + that carrier      (the carrier was recorded; keep it)
--   POSTAL, released after 0010 → Mailed + Postal          (a genuine Postal release)
--   POSTAL, released before 0010 → Mailed, carrier NULL    (it was `MAILED`, which never said how)
--
-- `0010` mapped `MAILED` onto `POSTAL` and kept no trace of the old value, so the two POSTAL cases
-- cannot be told apart by any column of the release itself. They are told apart by **when**: the
-- `POSTAL` method row was inserted by `0010`, so its `created_at` is the moment the flat list came
-- into being, and every release before it was recorded under the old enum. A release backdated
-- by hand after that moment would be misread as a genuine Postal one; nothing in the application
-- writes `released_at`, so only a bulk import could do that.
--
-- A null carrier on a mailed release is the honest record and is not a defect. Records staff fill
-- it in through `POST /documents/:id/release/carrier`, which is audited and only ever replaces a
-- null. Those historic rows are exempt from the tracking-reference rule: they were made without
-- one, and requiring it would make the correction impossible to submit.
--
-- The `POSTAL`, `LBC` and `JRS` method rows are **deleted**, not deactivated. Methods are normally
-- kept because `release_events` cites them; after the re-point below nothing cites these three,
-- and keeping an inactive "Postal" method beside an active "Postal" carrier would leave two rows
-- that mean the same thing.
--
-- Reversal: re-create the three method rows, point each mailed release at the method named by its
-- carrier (a null carrier back to `POSTAL`, which is where `0010` had put it), restore
-- `requires_tracking_reference` on the methods (true for LBC and JRS), then drop `carrier_id`,
-- `requires_carrier`, the `MAILED` row and `release_carriers`. A Postal release recorded with a
-- tracking reference after this migration has no lossless home in the old model, which refused one.

CREATE TABLE IF NOT EXISTS "release_carriers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(40) NOT NULL UNIQUE,
  "label" varchar(80) NOT NULL UNIQUE,
  "requires_tracking_reference" boolean DEFAULT true NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "release_carriers" ("code", "label", "requires_tracking_reference", "sort_order")
VALUES
  ('POSTAL', 'Postal', true, 1),
  ('LBC', 'LBC', true, 2),
  ('JRS', 'JRS', true, 3)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "release_methods" ADD COLUMN IF NOT EXISTS "requires_carrier" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO "release_methods" ("code", "label", "requires_carrier", "requires_tracking_reference", "sort_order")
VALUES ('MAILED', 'Mailed', true, false, 1)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- The order the Records section gave: Mailed, Emailed, Personally delivered, Picked up.
UPDATE "release_methods" SET "sort_order" = CASE "code"
    WHEN 'MAILED' THEN 1
    WHEN 'EMAILED' THEN 2
    WHEN 'PERSONALLY_DELIVERED' THEN 3
    WHEN 'PICKED_UP' THEN 4
    ELSE "sort_order"
  END;
--> statement-breakpoint
ALTER TABLE "release_events" ADD COLUMN IF NOT EXISTS "carrier_id" uuid;
--> statement-breakpoint
ALTER TABLE "release_events"
  ADD CONSTRAINT "release_events_carrier_id_release_carriers_id_fk"
  FOREIGN KEY ("carrier_id") REFERENCES "release_carriers" ("id");
--> statement-breakpoint
-- Carrier first, while `method_id` still says which carrier it was. A POSTAL release older than
-- the POSTAL row itself was a `MAILED` one and gets no carrier (see the head of this file).
UPDATE "release_events" "e" SET "carrier_id" = "c"."id"
FROM "release_methods" "m", "release_carriers" "c"
WHERE "m"."id" = "e"."method_id"
  AND "c"."code" = "m"."code"
  AND "m"."code" IN ('POSTAL', 'LBC', 'JRS')
  AND NOT ("m"."code" = 'POSTAL' AND "e"."released_at" < "m"."created_at");
--> statement-breakpoint
UPDATE "release_events" "e" SET "method_id" = (SELECT "id" FROM "release_methods" WHERE "code" = 'MAILED')
FROM "release_methods" "m"
WHERE "m"."id" = "e"."method_id"
  AND "m"."code" IN ('POSTAL', 'LBC', 'JRS');
--> statement-breakpoint
DELETE FROM "release_methods" WHERE "code" IN ('POSTAL', 'LBC', 'JRS');
--> statement-breakpoint
-- The tracking-reference flag moves to the carrier. Every remaining method refuses one, so the
-- column has nothing left to say.
ALTER TABLE "release_methods" DROP COLUMN IF EXISTS "requires_tracking_reference";
