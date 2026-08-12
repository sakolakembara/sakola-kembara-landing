-- Cleanup after 0008's admin_users → users rename. Postgres carries FK
-- constraint names verbatim through a table rename, so five FKs still had
-- `admin_users` in their names. This normalizes them to match the new
-- table name, so drizzle-kit's schema serializer and the DB agree on names.

ALTER TABLE "reports" DROP CONSTRAINT "reports_uploaded_by_admin_users_id_fk";--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "announcements" DROP CONSTRAINT "announcements_created_by_admin_users_id_fk";--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_id_admin_users_id_fk";--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "student_applications" DROP CONSTRAINT "student_applications_reviewed_by_admin_users_id_fk";--> statement-breakpoint
ALTER TABLE "student_applications" ADD CONSTRAINT "student_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "site_resources" DROP CONSTRAINT "site_resources_updated_by_admin_users_id_fk";--> statement-breakpoint
ALTER TABLE "site_resources" ADD CONSTRAINT "site_resources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
