-- Outgoing documents are sent in the name of the Head of the Bureau and are addressed to one or more
-- recipients, each with optional email addresses.
--
--   * `documents.recipients` — a jsonb array of { name, emails[] }, empty for an incoming document.
--     Existing rows read as an empty list, which is the truth: none of them recorded a recipient.
--   * `office_settings` — one row holding the Head of the Bureau's name and title. The sender of
--     every outgoing document is derived from it by the server, so it cannot be set per document.
--     The name starts blank and is filled in by an administrator; until then the sender reads as
--     the title alone.
--
-- Reversible with `DROP TABLE "office_settings"; ALTER TABLE "documents" DROP COLUMN "recipients";`.

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "recipients" jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE TABLE IF NOT EXISTS "office_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "head_of_bureau_name" varchar(160) DEFAULT '' NOT NULL,
  "head_of_bureau_title" varchar(160) DEFAULT 'Regional Director' NOT NULL,
  "updated_by_id" uuid REFERENCES "users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "office_settings_single_row" CHECK ("id" = 1)
);

INSERT INTO "office_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
