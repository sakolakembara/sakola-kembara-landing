-- Hand-written (drizzle-kit generate --custom): Drizzle does not model views or triggers.
--
-- "The last super_admin" now means the last one who can actually sign in
-- (SAKEM-087). Migration 0006 counted every super_admin whose deactivated_at is
-- null, which includes an invitation nobody has opened: the only super_admin who
-- can sign in could step down while the other one had never accepted, and then
-- nobody could open Pengaturan again.
--
-- The definition lives in ONE place, the view below, and both users of it read it:
-- the trigger (the guarantee, inside the transaction of the change) and the API
-- (src/api/admin-users.ts, the friendly 409 before anything is written). A super_admin
-- can sign in when all three hold:
--   * deactivated_at is null     a deactivated account gets no session by any method
--   * email_verified = 1         requireEmailVerification: password sign-in is refused
--                                until the address is verified, and an invited admin
--                                becomes verified only by redeeming the invite link
--   * an account row exists      a password (credential) or a linked Google account;
--                                no row = nothing to sign in with (an invitation that
--                                was never accepted)
-- docs/cloudflare/auth.md#the-last-super_admin explains why these three.
--
-- A statement that removes someone from the view only matters when that someone is
-- in it: demoting or deactivating a super_admin who cannot sign in anyway (a pending
-- invitation) never reduces the people who can, so it is allowed.
--
-- Deploy order: apply this migration BEFORE the Worker that reads the view. The old
-- Worker keeps working on the new trigger (stricter, same 409 and message); the new
-- Worker on the old schema would fail on the missing view.
--
-- Order inside the file: the view first (nothing reads it yet), then the old trigger
-- is dropped and the new one created straight after, so the window without a guard is
-- as short as a file allows. After applying it to a real database, check that the
-- trigger is there (docs/cloudflare/auth.md#the-last-super_admin has the query).
CREATE VIEW `signable_super_admins` AS
SELECT `u`.`id` AS `id`
FROM `users` AS `u`
WHERE `u`.`role` = 'super_admin'
  AND `u`.`deactivated_at` IS NULL
  AND `u`.`email_verified` = 1
  AND EXISTS (SELECT 1 FROM `account` AS `a` WHERE `a`.`user_id` = `u`.`id`);
--> statement-breakpoint
DROP TRIGGER `users_keep_one_super_admin`;
--> statement-breakpoint
CREATE TRIGGER `users_keep_one_super_admin`
BEFORE UPDATE OF `role`, `deactivated_at` ON `users`
WHEN OLD.`id` IN (SELECT `id` FROM `signable_super_admins`)
  AND (NEW.`role` <> 'super_admin' OR NEW.`deactivated_at` IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM `signable_super_admins` WHERE `id` <> OLD.`id`)
BEGIN
  SELECT RAISE(ABORT, 'last_super_admin');
END;
