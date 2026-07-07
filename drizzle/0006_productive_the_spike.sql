CREATE TABLE "site_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"external_url" text,
	"file_path" text,
	"file_size" integer,
	"notes" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_resources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "site_resources" ADD CONSTRAINT "site_resources_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_resources_key_idx" ON "site_resources" USING btree ("key");