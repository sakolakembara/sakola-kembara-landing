CREATE TABLE `admission_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`opens_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`results_published_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "admission_batches_year_check" CHECK("admission_batches"."year" between 2024 and 2100),
	CONSTRAINT "admission_batches_window_check" CHECK("admission_batches"."closes_at" > "admission_batches"."opens_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admission_batches_year_unique` ON `admission_batches` (`year`);--> statement-breakpoint
CREATE INDEX `admission_batches_opens_at_idx` ON `admission_batches` (`opens_at`);--> statement-breakpoint
CREATE TABLE `student_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`batch_id` text NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`whatsapp` text NOT NULL,
	`school_name` text NOT NULL,
	`graduation_year` text NOT NULL,
	`branch_preference` text,
	`motivation` text,
	`economic_background` text,
	`form_data` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_notes` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`submitted_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`batch_id`) REFERENCES `admission_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "student_applications_status_check" CHECK("student_applications"."status" in ('pending', 'under_review', 'accepted', 'rejected')),
	CONSTRAINT "student_applications_form_data_json_check" CHECK("student_applications"."form_data" is null or json_valid("student_applications"."form_data"))
);
--> statement-breakpoint
CREATE INDEX `student_applications_status_idx` ON `student_applications` (`status`);--> statement-breakpoint
CREATE INDEX `student_applications_submitted_at_idx` ON `student_applications` (`submitted_at`);--> statement-breakpoint
CREATE INDEX `student_applications_email_idx` ON `student_applications` (`email`);--> statement-breakpoint
CREATE INDEX `student_applications_batch_id_idx` ON `student_applications` (`batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `student_applications_user_batch_unique` ON `student_applications` (`user_id`,`batch_id`);