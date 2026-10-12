CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`cta_label` text,
	`cta_url` text,
	`active` integer DEFAULT false NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "announcements_severity_check" CHECK("announcements"."severity" in ('info', 'warning', 'urgent')),
	CONSTRAINT "announcements_cta_pair_check" CHECK(("announcements"."cta_label" is null) = ("announcements"."cta_url" is null)),
	CONSTRAINT "announcements_window_check" CHECK("announcements"."starts_at" is null or "announcements"."ends_at" is null or "announcements"."ends_at" >= "announcements"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `announcements_active_idx` ON `announcements` (`active`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `contact_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "contact_messages_subject_check" CHECK("contact_messages"."subject" in ('partnership', 'donation', 'other'))
);
--> statement-breakpoint
CREATE INDEX `contact_messages_created_at_idx` ON `contact_messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `contact_messages_read_at_idx` ON `contact_messages` (`read_at`);--> statement-breakpoint
CREATE INDEX `contact_messages_email_idx` ON `contact_messages` (`email`);