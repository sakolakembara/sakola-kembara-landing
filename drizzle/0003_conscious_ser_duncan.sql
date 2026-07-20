ALTER TABLE "reports" ALTER COLUMN "year" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "category" text DEFAULT 'pengurus' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "education_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "work_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "team_members_category_idx" ON "team_members" USING btree ("category");