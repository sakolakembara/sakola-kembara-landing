CREATE TABLE `application_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`form_data` text DEFAULT '{}' NOT NULL,
	`last_step` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `admission_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "application_drafts_form_data_check" CHECK(case when json_valid("application_drafts"."form_data") then json_type("application_drafts"."form_data") = 'object' and length("application_drafts"."form_data") <= 98304 else 0 end),
	CONSTRAINT "application_drafts_last_step_check" CHECK("application_drafts"."last_step" in ('identity', 'household', 'housing', 'organizations', 'documents', 'marketing', 'interview'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_drafts_user_batch_unique` ON `application_drafts` (`user_id`,`batch_id`);--> statement-breakpoint
CREATE TABLE `application_files` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`slot` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`checksum` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "application_files_slot_check" CHECK("application_files"."slot" in ('father-income', 'mother-income', 'other-earner-1-income', 'other-earner-2-income', 'debt-proof', 'electricity-bill', 'family-card', 'parent-permission', 'self-photo', 'dtks', 'house-photos', 'vehicle-photos', 'marketing-follow-proof', 'marketing-broadcast-proof', 'marketing-twibbon-proof', 'marketing-story-proof')),
	CONSTRAINT "application_files_content_type_check" CHECK("application_files"."content_type" in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
	CONSTRAINT "application_files_size_check" CHECK("application_files"."size" > 0 and "application_files"."size" <= 10000000),
	CONSTRAINT "application_files_dimensions_check" CHECK(("application_files"."width" is null and "application_files"."height" is null) or ("application_files"."width" is not null and "application_files"."height" is not null and "application_files"."width" > 0 and "application_files"."height" > 0)),
	CONSTRAINT "application_files_checksum_check" CHECK(length("application_files"."checksum") = 32 and "application_files"."checksum" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `application_files_application_slot_idx` ON `application_files` (`application_id`,`slot`);--> statement-breakpoint
CREATE TABLE `email_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "email_daily_day_check" CHECK("email_daily"."day" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "email_daily_sent_check" CHECK("email_daily"."sent" >= 0)
);
--> statement-breakpoint
CREATE TABLE `private_storage` (
	`id` text PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL,
	`files` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "private_storage_singleton_check" CHECK("private_storage"."id" = 'private-files'),
	CONSTRAINT "private_storage_bytes_check" CHECK("private_storage"."bytes" >= 0),
	CONSTRAINT "private_storage_files_check" CHECK("private_storage"."files" >= 0)
);
--> statement-breakpoint
-- Hand-added to the generated file (Drizzle does not model seed rows): the one row of the private-storage counter,
-- with zeros. Nothing has been uploaded yet, so zero is the truth; the daily cleanup reconciles it with the files table.
INSERT INTO `private_storage` (`id`, `bytes`, `files`) VALUES ('private-files', 0, 0);
