/**
 * The public site: where a report, the team page or a shortlink can be seen. The admin lives on its own host,
 * so a link to "/laporan" has to name the site's. The legacy admin shared the site's host and used `SITE_URL`
 * of lib/seo.ts, the same value. A constant for now (production is the only site a shortlink is printed for);
 * if staging needs its own, it belongs in `GET /api/config` like `uploadsBaseUrl`.
 */
export const SITE_URL = "https://sakolakembara.org";

/** "sakolakembara.org": the site without its scheme, as the shortlink form shows it in front of the slug. */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");
