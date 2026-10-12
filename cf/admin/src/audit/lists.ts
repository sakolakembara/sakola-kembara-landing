// The audit vocabulary as plain data (docs/cloudflare/admin-sistem.md): every action and resource type the Worker can
// write. No imports, so the SPA's tests can read the lists without pulling in the Worker's runtime types;
// src/audit/declared.ts is where the compiler checks them against the unions of src/db/audit.ts.

export const CRUD_NAMES = ["announcement", "report", "blog", "team", "resource", "shortlink", "batch", "contact_message"] as const;

const CRUD_ACTIONS = CRUD_NAMES.flatMap((name) => (["create", "update", "delete"] as const).map((verb) => `${name}.${verb}` as const));

export const DECLARED_ACTIONS = [
  // Uploads to R2.
  "upload.create",
  "upload.delete",
  // The CRUD kit's three verbs for every resource the legacy admin had.
  ...CRUD_ACTIONS,
  // The legacy verb actions.
  "application.submit",
  "application.pending",
  "application.under_review",
  "application.accepted",
  "application.rejected",
  "application.revoke",
  "batch.publish_results",
  "batch.unpublish_results",
  "contact_message.submit",
  "contact_message.read",
  "contact_message.unread",
  // Pengaturan.
  "admin.create",
  "admin.update",
  "admin.deactivate",
  "admin.reactivate",
  "admin.invite_resend",
  // Written by the auth flows.
  "student.register",
  "user.email_verified",
  "user.password_reset",
] as const;

export const DECLARED_RESOURCE_TYPES = [
  "media",
  "announcement",
  "admin_user",
  "user",
  "application",
  "batch",
  "report",
  "blog",
  "team_member",
  "contact_message",
  "site_resource",
  "shortlink",
] as const;
