ALTER TABLE "student_applications" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "student_applications" ALTER COLUMN "graduation_year" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "student_applications" ALTER COLUMN "motivation" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "student_applications" ADD COLUMN "form_data" jsonb;