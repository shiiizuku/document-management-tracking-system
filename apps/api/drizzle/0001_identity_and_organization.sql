CREATE TYPE "public"."account_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "profile_photos" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"media_type" varchar(80) NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_requests" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"public"."account_request_status";--> statement-breakpoint
ALTER TABLE "account_requests" ALTER COLUMN "status" SET DATA TYPE "public"."account_request_status" USING "status"::"public"."account_request_status";--> statement-breakpoint
ALTER TABLE "account_requests" ADD COLUMN "requested_division_id" uuid;--> statement-breakpoint
ALTER TABLE "account_requests" ADD COLUMN "requested_section_id" uuid;--> statement-breakpoint
ALTER TABLE "account_requests" ADD COLUMN "justification" text;--> statement-breakpoint
ALTER TABLE "account_requests" ADD COLUMN "created_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_requested_division_id_divisions_id_fk" FOREIGN KEY ("requested_division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_requested_section_id_sections_id_fk" FOREIGN KEY ("requested_section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_created_user_id_users_id_fk" FOREIGN KEY ("created_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_requests_pending_email_uq" ON "account_requests" USING btree (lower("email")) WHERE "account_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "account_requests_status_idx" ON "account_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_division_code_uq" ON "sections" USING btree ("division_id","code");