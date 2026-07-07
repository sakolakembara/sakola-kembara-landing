// Shared mapping + deep-link helper for audit_log rows. Both the /admin
// dashboard and the /admin/audit viewer render rows through these so the
// label and link logic stay in sync.

export const AUDIT_LABEL: Record<string, string> = {
  "application.submit": "Pendaftar baru",
  "application.review": "Pendaftar ditinjau",
  "announcement.create": "Pengumuman dibuat",
  "announcement.update": "Pengumuman diubah",
  "announcement.delete": "Pengumuman dihapus",
  "report.create": "Laporan ditambahkan",
  "report.update": "Laporan diubah",
  "report.delete": "Laporan dihapus",
  "report.upload": "File laporan diunggah",
  "blog.create": "Artikel dibuat",
  "blog.update": "Artikel diubah",
  "blog.delete": "Artikel dihapus",
  "blog.upload_image": "Gambar blog diunggah",
  "team.create": "Anggota tim ditambahkan",
  "team.update": "Anggota tim diubah",
  "team.delete": "Anggota tim dihapus",
  "team.upload_photo": "Foto anggota diunggah",
  "contact.read": "Pesan dibaca",
  "contact.archive": "Pesan diarsipkan",
  "admin.create": "Admin ditambahkan",
  "admin.update": "Admin diubah",
  "admin.delete": "Admin dihapus",
  "resource.create": "Resource dibuat",
  "resource.update": "Resource diubah",
  "resource.delete": "Resource dihapus",
};

export const KNOWN_ACTIONS = Object.keys(AUDIT_LABEL).sort();

export const KNOWN_RESOURCE_TYPES = [
  "announcement",
  "report",
  "blog",
  "team_member",
  "team_photo",
  "student_application",
  "contact_message",
  "admin_user",
  "site_resource",
] as const;

export const RESOURCE_TYPE_LABEL: Record<string, string> = {
  announcement: "Pengumuman",
  report: "Laporan",
  blog: "Blog",
  blog_post: "Blog",
  team_member: "Anggota tim",
  team_photo: "Foto tim",
  student_application: "Pendaftar",
  application: "Pendaftar",
  contact_message: "Pesan",
  admin_user: "Admin",
  site_resource: "Resource",
};

/**
 * Map an audit row to the admin route where its target is most viewable.
 * Returns null when there is no good destination — *.delete actions point at
 * a row that no longer exists, and rows without a resourceId have nothing to
 * link to.
 */
export function auditHref(
  action: string,
  resourceType: string | null,
  resourceId: string | null,
): string | null {
  if (!resourceType || !resourceId) return null;
  if (action.endsWith(".delete")) return null;
  switch (resourceType) {
    case "announcement":
      return `/admin/announcements/${resourceId}/edit`;
    case "report":
      return `/admin/reports/${resourceId}/edit`;
    case "blog":
    case "blog_post":
      return `/admin/blog/${resourceId}/edit`;
    case "team_member":
      return `/admin/team/${resourceId}/edit`;
    case "student_application":
    case "application":
      return `/admin/applications/${resourceId}`;
    case "contact_message":
      return `/admin/messages/${resourceId}`;
    case "admin_user":
      return `/admin/settings/${resourceId}/edit`;
    case "site_resource":
      return `/admin/resources`;
    default:
      return null;
  }
}
