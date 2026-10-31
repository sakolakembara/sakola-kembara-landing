-- media.alt_text (SAKEM-117, the Media library: the text alternative of an image, written in the library and offered by the picker).
-- Nullable, no default: every existing row has none. ADD COLUMN is a metadata change in SQLite: no table rebuild, no row rewritten.
-- Deploy order: this migration BEFORE the admin Worker that selects the column (the Worker's list and detail read it). An older
-- Worker never names the column, so it keeps working after the migration; a rollback of the Worker needs no rollback of the column.
ALTER TABLE `media` ADD `alt_text` text;
