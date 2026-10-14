-- blog_posts.meta_description (SAKEM-090, the SEO parity run against the live WordPress site, 2026-10-13): the text for
-- `<meta name="description">` when it is not the excerpt, served as `description` on the public article answer. Nullable and
-- without a default: every existing row (and every article written in the admin) simply has none, and the public site falls
-- back to the excerpt. The import script (scripts/import-legacy-blog.ts) fills it for the migrated articles.
-- Additive: an ADD COLUMN with no default is a metadata change in SQLite, no table rebuild and no row is touched.
-- Deploy order: this migration BEFORE the API Worker that selects the column (and before running the import).
ALTER TABLE `blog_posts` ADD `meta_description` text;
