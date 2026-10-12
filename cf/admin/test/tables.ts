/**
 * Every application table, children before parents, so rows can be deleted in
 * this order without tripping a foreign key (student_applications.batch_id is
 * ON DELETE RESTRICT). test/setup.ts empties them in this order before each
 * test, and test/schema.test.ts fails when a table exists that is not listed
 * here, so a new table cannot silently leak rows between tests.
 */
export const TABLES_CHILD_FIRST = [
  "audit_log",
  "admin_area_grants",
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
