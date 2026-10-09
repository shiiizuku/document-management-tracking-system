-- Document types become a list the administrator maintains instead of five values compiled into
-- the web client. `documents.type` stays a plain code (no foreign key): the code is what the
-- registry filters on and what the monthly report counts, and a retired type must keep reading
-- correctly on every document already registered under it — which a deactivated row does, and a
-- deleted one would not, so types are retired rather than removed.
--
-- The five codes the client used to hard-code are seeded with the labels it used to derive, and
-- any other code already on a document is carried over with its code as its label, so no existing
-- document is left holding a type the list does not know.
--
-- Reversal: drop the table. Nothing references it.

CREATE TABLE IF NOT EXISTS "document_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(80) NOT NULL UNIQUE,
  "label" varchar(120) NOT NULL UNIQUE,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "document_types" ("code", "label", "sort_order")
VALUES
  ('MEMORANDUM', 'Memorandum', 1),
  ('FOI_REQUEST', 'FOI request', 2),
  ('SPECIAL_ORDER', 'Special order', 3),
  ('LETTER', 'Letter', 4),
  ('DENR_8888_ACTION_CENTER', 'DENR 8888 Action Center', 5)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "document_types" ("code", "label", "sort_order")
SELECT DISTINCT "type", "type", 100 FROM "documents"
ON CONFLICT DO NOTHING;
