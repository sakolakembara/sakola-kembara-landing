-- Unify admin_users → users, add accounts + admission_batches, wire
-- student_applications to user + batch. Written by hand because the rename
-- prompt in drizzle-kit requires a TTY; regenerate a snapshot when convenient.

-- Rename admin_users → users and extend it. Existing FKs (announcements,
-- reports, site_resources, student_applications.reviewed_by, audit_log
-- .actor_id) point at admin_users.id, which stays valid across a rename.
ALTER TABLE "admin_users" RENAME TO "users";--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "admin_users_email_unique" TO "users_email_unique";--> statement-breakpoint
ALTER INDEX "admin_users_email_idx" RENAME TO "users_email_idx";--> statement-breakpoint

-- New columns on the unified users table.
ALTER TABLE "users" RENAME COLUMN "display_name" TO "name";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
-- Existing admin rows keep whatever role they had. New sign-ups default to
-- 'student' so Google auth "just works" without follow-up writes.
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'student';--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint

-- OAuth linkage table. NextAuth Drizzle-adapter-compatible so we can plug
-- the adapter in later if DB-backed sessions become useful.
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"type" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY ("provider", "provider_account_id")
);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint

-- Yearly admission batches. Registration form is gated on there being an
-- open batch (opens_at ≤ now < closes_at); results become visible to
-- students only after results_published_at is set (batch-level publish).
CREATE TABLE "admission_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"results_published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_batches_year_unique" UNIQUE ("year")
);--> statement-breakpoint
ALTER TABLE "admission_batches" ADD CONSTRAINT "admission_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_batches_year_idx" ON "admission_batches" USING btree ("year");--> statement-breakpoint
CREATE INDEX "admission_batches_opens_at_idx" ON "admission_batches" USING btree ("opens_at");--> statement-breakpoint

-- Link student_applications to owning user + batch. Nullable to preserve
-- historic rows; the server action enforces both are set on new submissions.
ALTER TABLE "student_applications" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "student_applications" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "student_applications" ADD CONSTRAINT "student_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_applications" ADD CONSTRAINT "student_applications_batch_id_admission_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."admission_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_applications_user_id_idx" ON "student_applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "student_applications_batch_id_idx" ON "student_applications" USING btree ("batch_id");--> statement-breakpoint
-- One application per user per batch. NULL-safe: existing rows without a
-- user_id or batch_id (there won't be any in prod at first-deploy time) are
-- treated as distinct by Postgres, so the constraint never trips on them.
ALTER TABLE "student_applications" ADD CONSTRAINT "student_applications_user_batch_unique" UNIQUE ("user_id", "batch_id");
