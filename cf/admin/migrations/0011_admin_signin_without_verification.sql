-- Hand-written (drizzle-kit generate --custom): Drizzle does not model views or triggers.
--
-- An admin never has to verify an email address (SAKEM-089). An admin exists only because a
-- super_admin created or invited them, and that is the trust: one created with a password is
-- made verified in the same insert, and one invited becomes verified when they open the invite
-- link (the link is also what gives them a password). Students are unchanged: they still
-- verify, and `requireEmailVerification` is still on for them.
--
-- So "can sign in" for a super_admin (SAKEM-087, the view of migration 0010) loses its middle
-- condition. A super_admin can sign in when both hold:
--   * deactivated_at is null     a deactivated account gets no session by any method
--   * an account row exists      a password (credential) or a linked Google account; no row =
--                                nothing to sign in with (an invitation nobody accepted)
-- Not part of it any more: email_verified. For an admin it is true whenever there is an account,
-- because the two ways to get an account (created with a password, accepting an invitation) both
-- set it; the statement at the end makes that true for rows that were made before this migration.
-- docs/cloudflare/auth.md#the-last-super_admin explains the definition.
--
-- The trigger `users_keep_one_super_admin` (migration 0010) is NOT replaced: it reads the view by
-- name (SQLite resolves it when the trigger fires), so it follows the new definition by itself.
-- The view is dropped and made again in consecutive statements of one file, so the window in
-- which a guarded UPDATE would find no view is as short as a file allows, as in 0010.
--
-- Deploy order: ship the Worker first and apply this migration after. The Worker of this change
-- already makes admins verified, so it satisfies the old view as well; the old Worker on the new
-- view would count an admin created with a password and not yet verified as one who can sign in
-- (it cannot, there). The reverse order only matters in that window. After applying it to a real
-- database, check the view is the new one (docs/cloudflare/auth.md#the-last-super_admin has the query).
DROP VIEW `signable_super_admins`;
--> statement-breakpoint
CREATE VIEW `signable_super_admins` AS
SELECT `u`.`id` AS `id`
FROM `users` AS `u`
WHERE `u`.`role` = 'super_admin'
  AND `u`.`deactivated_at` IS NULL
  AND EXISTS (SELECT 1 FROM `account` AS `a` WHERE `a`.`user_id` = `u`.`id`);
--> statement-breakpoint
-- Rows made before this migration: an admin who already has a way in (a password or a linked
-- Google account) but whose address nobody opened a link for. Under the old rule they were
-- refused at sign-in (403) until they did; under this one they are who the view says they are,
-- someone who can sign in. Students are not touched. On an empty database it changes nothing.
UPDATE `users`
SET `email_verified` = 1
WHERE `email_verified` = 0
  AND `role` IN ('viewer', 'editor', 'super_admin')
  AND EXISTS (SELECT 1 FROM `account` AS `a` WHERE `a`.`user_id` = `users`.`id`);
