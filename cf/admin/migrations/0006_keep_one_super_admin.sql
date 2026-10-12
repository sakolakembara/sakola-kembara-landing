-- Hand-written (drizzle-kit generate --custom): Drizzle does not model triggers.
--
-- The system always keeps at least one active super_admin. Without one nobody
-- could open Pengaturan, grant areas or invite an admin again. The API checks
-- this first (src/api/admin-users.ts answers 409 last_super_admin), and this
-- trigger is the guarantee underneath it: it runs inside the same transaction
-- as the change, so two super_admins demoting or deactivating each other at the
-- same moment cannot both succeed, and a raw UPDATE cannot do it either.
--
-- It looks only at the row being changed: a super_admin who is not active
-- (deactivated_at set) does not count as "another" super_admin.
CREATE TRIGGER `users_keep_one_super_admin`
BEFORE UPDATE OF `role`, `deactivated_at` ON `users`
WHEN OLD.`role` = 'super_admin'
  AND OLD.`deactivated_at` IS NULL
  AND (NEW.`role` <> 'super_admin' OR NEW.`deactivated_at` IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM `users`
    WHERE `role` = 'super_admin' AND `deactivated_at` IS NULL AND `id` <> OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'last_super_admin');
END;
