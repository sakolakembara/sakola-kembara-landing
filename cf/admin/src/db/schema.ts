// The whole D1 schema. One file per concern under ./schema/, re-exported here
// so `import * as schema from "../db/schema"` (Drizzle, Better Auth, the API)
// sees every table. Conventions and the legacy-to-D1 mapping, column by column:
// docs/cloudflare/d1-schema.md.
//
//   auth                 users, session, account, verification        (Better Auth)
//   admin-area-grants    admin_area_grants                             (permissions)
//   audit                audit_log
//   admission            admission_batches, student_applications
//   communication        announcements, contact_messages
//   content              reports, team_members, site_resources, shortlinks
//   blog                 blog_posts
//   media                media                                          (R2 uploads)
//   portal               application_drafts, application_files, private_storage, email_daily   (the student portal)
//
// Not ported on purpose: legacy `accounts` (Better Auth's `account` replaces
// it) and `rate_limit_hits` (Cloudflare rate limit bindings replace it).

export * from "./schema/auth";
export * from "./schema/admin-area-grants";
export * from "./schema/audit";
export * from "./schema/admission";
export * from "./schema/communication";
export * from "./schema/content";
export * from "./schema/blog";
export * from "./schema/media";
export * from "./schema/portal";
