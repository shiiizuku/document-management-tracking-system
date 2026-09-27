CREATE TYPE "public"."audit_outcome" AS ENUM('SUCCESS', 'FAILURE');--> statement-breakpoint
CREATE TYPE "public"."document_direction" AS ENUM('INCOMING', 'OUTGOING');--> statement-breakpoint
CREATE TYPE "public"."document_priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."release_method" AS ENUM('MAILED', 'EMAILED', 'PICKED_UP', 'DELIVERED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMINISTRATOR', 'RECORDS_STAFF', 'DIVISION_HEAD', 'STAFF_MEMBER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('PENDING', 'PENDING_RETRY', 'CLEAN', 'INFECTED', 'SCAN_FAILED');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('PENDING', 'IN_PROCESS', 'FOR_REVISION', 'FOR_SIGNATURE', 'SIGNED', 'FOR_RELEASE', 'RELEASED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "account_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"password_hash" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"target_id" varchar(160) NOT NULL,
	"outcome" "audit_outcome" NOT NULL,
	"correlation_id" uuid NOT NULL,
	"source_ip" varchar(64),
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "divisions_code_unique" UNIQUE("code"),
	CONSTRAINT "divisions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "document_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid,
	"division_id" uuid,
	"section_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_metadata_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"from_division_id" uuid,
	"to_division_id" uuid NOT NULL,
	"to_section_id" uuid,
	"routed_by_id" uuid NOT NULL,
	"remarks" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_shares" (
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shared_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_shares_document_id_user_id_pk" PRIMARY KEY("document_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_number" varchar(40) NOT NULL,
	"reference_number" varchar(120),
	"title" varchar(240) NOT NULL,
	"type" varchar(80) NOT NULL,
	"description" text,
	"priority" "document_priority" NOT NULL,
	"direction" "document_direction" NOT NULL,
	"status" "workflow_status" DEFAULT 'PENDING' NOT NULL,
	"sender" varchar(240),
	"company" varchar(240),
	"division_id" uuid NOT NULL,
	"section_id" uuid,
	"created_by_id" uuid NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"current_file_version_id" uuid,
	"signed_file_version_id" uuid,
	"deleted_at" timestamp with time zone,
	"deletion_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_tracking_number_unique" UNIQUE("tracking_number")
);
--> statement-breakpoint
CREATE TABLE "file_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_record_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"object_key" text NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"media_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"uploader_id" uuid NOT NULL,
	"scan_status" "scan_status" DEFAULT 'PENDING' NOT NULL,
	"administratively_restricted" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_versions_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"title" varchar(240) NOT NULL,
	"body" text NOT NULL,
	"document_id" uuid,
	"idempotency_key" varchar(240) NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" varchar(240) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "reference_counters" (
	"division_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reference_counters_division_id_year_pk" PRIMARY KEY("division_id","year")
);
--> statement-breakpoint
CREATE TABLE "release_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"released_by_id" uuid NOT NULL,
	"method" "release_method" NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_events_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"division_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"file_version_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"password_hash" varchar(100) NOT NULL,
	"role" "role" NOT NULL,
	"division_id" uuid,
	"section_id" uuid,
	"can_access_confidential" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"profile_photo_object_key" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(60) NOT NULL,
	"from_status" "workflow_status",
	"to_status" "workflow_status" NOT NULL,
	"remarks" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_metadata_revisions" ADD CONSTRAINT "document_metadata_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_metadata_revisions" ADD CONSTRAINT "document_metadata_revisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_routes" ADD CONSTRAINT "document_routes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_routes" ADD CONSTRAINT "document_routes_from_division_id_divisions_id_fk" FOREIGN KEY ("from_division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_routes" ADD CONSTRAINT "document_routes_to_division_id_divisions_id_fk" FOREIGN KEY ("to_division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_routes" ADD CONSTRAINT "document_routes_to_section_id_sections_id_fk" FOREIGN KEY ("to_section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_routes" ADD CONSTRAINT "document_routes_routed_by_id_users_id_fk" FOREIGN KEY ("routed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_shared_by_id_users_id_fk" FOREIGN KEY ("shared_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_records" ADD CONSTRAINT "file_records_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_records" ADD CONSTRAINT "file_records_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_record_id_file_records_id_fk" FOREIGN KEY ("file_record_id") REFERENCES "public"."file_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_counters" ADD CONSTRAINT "reference_counters_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_events" ADD CONSTRAINT "release_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_events" ADD CONSTRAINT "release_events_released_by_id_users_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_signer_id_users_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_actor_action_date_idx" ON "audit_events" USING btree ("actor_id","action","occurred_at");--> statement-breakpoint
CREATE INDEX "assignments_user_active_idx" ON "document_assignments" USING btree ("user_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_reference_number_uq" ON "documents" USING btree ("reference_number") WHERE "documents"."reference_number" is not null;--> statement-breakpoint
CREATE INDEX "documents_scope_status_idx" ON "documents" USING btree ("division_id","section_id","status");--> statement-breakpoint
CREATE INDEX "documents_created_at_idx" ON "documents" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_record_number_uq" ON "file_versions" USING btree ("file_record_id","version_number");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("recipient_user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox_events" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_division_name_uq" ON "sections" USING btree ("division_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_events_document_sequence_uq" ON "workflow_events" USING btree ("document_id","sequence");