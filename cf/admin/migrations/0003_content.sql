CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`year` text NOT NULL,
	`file_path` text NOT NULL,
	`file_size` integer NOT NULL,
	`uploaded_by` text,
	`uploaded_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reports_category_check" CHECK("reports"."category" in ('yearly', 'financial', 'impact', 'donation')),
	CONSTRAINT "reports_file_size_check" CHECK("reports"."file_size" >= 0),
	CONSTRAINT "reports_year_check" CHECK("reports"."year" glob '[0-9][0-9][0-9][0-9]' or "reports"."year" glob '[0-9][0-9][0-9][0-9]/[0-9][0-9][0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `reports_category_year_idx` ON `reports` (`category`,`year`);--> statement-breakpoint
CREATE TABLE `shortlinks` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`target_url` text NOT NULL,
	`note` text,
	`active` integer DEFAULT true NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`last_clicked_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shortlinks_slug_check" CHECK(length("shortlinks"."slug") between 1 and 64 and "shortlinks"."slug" not glob '*[^a-z0-9-]*' and "shortlinks"."slug" not glob '-*' and "shortlinks"."slug" not glob '*-' and "shortlinks"."slug" not glob '*--*'),
	CONSTRAINT "shortlinks_target_check" CHECK(("shortlinks"."target_url" like '/%' and "shortlinks"."target_url" not like '//%') or "shortlinks"."target_url" like 'http://%' or "shortlinks"."target_url" like 'https://%'),
	CONSTRAINT "shortlinks_click_count_check" CHECK("shortlinks"."click_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shortlinks_slug_idx` ON `shortlinks` (`slug`);--> statement-breakpoint
CREATE TABLE `site_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text DEFAULT 'lainnya' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`content_type` text NOT NULL,
	`file_path` text,
	`file_size` integer,
	`external_url` text,
	`body_text` text,
	`notes` text,
	`updated_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "site_resources_category_check" CHECK("site_resources"."category" in ('panduan', 'berkas-pendaftaran', 'berkas-marketing', 'tutorial', 'lainnya')),
	CONSTRAINT "site_resources_content_type_check" CHECK("site_resources"."content_type" in ('file', 'url', 'text')),
	CONSTRAINT "site_resources_file_size_check" CHECK("site_resources"."file_size" is null or "site_resources"."file_size" >= 0),
	CONSTRAINT "site_resources_shape_check" CHECK(("site_resources"."content_type" = 'file' and "site_resources"."file_path" is not null and "site_resources"."file_size" is not null and "site_resources"."external_url" is null and "site_resources"."body_text" is null)
        or ("site_resources"."content_type" = 'url' and "site_resources"."external_url" is not null and "site_resources"."file_path" is null and "site_resources"."file_size" is null and "site_resources"."body_text" is null)
        or ("site_resources"."content_type" = 'text' and "site_resources"."body_text" is not null and "site_resources"."file_path" is null and "site_resources"."file_size" is null and "site_resources"."external_url" is null))
);
--> statement-breakpoint
CREATE INDEX `site_resources_category_order_idx` ON `site_resources` (`category`,`display_order`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`image` text,
	`category` text DEFAULT 'pengurus' NOT NULL,
	`bio` text,
	`education_history` text DEFAULT '[]' NOT NULL,
	`work_history` text DEFAULT '[]' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "team_members_category_check" CHECK("team_members"."category" in ('dewan_pembina', 'dewan_pengawas', 'pengurus')),
	CONSTRAINT "team_members_display_order_check" CHECK("team_members"."display_order" between 0 and 9999),
	CONSTRAINT "team_members_education_json_check" CHECK("team_members"."education_history" is null or json_valid("team_members"."education_history")),
	CONSTRAINT "team_members_work_json_check" CHECK("team_members"."work_history" is null or json_valid("team_members"."work_history")),
	CONSTRAINT "team_members_history_array_check" CHECK(json_type("team_members"."education_history") = 'array' and json_type("team_members"."work_history") = 'array')
);
--> statement-breakpoint
CREATE INDEX `team_members_display_order_idx` ON `team_members` (`display_order`);--> statement-breakpoint
CREATE INDEX `team_members_category_idx` ON `team_members` (`category`);--> statement-breakpoint
CREATE TABLE `blog_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text NOT NULL,
	`content_markdown` text NOT NULL,
	`content_html` text NOT NULL,
	`image` text,
	`image_width` integer,
	`image_height` integer,
	`category` text NOT NULL,
	`author` text NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`wp_id` integer,
	`source_url` text,
	`created_by` text,
	`updated_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "blog_posts_category_check" CHECK("blog_posts"."category" in ('Career', 'Cerita', 'Education', 'Kiat kiat', 'News', 'Testimonials', 'Tips', 'Uncategorized')),
	CONSTRAINT "blog_posts_status_check" CHECK("blog_posts"."status" in ('draft', 'published')),
	CONSTRAINT "blog_posts_slug_check" CHECK(length("blog_posts"."slug") between 1 and 160 and "blog_posts"."slug" not glob '*[^a-z0-9-]*' and "blog_posts"."slug" not glob '-*' and "blog_posts"."slug" not glob '*-' and "blog_posts"."slug" not glob '*--*'),
	CONSTRAINT "blog_posts_published_at_check" CHECK("blog_posts"."status" <> 'published' or "blog_posts"."published_at" is not null),
	CONSTRAINT "blog_posts_image_size_check" CHECK((("blog_posts"."image_width" is null) = ("blog_posts"."image_height" is null)) and ("blog_posts"."image_width" is null or ("blog_posts"."image_width" > 0 and "blog_posts"."image_height" > 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_posts_slug_idx` ON `blog_posts` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `blog_posts_wp_id_idx` ON `blog_posts` (`wp_id`);--> statement-breakpoint
CREATE INDEX `blog_posts_status_published_idx` ON `blog_posts` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`purpose` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "media_purpose_check" CHECK("media"."purpose" in ('blog', 'team', 'report', 'resource')),
	CONSTRAINT "media_key_check" CHECK(length("media"."key") > 0 and "media"."key" not like '/%'),
	CONSTRAINT "media_size_check" CHECK("media"."size" >= 0),
	CONSTRAINT "media_dimensions_check" CHECK((("media"."width" is null) = ("media"."height" is null)) and ("media"."width" is null or ("media"."width" > 0 and "media"."height" > 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_key_idx` ON `media` (`key`);--> statement-breakpoint
CREATE INDEX `media_purpose_created_idx` ON `media` (`purpose`,`created_at`);