// Slugs a shortlink may never take, because a real path of the public site already answers them.
//
// Port of RESERVED_SLUGS in the legacy lib/shortlinks.ts, widened for the Cloudflare site. The trap is the
// same as there: the site resolves a real page, a legacy path, a redirect rule or a static file BEFORE it
// looks for a shortlink (cf/web/src/pages/[...path].astro is the catch-all that runs last), so a shortlink
// called `donasi` would sit in the admin list looking fine and never fire. Refusing the slug when it is
// created is the only place anybody can be told.
//
// Keep it in step with the site. Add a name here in the same PR that adds a top-level page, a legacy
// prefix (cf/web/src/lib/legacy-paths.ts), a redirect source (cf/web/redirects.config.mjs) or a root file.
// test/shortlinks-reserved.test.ts derives those names from cf/web itself and fails when one is missing.

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // ---- the legacy list (lib/shortlinks.ts), kept as it was: pages, routes and a few spare names
  "admin",
  "api",
  "portal",
  "login",
  "logout",
  "register",
  "auth",
  "dashboard",
  "forgot-password",
  "reset-password",
  "verify-email",
  "blog",
  "donasi",
  "gabung-siswa",
  "kontak",
  "laporan",
  "program",
  "tim",
  "robots",
  "sitemap",
  "_next",
  "images",
  "files",
  "reports",
  "resources",
  "favicon",
  "static",

  // ---- new for the Cloudflare site
  // The 404 page has a URL of its own (cf/web/src/pages/404.astro), and `index` is the name of the home page's file.
  "404",
  "index",
  // Redirect sources of cf/web/redirects.config.mjs: the assets layer answers them before the Worker runs, so a
  // shortlink with one of these names would never be reached. Old WordPress category archives:
  "cerita",
  "education",
  "news",
  "tips",
  "testimonials",
  "career",
  "kiat-kiat",
  // Old call-to-action addresses and renamed pages. `daftar` is NOT here (SAKEM-103, Phase A of the cutover): `/daftar` is the
  // registration shortlink, created in this admin, whose target is the form of the current cohort. A test of cf/web
  // (tests/shortlink-reserved.test.ts) fails the day anything claims that name again.
  "apply",
  "tentang-kami",
  "about",
  "impact-reports",
  "feed",
  // WordPress's own paths, forwarded by the site to the WordPress origin behind the same hostname (SAKEM-103, cf/web/src/lib/legacy-paths.ts):
  // the Worker forwards them before it looks for a shortlink. (`/wp-login.php` and `/xmlrpc.php` have a dot, which no slug has.)
  "wp-admin",
  "wp-content",
  "wp-includes",
  "wp-json",
  // WordPress pages and archives of the live sitemap that the redirect table sends to the new site's pages (SAKEM-090):
  "home",
  "sample-page",
  "who-we-are",
  "our-partners",
  "contact-us",
  "donate",
  "donation-confirmation",
  "donation-confirmation-2",
  "donation-failed",
  "donation-failed-2",
  "donor-dashboard",
  "donor-dashboard-2",
  "work-with-us",
  // ...and the archives, `/category/*` and `/tag/*`, which go to the blog index:
  "category",
  "tag",
]);
