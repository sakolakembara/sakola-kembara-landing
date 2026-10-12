import { AUDIT_LABEL } from "@/lib/audit-labels";

/** The label of an audit action ("announcement.create" is "Pengumuman dibuat"), shared with the legacy admin. */
export function activityLabel(action: string): string {
  return AUDIT_LABEL[action] ?? action;
}

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
