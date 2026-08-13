-- Email verification for the local-password flow. Google OAuth users get
-- auto-verified because Google has already confirmed the address; email +
-- password users must click a link before they can submit an application,
-- reset a password, or reach LMS features that assume a real inbox.

ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "users_email_verified_at_idx" ON "users" USING btree ("email_verified_at");--> statement-breakpoint

-- Backfill existing rows as verified. Safe pre-launch because every row
-- was created by a trusted path: the seed-super-admin script, admin-side
-- creation on /admin/settings, dev Google logins, or the self-register
-- flow before this migration existed. Post-launch new rows default to
-- NULL (unverified) and must go through the verification email.
UPDATE "users" SET "email_verified_at" = now() WHERE "email_verified_at" IS NULL;
