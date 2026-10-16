-- The email of a signed outgoing document (release mail). Many rows per document: a resend copies
-- a failed or sent row into a new one, so history is never overwritten. The partial unique index
-- allows at most one DRAFT per document, which is what makes drafting idempotent.
--
-- Hand-written, like 0005 onward: the drizzle snapshots stop at 0004, so `db:generate` would diff
-- against a stale picture and re-emit everything since.
--
-- Reversal: drop the table, then the type. Nothing references either.

CREATE TYPE "mail_status" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'FAILED');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "file_version_id" uuid NOT NULL,
  "to_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
  "cc_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
  "bcc_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "status" "mail_status" DEFAULT 'DRAFT' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "smtp_message_id" text,
  "sent_at" timestamp with time zone,
  "skipped_at" timestamp with time zone,
  "skip_remarks" text,
  "created_by_id" uuid NOT NULL,
  "sent_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_document_id_documents_id_fk"
  FOREIGN KEY ("document_id") REFERENCES "documents" ("id");
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_file_version_id_file_versions_id_fk"
  FOREIGN KEY ("file_version_id") REFERENCES "file_versions" ("id");
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_created_by_id_users_id_fk"
  FOREIGN KEY ("created_by_id") REFERENCES "users" ("id");
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_sent_by_id_users_id_fk"
  FOREIGN KEY ("sent_by_id") REFERENCES "users" ("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_messages_document_idx" ON "mail_messages" ("document_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mail_messages_one_draft_uq" ON "mail_messages" ("document_id") WHERE "status" = 'DRAFT';
