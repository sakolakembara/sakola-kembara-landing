// Shared mapping + deep-link helper for audit_log rows. Both the /admin
// dashboard and the /admin/audit viewer render rows through these so the
// label and link logic stay in sync.

/**
 * Every action the app logs, with its label. `writeAudit()` accepts only
 * these keys (see `AuditAction`), so a new action can't be logged without a
 * label. `application.${status}` covers each application status.
 */
const ACTION_LABEL = {
  "application.submit": "Pendaftar baru",
  "application.pending": "Pendaftar ditandai Pending",
  "application.under_review": "Pendaftar ditandai Dalam Review",
  "application.accepted": "Pendaftar diterima",
  "application.rejected": "Pendaftar ditolak",
  "application.revoke": "Penerimaan dicabut",
  "batch.create": "Batch dibuat",
  "batch.update": "Batch diubah",
  "batch.publish_results": "Hasil batch dipublikasikan",
  "batch.unpublish_results": "Publikasi hasil batch dibatalkan",
  "announcement.create": "Pengumuman dibuat",
  "announcement.update": "Pengumuman diubah",
  "announcement.delete": "Pengumuman dihapus",
  "report.create": "Laporan ditambahkan",
  "report.update": "Laporan diubah",
  "report.delete": "Laporan dihapus",
  "blog.create": "Artikel dibuat",
  "blog.update": "Artikel diubah",
  "blog.delete": "Artikel dihapus",
  "blog.upload_image": "Gambar blog diunggah",
  "team.create": "Anggota tim ditambahkan",
  "team.update": "Anggota tim diubah",
  "team.delete": "Anggota tim dihapus",
  "team.upload_photo": "Foto anggota diunggah",
  "contact_message.submit": "Pesan masuk",
  "contact_message.read": "Pesan dibaca",
  "contact_message.unread": "Pesan ditandai belum dibaca",
  "contact_message.delete": "Pesan dihapus",
  "admin.create": "Admin ditambahkan",
  "admin.update": "Admin diubah",
  "admin.delete": "Admin dihapus",
  "resource.create": "Berkas pendaftaran dibuat",
  "resource.update": "Berkas pendaftaran diubah",
  "resource.delete": "Berkas pendaftaran dihapus",
  "shortlink.create": "Shortlink dibuat",
  "shortlink.update": "Shortlink diubah",
  "shortlink.delete": "Shortlink dihapus",
  "student.register": "Akun siswa dibuat",
  "user.email_verified": "Email diverifikasi",
  "user.password_reset": "Password diatur ulang",
} as const;

export type AuditAction = keyof typeof ACTION_LABEL;

/** Labels for every action that can appear in audit_log, including ones only older code wrote. */
export const AUDIT_LABEL: Record<string, string> = {
  // Written by the code still running in production (main); no longer
  // logged here, but those rows stay in the table. "(lama)" keeps them apart
  // from today's actions in the filter, e.g. the two kinds of "Pesan dibaca".
  "application.review": "Pendaftar ditinjau (lama)",
  "contact.read": "Pesan dibaca (lama)",
  "contact.archive": "Pesan diarsipkan (lama)",
  "report.upload": "File laporan diunggah (lama)",
  ...ACTION_LABEL,
};

export const KNOWN_ACTIONS = Object.keys(AUDIT_LABEL).sort();

/** Every resource type the app logs, with its label, in the audit filter's order. */
const RESOURCE_TYPES = {
  application: "Pendaftar",
  batch: "Batch",
  announcement: "Pengumuman",
  report: "Laporan",
  blog: "Blog",
  blog_image: "Gambar blog",
  team_member: "Anggota tim",
  team_photo: "Foto tim",
  contact_message: "Pesan",
  admin_user: "Admin",
  user: "Akun",
  site_resource: "Berkas Pendaftaran",
  shortlink: "Shortlink",
} as const;

export type AuditResourceType = keyof typeof RESOURCE_TYPES;

export const KNOWN_RESOURCE_TYPES = Object.keys(RESOURCE_TYPES) as AuditResourceType[];

export const RESOURCE_TYPE_LABEL: Record<string, string> = {
  // Older names, still in existing rows.
  blog_post: "Blog",
  student_application: "Pendaftar",
  ...RESOURCE_TYPES,
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
    case "batch":
      return `/admin/batches/${resourceId}`;
    case "contact_message":
      return `/admin/messages/${resourceId}`;
    case "admin_user":
      return `/admin/settings/${resourceId}/edit`;
    case "site_resource":
      return `/admin/resources`;
    case "shortlink":
      return `/admin/shortlinks/${resourceId}/edit`;
    default:
      return null;
  }
}
