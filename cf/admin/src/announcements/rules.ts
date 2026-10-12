// The rules of an announcement that are about its content rather than its columns (docs/cloudflare/admin-komunikasi.md).
// Pure: no database, no clock, so a test (and the SPA's mock, in miniature) can say the same words.

/**
 * What the Pengumuman list says about a row. Computed on the server with the public strip's own predicate
 * (`announcementIsLive` in src/public/queries.ts) and its order, never from the browser's clock:
 *
 *   current         the one the public strip shows right now ("Tampil sekarang")
 *   superseded      switched on and inside its window, but a more recently created one is shown instead
 *   outside_window  switched on, but its window has not started or has ended ("Aktif, di luar jadwal")
 *   inactive        switched off ("Tidak aktif")
 */
export const announcementStatuses = ["current", "superseded", "outside_window", "inactive"] as const;
export type AnnouncementStatus = (typeof announcementStatuses)[number];

/** The SQL's three-way answer (see `phase` in src/api/announcements.ts) and the id of the one the strip shows, as a status. */
export function statusOf(phase: "live" | "outside_window" | "inactive", id: string, currentId: string | null): AnnouncementStatus {
  if (phase === "live") return id === currentId ? "current" : "superseded";
  return phase;
}

// CTA URL. The legacy form accepted any text (the hint said "/gabung-siswa atau URL lengkap (https://...)"), and the
// public strip puts it in an `href` as it is, so `javascript:` or `data:` would run on every public page. The rule is
// the one the legacy shortlink form already had for its target (lib/shortlinks.ts `validateTarget`), with its words.
export const CTA_URL_MESSAGES = {
  offSite: "Gunakan URL lengkap (https://...) untuk tujuan di luar situs ini.",
  format: "Format URL tidak valid. Gunakan https://... atau /path-di-situs-ini.",
  scheme: "Hanya URL http:// atau https:// yang diizinkan.",
} as const;

/** Control characters and the backslash (which a browser reads as a slash) have no place in a path. */
const UNSAFE_IN_PATH = /[\u0000-\u001f\u007f\\]/;

/** Why `raw` cannot be a CTA URL, in Indonesian, or null when it can: a path of this site (`/gabung-siswa`) or an `http(s)://` URL. */
export function ctaUrlProblem(raw: string): string | null {
  const url = raw.trim();
  if (url.startsWith("/")) {
    // "//host" is protocol-relative: it leaves this site, so it must be written out in full.
    if (url.startsWith("//")) return CTA_URL_MESSAGES.offSite;
    return UNSAFE_IN_PATH.test(url) ? CTA_URL_MESSAGES.format : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return CTA_URL_MESSAGES.format;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? null : CTA_URL_MESSAGES.scheme;
}
