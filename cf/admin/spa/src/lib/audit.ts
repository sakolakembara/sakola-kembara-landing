import { AUDIT_LABEL, RESOURCE_TYPE_LABEL } from "@/lib/audit-labels";

// The words of the Aktivitas page (docs/cloudflare/admin-sistem.md): the label of an action and of a resource
// type, the lists the two filters offer, and where a row links to. The legacy wording (lib/audit-labels.ts at the
// repo root, used as it is) covers everything the old admin wrote; what the new Worker added gets its label here.

/**
 * Labels for the declared actions (src/audit/declared.ts) that the legacy table does not have: the uploads to R2,
 * the deactivation of an admin (the legacy admin deleted them), and the verbs the CRUD kit declares for every
 * resource whether or not the legacy admin had them. spa/test/audit-labels.test.ts fails when a declared action is
 * in neither table, so no action can reach the page without words.
 */
export const NEW_ACTION_LABEL: Record<string, string> = {
  "upload.create": "Berkas diunggah",
  "upload.delete": "Berkas unggahan dihapus",
  // An applicant's uploaded file (SAKEM-083): an admin opened one (a row each time, ids only), or purged an application's files by hand.
  "application_file.view": "Berkas pendaftar dibuka",
  "application_file.purge": "Berkas pendaftar dihapus",
  "batch.delete": "Batch dihapus",
  "blog.publish": "Artikel diterbitkan",
  "blog.unpublish": "Artikel dikembalikan menjadi draf",
  "contact_message.create": "Pesan dibuat",
  "contact_message.update": "Pesan diubah",
  "admin.deactivate": "Admin dinonaktifkan",
  "admin.reactivate": "Admin diaktifkan kembali",
  "admin.invite_resend": "Undangan admin dikirim ulang",
};

/** The resource types the legacy table has no word for: the file of an upload, an applicant's file, and a draft that was never submitted (SAKEM-093). */
export const NEW_RESOURCE_LABEL: Record<string, string> = {
  media: "Berkas unggahan",
  application_file: "Berkas pendaftar",
  application_draft: "Draf pendaftaran",
};

/** The label of an audit action ("announcement.create" is "Pengumuman dibuat"); a name nobody labelled shows as it is. */
export function activityLabel(action: string): string {
  return AUDIT_LABEL[action] ?? NEW_ACTION_LABEL[action] ?? action;
}

/** The label of a resource type ("team_member" is "Anggota tim"); a name nobody labelled shows as it is. */
export function resourceLabel(resourceType: string): string {
  return RESOURCE_TYPE_LABEL[resourceType] ?? NEW_RESOURCE_LABEL[resourceType] ?? resourceType;
}

/**
 * Every action the Worker can write, which is what the action filter offers and the API accepts (the Worker's
 * `DECLARED_ACTIONS`; a Worker test fails when the two differ). Older rows with a name outside it still show, with
 * their legacy label, they just cannot be filtered for.
 */
export const FILTER_ACTIONS = [
  "admin.create",
  "admin.deactivate",
  "admin.invite_resend",
  "admin.reactivate",
  "admin.update",
  "announcement.create",
  "announcement.delete",
  "announcement.update",
  "application.accepted",
  "application.pending",
  "application.rejected",
  "application.revoke",
  "application.submit",
  "application.under_review",
  "application_file.purge",
  "application_file.view",
  "batch.create",
  "batch.delete",
  "batch.publish_results",
  "batch.unpublish_results",
  "batch.update",
  "blog.create",
  "blog.delete",
  "blog.publish",
  "blog.unpublish",
  "blog.update",
  "contact_message.create",
  "contact_message.delete",
  "contact_message.read",
  "contact_message.submit",
  "contact_message.unread",
  "contact_message.update",
  "report.create",
  "report.delete",
  "report.update",
  "resource.create",
  "resource.delete",
  "resource.update",
  "shortlink.create",
  "shortlink.delete",
  "shortlink.update",
  "student.register",
  "team.create",
  "team.delete",
  "team.update",
  "upload.create",
  "upload.delete",
  "user.email_verified",
  "user.password_reset",
] as const;

/** The resource types the Worker can write, in the order the legacy filter had them (the Worker's `DECLARED_RESOURCE_TYPES`). */
export const FILTER_RESOURCE_TYPES = [
  "application",
  "batch",
  "announcement",
  "report",
  "blog",
  "team_member",
  "contact_message",
  "admin_user",
  "user",
  "site_resource",
  "shortlink",
  "media",
  "application_file",
  "application_draft",
] as const;

export interface FilterOption {
  value: string;
  label: string;
}

/** The options of the "Aksi" select: the legacy page listed the keys in order and showed the labels. */
export const ACTION_OPTIONS: readonly FilterOption[] = FILTER_ACTIONS.map((value) => ({ value, label: activityLabel(value) }));

/** The options of the "Tipe resource" select. */
export const RESOURCE_OPTIONS: readonly FilterOption[] = FILTER_RESOURCE_TYPES.map((value) => ({ value, label: resourceLabel(value) }));

/**
 * Where a row of the activity list should link to in this SPA, or null.
 * Same table as the legacy `auditHref` (lib/audit-labels.ts), pointed at the
 * new routes. Deletions and rows without a target have nowhere to go.
 */
export function activityHref(action: string, resourceType: string | null, resourceId: string | null): string | null {
  if (!resourceType || !resourceId) return null;
  if (action.endsWith(".delete")) return null;
  const id = encodeURIComponent(resourceId);
  switch (resourceType) {
    case "announcement":
      return `/announcements/${id}/edit`;
    case "report":
      return `/reports/${id}/edit`;
    case "blog":
    case "blog_post":
      return `/blog/${id}/edit`;
    case "team_member":
      return `/team/${id}/edit`;
    case "student_application":
    case "application":
      return `/applications/${id}`;
    case "batch":
      return `/batches/${id}`;
    case "contact_message":
      return `/messages/${id}`;
    case "admin_user":
      return `/settings/${id}/edit`;
    case "site_resource":
      return "/resources";
    case "shortlink":
      return `/shortlinks/${id}/edit`;
    default:
      return null;
  }
}
