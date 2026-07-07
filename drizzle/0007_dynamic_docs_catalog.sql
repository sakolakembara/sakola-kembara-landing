-- Reshape site_resources from fixed-slot (keyed) model to a dynamic catalog.
-- Table is empty at this point (fresh feature) so we drop + recreate rather
-- than juggling nullable columns.

DROP INDEX IF EXISTS "site_resources_key_idx";--> statement-breakpoint
ALTER TABLE "site_resources" DROP CONSTRAINT IF EXISTS "site_resources_key_unique";--> statement-breakpoint
ALTER TABLE "site_resources" DROP COLUMN IF EXISTS "key";--> statement-breakpoint
ALTER TABLE "site_resources" ADD COLUMN "title" text NOT NULL DEFAULT 'Untitled';--> statement-breakpoint
ALTER TABLE "site_resources" ALTER COLUMN "title" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "site_resources" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "site_resources" ADD COLUMN "category" text NOT NULL DEFAULT 'lainnya';--> statement-breakpoint
ALTER TABLE "site_resources" ADD COLUMN "display_order" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "site_resources" ADD COLUMN "content_type" text NOT NULL DEFAULT 'file';--> statement-breakpoint
ALTER TABLE "site_resources" ALTER COLUMN "content_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "site_resources" ADD COLUMN "body_text" text;--> statement-breakpoint
ALTER TABLE "site_resources" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "site_resources_category_order_idx" ON "site_resources" USING btree ("category", "display_order");
