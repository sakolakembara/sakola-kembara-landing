-- donations (SAKEM-128): the confirmations of the site's /donasi form, which replaces the Google Form "Form Donasi Sakola Kembara".
-- A NEW table only: nothing existing is altered, no row of another table is read or written. Deploy order: this migration
-- BEFORE the admin Worker that reads and writes it, and that Worker BEFORE the site Worker whose /donasi calls it. An older
-- admin Worker never names the table; a rollback of either Worker needs no rollback of the table (it is just unused).
-- Personal data (name, WhatsApp, amount, receipt key): read only by the super admin's Donasi menu (docs/cloudflare/donations.md).
CREATE TABLE `donations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`whatsapp` text NOT NULL,
	`amount` integer NOT NULL,
	`start_month` text,
	`remind_day` integer,
	`source` text,
	`status` text NOT NULL,
	`note` text,
	`token_hash` text NOT NULL,
	`proof_key` text,
	`proof_type` text,
	`proof_size` integer,
	`proof_at` integer,
	`checked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "donations_kind_check" CHECK("donations"."kind" in ('once', 'monthly')),
	CONSTRAINT "donations_status_check" CHECK("donations"."status" in ('awaiting_transfer', 'new', 'checked')),
	CONSTRAINT "donations_source_check" CHECK("donations"."source" is null or "donations"."source" in ('instagram', 'twitter', 'whatsapp', 'friend', 'website', 'other')),
	CONSTRAINT "donations_name_check" CHECK(length("donations"."name") between 1 and 120),
	CONSTRAINT "donations_whatsapp_check" CHECK("donations"."whatsapp" glob '62[0-9]*' and length("donations"."whatsapp") between 10 and 15),
	CONSTRAINT "donations_amount_check" CHECK("donations"."amount" > 0 and "donations"."amount" <= 1000000000),
	CONSTRAINT "donations_note_check" CHECK("donations"."note" is null or length("donations"."note") <= 2000),
	CONSTRAINT "donations_token_hash_check" CHECK(length("donations"."token_hash") = 64 and "donations"."token_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "donations_kind_fields_check" CHECK(("donations"."kind" = 'once' and "donations"."start_month" is null and "donations"."remind_day" is null)
        or ("donations"."kind" = 'monthly' and "donations"."start_month" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]' and "donations"."remind_day" between 1 and 31
            and "donations"."proof_key" is null and "donations"."status" != 'awaiting_transfer')),
	CONSTRAINT "donations_proof_check" CHECK(("donations"."proof_key" is null and "donations"."proof_type" is null and "donations"."proof_size" is null and "donations"."proof_at" is null)
        or ("donations"."proof_key" is not null and "donations"."proof_type" in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')
            and "donations"."proof_size" > 0 and "donations"."proof_size" <= 10000000 and "donations"."proof_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `donations_created_at_idx` ON `donations` (`created_at`);--> statement-breakpoint
CREATE INDEX `donations_status_idx` ON `donations` (`status`);