/**
 * Every application table, children before parents, so rows can be deleted in
 * this order without tripping a foreign key (student_applications.batch_id is
 * ON DELETE RESTRICT, and so is application_drafts.batch_id). test/setup.ts
 * empties them in this order before each test, and test/schema.test.ts fails
 * when a table exists that is not listed here, so a new table cannot silently
 * leak rows between tests.
 */
export const TABLES_CHILD_FIRST = [
  "audit_log",
  "admin_area_grants",
  "application_files",
  "application_drafts",
  "email_daily",
  "private_storage",
  "student_applications",
  "admission_batches",
  "announcements",
  "contact_messages",
  "reports",
  "team_members",
  "site_resources",
  "shortlinks",
  "blog_posts",
  "media",
  "verification",
  "account",
  "session",
  "users",
] as const;

/**
 * Tables that always hold their one row (migration 0013 inserts it): setup puts the row back
 * after emptying instead of leaving the table bare, so a test of the upload route finds its counter.
 */
export const SINGLETON_ROWS: Record<string, string> = {
  private_storage: "INSERT INTO private_storage (id, bytes, files) VALUES ('private-files', 0, 0)",
};

/**
 * Tables the dev seed (scripts/seed-data.ts) deliberately writes no row to: a draft is made through the portal, and a
 * file row would point at an object the dev bucket does not have. Everything else must have a row after the seed.
 */
export const UNSEEDED_TABLES: readonly string[] = ["application_files", "application_drafts", "email_daily"];
