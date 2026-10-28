-- blog_posts.seo_title and blog_posts.noindex (SAKEM-109, the blog form's "Judul SEO" and "Sembunyikan dari Google").
-- seo_title: nullable, no default: every existing row has none and the page keeps its title (article title + site suffix).
-- noindex: NOT NULL DEFAULT false (0): every existing row stays indexed. Both are ADD COLUMN, a metadata change in SQLite:
-- no table rebuild, no row rewritten.
-- Deploy order: this migration BEFORE the admin Worker that selects the columns, and the admin Worker before the site
-- (the site treats a missing field as none/false, so it is also safe before them).
ALTER TABLE `blog_posts` ADD `seo_title` text;--> statement-breakpoint
ALTER TABLE `blog_posts` ADD `noindex` integer DEFAULT false NOT NULL;