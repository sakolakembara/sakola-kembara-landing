-- reports.updated_at (SAKEM-082, the Laporan screen): the version `If-Match` compares, so two admins editing a
-- report's metadata cannot silently overwrite each other (docs/cloudflare/admin-crud.md#6).
--
-- Written by hand, as a table rebuild. `drizzle-kit generate` produced
--   ALTER TABLE `reports` ADD `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL;
-- and SQLite refuses it ("Cannot add a column with non-constant default": ADD COLUMN takes only a constant
-- default). The snapshot in meta/0008_snapshot.json is the generated one, so `pnpm db:drift` still compares the
-- schema with what this file leaves behind.
--
-- Existing rows keep their upload time as their first version. Nothing refers to `reports` (no foreign key
-- points at it), so dropping and renaming is safe; D1's own advice for a rebuild is to defer foreign keys.
PRAGMA defer_foreign_keys = true;--> statement-breakpoint
CREATE TABLE `__new_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`year` text NOT NULL,
	`file_path` text NOT NULL,
	`file_size` integer NOT NULL,
	`uploaded_by` text,
	`uploaded_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reports_category_check" CHECK("__new_reports"."category" in ('yearly', 'financial', 'impact', 'donation')),
	CONSTRAINT "reports_file_size_check" CHECK("__new_reports"."file_size" >= 0),
	CONSTRAINT "reports_year_check" CHECK("__new_reports"."year" glob '[0-9][0-9][0-9][0-9]' or "__new_reports"."year" glob '[0-9][0-9][0-9][0-9]/[0-9][0-9][0-9][0-9]')
);
--> statement-breakpoint
INSERT INTO `__new_reports`(`id`, `title`, `description`, `category`, `year`, `file_path`, `file_size`, `uploaded_by`, `uploaded_at`, `updated_at`) SELECT `id`, `title`, `description`, `category`, `year`, `file_path`, `file_size`, `uploaded_by`, `uploaded_at`, `uploaded_at` FROM `reports`;--> statement-breakpoint
DROP TABLE `reports`;--> statement-breakpoint
ALTER TABLE `__new_reports` RENAME TO `reports`;--> statement-breakpoint
CREATE INDEX `reports_category_year_idx` ON `reports` (`category`,`year`);
