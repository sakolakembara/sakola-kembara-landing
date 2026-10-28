// Proves the tests of Phase A of the cutover are not vacuous (SAKEM-103): each check breaks ONE safeguard of the portal switch (the strict value,
// the two sources, the log line, the navbar's two branches, its separate script and the desktop menu moved to the right while the slot is empty),
// of the WordPress pass-through (the segment boundary, the exact entries, the list itself, the redirects that must not shadow it), of the
// registration shortlink (not reserved, not redirected, the polite page, its status and its cache header), of the one-hop WordPress uploads and
// of the staged HSTS, and (SAKEM-105) of the move of the reports into /donasi (the menu, the footer, the anchor, the redirect with its
// fragment, the sitemap, the page that stays rendered by the Worker), runs the tests that must notice, expects them to FAIL, and always
// restores the file. (That the page /donasi answers 200 and is never copied while degraded is in scripts/negative-checks-page-cache.mjs.)
//
//   node scripts/negative-checks-phase-a.mjs        (pnpm test:negative:phase-a)
//
// Run it on a clean tree. A pattern found other than exactly once is reported as FAIL, so a refactor that moves the code cannot silently turn a
// check into a no-op. What the unit tests cannot see (a request that really reaches the stand-in origin, the pages of a build, the Worker variable
// against the built Worker) is the job of scripts/e2e.mjs and scripts/e2e-portal.mjs; the Worker half of the reserved names has its own list in
// cf/admin/scripts/negative-checks-konten-misc.mjs.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
process.chdir(webRoot);

const FLAG = ['tests/portal-enabled.test.ts'];
const NAVBAR = ['tests/portal-links.test.ts', 'tests/portal-enabled.test.ts'];
const PATHS = ['tests/legacy.test.ts', 'tests/redirects.test.ts', 'tests/shortlink-reserved.test.ts'];
const REDIRECTS = ['tests/redirects.test.ts', 'tests/legacy.test.ts'];
const HEADERS = ['tests/headers-sitemap.test.ts'];
const REGISTRATION = ['tests/registration-page.test.ts', 'tests/portal-links.test.ts'];
const PRINTER = ['tests/portal-enabled.test.ts', 'tests/staging-scripts.test.ts'];
const RESERVED = ['tests/shortlink-reserved.test.ts'];
const VOLUNTEER = ['tests/copy.test.ts', 'tests/portal-links.test.ts'];
const COPY = ['tests/copy.test.ts', 'tests/public-pages.test.ts'];
const REPORTS = ['tests/public-pages.test.ts', 'tests/copy.test.ts'];
const REPORTS_REDIRECT = ['tests/redirects.test.ts', 'tests/public-pages.test.ts'];
const SITEMAP = ['tests/headers-sitemap.test.ts'];

const config = 'portal-enabled.config.mjs';
const lib = 'src/lib/portal-enabled.ts';
const astroConfig = 'astro.config.mjs';
const navbar = 'src/components/Navbar.astro';
const session = 'src/components/NavbarSession.astro';
const paths = 'src/lib/legacy-paths.ts';
const redirects = 'redirects.config.mjs';
// A rule that stays in the table: the redirect checks add the rule they must notice right after it.
const REDIRECT_ANCHOR = "  '/gabung-siswa/form': to('/daftar'),\n";
const securityHeaders = 'src/lib/security-headers.ts';
const headersFile = 'public/_headers';
const catchAll = 'src/pages/[...path].astro';
const polite = 'src/components/RegistrationUnavailablePage.astro';
const site = 'src/lib/site.ts';
const middleware = 'src/middleware.ts';
const sitemapLib = 'src/lib/sitemap.ts';
const reportsSection = 'src/components/ReportsSection.astro';
const donasiPage = 'src/pages/donasi.astro';
const printer = '../scripts/staging-deploy-command.mjs';
const adminReserved = '../admin/src/shortlinks/reserved.ts';

const WARN_LINE = 'warn(`portal: ${PORTAL_ENABLED_VARIABLE} is set but is neither "true" nor "false"; the page is rendered with the portal off`);';
const BAR = '{\n      portalOn && (\n        <div class="hidden md:flex items-center justify-self-end">';
const MENU = '{\n      portalOn && (\n        <div class="flex flex-col mt-6">';
const BUTTON = '<a href="/daftar" class="btn">Daftar Sekarang</a>';
const NAV_TAIL = "  { href: '/donasi', label: 'Donasi' },\n  { href: '/blog', label: 'Blog' },\n];";
const FOOTER_REPORTS = "  { href: REPORTS_SECTION_PATH, label: 'Laporan' },\n";
const FRAGMENT_QUERY = "location = fragment < 0 ? location + search : `${location.slice(0, fragment)}${search}${location.slice(fragment)}`;";
const MENU_CLASSES = "!portalOn && 'md:col-start-3 md:justify-end'";
const MENU_PAIR = "'md:col-start-3 md:justify-end'";
const LIST_HEAD = 'export const LEGACY_PATHS: readonly LegacyPath[] = [\n';

const checks = [
  // ---- the portal switch: the value
  { name: 'the switch accepts TRUE (any case) as on', file: config, from: "if (text === 'true') return true;", to: "if (text.toLowerCase() === 'true') return true;", tests: FLAG },
  { name: 'the switch accepts 1 as on', file: config, from: "if (text === 'true') return true;", to: "if (text === 'true' || text === '1') return true;", tests: FLAG },
  { name: 'surrounding whitespace is not ignored', file: config, from: 'const text = value.trim();', to: 'const text = value;', tests: FLAG },
  { name: 'a JSON boolean that reached the Worker as a var switches it on', file: config, from: "if (typeof value !== 'string') return null;", to: "if (typeof value === 'boolean') return value;\n  if (typeof value !== 'string') return null;", tests: FLAG },
  { name: 'unset is ON (the default must be off)', file: config, from: 'if (value === undefined || value === null) return false;', to: 'if (value === undefined || value === null) return true;', tests: FLAG },
  { name: 'an empty value is reported as invalid', file: config, from: "if (text === '') return false;", to: "if (text === '') return null;", tests: FLAG },
  { name: 'an invalid value is not told apart from false (no warning would ever be logged)', file: config, from: "if (text === 'false') return false;\n  return null;\n}", to: "if (text === 'false') return false;\n  return false;\n}", tests: FLAG },
  { name: 'the variable is renamed with TOKEN in it (the printer\'s secret guard would have to be loosened)', file: config, from: "export const PORTAL_ENABLED_VARIABLE = 'PORTAL_ENABLED';", to: "export const PORTAL_ENABLED_VARIABLE = 'PORTAL_TOKEN';", tests: FLAG },

  // ---- the portal switch: which page reads which source
  { name: 'a prerendered page falls back to the Worker variable (the prerender\'s env holds .dev.vars)', file: lib, from: 'if (prerendered) return build === true;', to: 'if (prerendered) return build === true || parsePortalEnabled(runtime) === true;', tests: FLAG },
  { name: 'a rendered page falls back to the build value (the variable could not be unset to switch it off)', file: lib, from: '  return parsed === true;\n}', to: '  return parsed === true || build === true;\n}', tests: FLAG },
  { name: 'an invalid Worker variable switches the portal ON', file: lib, from: '  return parsed === true;\n}', to: '  return parsed !== false;\n}', tests: FLAG },
  { name: 'the invalid-value line is logged on every render, not once per isolate', file: lib, from: 'if (parsed === null && !state.invalid) {', to: 'if (parsed === null) {', tests: FLAG },
  { name: 'an invalid value is repeated in the log line', file: lib, from: WARN_LINE, to: 'warn(`portal: ${PORTAL_ENABLED_VARIABLE} is set but is neither "true" nor "false"; value: ${runtime}`);', tests: FLAG },
  { name: 'the build constant is not defined (the prerendered pages could never get the variable)', file: astroConfig, from: ', __PORTAL_ENABLED__: JSON.stringify(portalEnabled)', to: '', tests: FLAG },
  { name: 'an unset build variable switches the prerendered pages on', file: astroConfig, from: 'const portalEnabled = portalSetting === true;', to: 'const portalEnabled = portalSetting !== false;', tests: FLAG },

  // ---- the navbar
  { name: 'the bar has "Masuk" whatever the switch says', file: navbar, from: BAR, to: BAR.replace('portalOn && (', 'true && ('), tests: NAVBAR },
  { name: 'the mobile menu has "Masuk" whatever the switch says', file: navbar, from: MENU, to: MENU.replace('portalOn && (', 'true && ('), tests: NAVBAR },
  { name: 'the empty slot of the bar gets a registration button again (Dzul decided it stays empty)', file: navbar, from: BAR, to: `{\n      !portalOn && ${BUTTON}\n    }${BAR}`, tests: NAVBAR },
  { name: 'the empty slot of the mobile menu gets a registration button again', file: navbar, from: MENU, to: `{\n      !portalOn && ${BUTTON}\n    }${MENU}`, tests: NAVBAR },
  { name: 'the closing section of /gabung-siswa gets its second sentence back (about progress saved in the browser: the portal wizard)', file: 'src/pages/gabung-siswa.astro', from: 'lead="Isi formulir pendaftaran sekarang."', to: 'lead="Isi formulir pendaftaran sekarang. Formulir dibagi menjadi beberapa bagian dan progres kamu akan tersimpan otomatis di browser ini."', tests: COPY },
  { name: 'the desktop menu is moved to the right whatever the switch says (Phase B would have it next to "Masuk", off the centre)', file: navbar, from: MENU_CLASSES, to: MENU_PAIR, tests: NAVBAR },
  { name: 'the desktop menu is moved to the right only while the portal is ON (the condition is the wrong way round)', file: navbar, from: MENU_CLASSES, to: MENU_CLASSES.replace('!portalOn', 'portalOn'), tests: NAVBAR },
  { name: 'the desktop menu is never moved: with the slot empty it stays unbalanced in the centre column (Dzul, 2026-10-16)', file: navbar, from: MENU_CLASSES, to: 'false', tests: NAVBAR },
  { name: 'the desktop menu takes no third column (it only packs its links to the end of the centre column)', file: navbar, from: MENU_PAIR, to: "'md:justify-end'", tests: NAVBAR },
  { name: 'the desktop menu is not packed to the end of its column (its links start at the left of the third column)', file: navbar, from: MENU_PAIR, to: "'md:col-start-3'", tests: NAVBAR },
  { name: 'the desktop menu is right-aligned with justify-self-end (the word every check reads as "the wrapper of Masuk is there": the production check would fail on a good page)', file: navbar, from: MENU_PAIR, to: "'md:col-start-3 md:justify-self-end'", tests: NAVBAR },
  { name: 'the grid loses its centre column (the menu would be placed by something else than the three columns)', file: navbar, from: 'md:grid-cols-[1fr_auto_1fr]', to: 'md:grid-cols-[1fr_1fr]', tests: NAVBAR },
  { name: 'the logo is no longer on the left of the bar', file: navbar, from: 'class="flex items-center justify-self-start">', to: 'class="flex items-center justify-self-center">', tests: NAVBAR },
  { name: 'the mobile menu changes with the desktop one', file: navbar, from: '<ul class="flex flex-col gap-4">', to: '<ul class="flex flex-col gap-4 md:col-start-3">', tests: NAVBAR },
  { name: 'the session script is rendered on every page (the address of the portal is in a page of Phase A)', file: navbar, from: '</script>{portalOn && <NavbarSession />}', to: '</script><NavbarSession />', tests: NAVBAR },
  { name: 'the navbar no longer tells a page its own kind (a prerendered page would read the Worker variable)', file: navbar, from: 'prerendered: Astro.isPrerendered', to: 'prerendered: false', tests: NAVBAR },
  { name: 'the session is asked of an /api the apex does not have', file: session, from: "'/portal/api/auth/get-session'", to: "'/api/auth/session'", tests: NAVBAR },
  { name: 'the two copies of cachedJson drift apart', file: session, from: 'if (Date.now() - at < ttl(v)) return v;', to: 'if (Date.now() - at <= ttl(v)) return v;', tests: NAVBAR },
  { name: 'a signed-in student is sent to /admin', file: session, from: "a.href = admin ? '/admin' : '/portal';", to: "a.href = '/admin';", tests: NAVBAR },

  // ---- SAKEM-105: the reports are a section of /donasi (the menu, the footer, the anchor, the redirect, the sitemap)
  { name: 'Laporan is back in the menu (it has five items since SAKEM-105)', file: site, from: NAV_TAIL, to: "  { href: '/donasi', label: 'Donasi' },\n  { href: '/laporan', label: 'Laporan' },\n  { href: '/blog', label: 'Blog' },\n];", tests: REPORTS },
  { name: 'the footer\'s Laporan points at the page that is gone', file: site, from: "{ href: REPORTS_SECTION_PATH, label: 'Laporan' },", to: "{ href: '/laporan', label: 'Laporan' },", tests: REPORTS },
  { name: 'the footer loses its Laporan link', file: site, from: FOOTER_REPORTS, to: '', tests: REPORTS },
  { name: 'the footer\'s Laporan moves after Blog (it keeps its place between Donasi and Blog)', file: site, from: FOOTER_REPORTS + "  { href: '/blog', label: 'Blog' },\n", to: "  { href: '/blog', label: 'Blog' },\n" + FOOTER_REPORTS, tests: REPORTS },
  { name: 'the address of the reports names another anchor than the section\'s id', file: site, from: "export const REPORTS_SECTION_PATH = '/donasi#laporan';", to: "export const REPORTS_SECTION_PATH = '/donasi#reports';", tests: REPORTS },
  { name: 'the section has no id (the address /donasi#laporan lands on nothing)', file: reportsSection, from: '<section id="laporan" class="scroll-mt-24 ', to: '<section class="scroll-mt-24 ', tests: REPORTS },
  { name: 'the section has another id than the address says', file: reportsSection, from: '<section id="laporan" class="scroll-mt-24 ', to: '<section id="reports" class="scroll-mt-24 ', tests: REPORTS },
  { name: 'the anchor does not clear the fixed navbar (the heading would sit under it)', file: reportsSection, from: '<section id="laporan" class="scroll-mt-24 ', to: '<section id="laporan" class="', tests: REPORTS },
  { name: '/donasi does not show the section', file: donasiPage, from: '    <ReportsSection section={reports} uploadsBase={env.UPLOADS_BASE_URL} />\n', to: '', tests: REPORTS },
  { name: '/donasi is a static file again (it could not carry the reports)', file: donasiPage, from: 'export const prerender = false;', to: 'export const prerender = true;', tests: REPORTS },
  { name: 'the section\'s failure panel is shown for an empty list (null is the failure, [] is the legacy empty state)', file: reportsSection, from: 'reports === null ? (', to: 'total === 0 ? (', tests: REPORTS },
  { name: '/laporan is not redirected any more (a dead address of the old site and of every external link)', file: redirects, from: "  '/laporan': to('/donasi#laporan'),\n", to: '', tests: REPORTS_REDIRECT },
  { name: '/laporan loses the fragment (the visitor lands at the top of Donasi)', file: redirects, from: "  '/laporan': to('/donasi#laporan'),", to: "  '/laporan': to('/donasi'),", tests: REPORTS_REDIRECT },
  { name: '/laporan is a temporary redirect (a 307 that no browser or search engine keeps)', file: redirects, from: "  '/laporan': to('/donasi#laporan'),", to: "  '/laporan': to('/donasi#laporan', TEMPORARY),", tests: REPORTS_REDIRECT },
  { name: '/impact-reports goes to /laporan again (two hops)', file: redirects, from: "  '/impact-reports': to('/donasi#laporan'),", to: "  '/impact-reports': to('/laporan'),", tests: REPORTS_REDIRECT },
  { name: 'the Worker\'s redirect puts the carried query AFTER the fragment (it would become part of the fragment and be lost)', file: redirects, from: FRAGMENT_QUERY, to: 'location += search;', tests: REPORTS_REDIRECT },
  { name: 'the sitemap lists /laporan again (a redirect is not a sitemap URL)', file: sitemapLib, from: "  { path: '/donasi', priority: 0.9, changeFrequency: 'monthly' },\n", to: "  { path: '/donasi', priority: 0.9, changeFrequency: 'monthly' },\n  { path: '/laporan', priority: 0.85, changeFrequency: 'monthly' },\n", tests: SITEMAP },
  { name: 'the sitemap loses /donasi', file: sitemapLib, from: "  { path: '/donasi', priority: 0.9, changeFrequency: 'monthly' },\n", to: '', tests: SITEMAP },

  // ---- the staging deploy-command printer
  { name: 'the printer accepts any value for PORTAL_ENABLED', file: printer, from: "if (value !== 'true' && value !== 'false') throw new Error(`${where}: exactly true or false`);", to: '', tests: PRINTER },
  { name: 'the admin Worker accepts the site\'s PORTAL_ENABLED', file: printer, from: "allowed: ['TURNSTILE_SITE_KEY', 'UPLOADS_BASE_URL', 'SITE_URL', 'EMAIL_FROM'],", to: "allowed: ['TURNSTILE_SITE_KEY', 'UPLOADS_BASE_URL', 'SITE_URL', 'EMAIL_FROM', 'PORTAL_ENABLED'],", tests: PRINTER },
  { name: 'the printer stops telling the owner about the build\'s shell for PORTAL_ENABLED', file: printer, from: "if (worker === 'web' && entries.some((e) => e.name === 'PORTAL_ENABLED')) {", to: 'if (false) {', tests: PRINTER },

  // ---- the WordPress pass-through
  { name: 'matching is loose: /wp-adminx and /login-help look like WordPress', file: paths, from: 'pathname === prefix || pathname.startsWith(`${prefix}/`);', to: 'pathname.startsWith(prefix);', tests: PATHS },
  { name: 'an exact entry matches what is below it (/login/x, /xmlrpc.php/x)', file: paths, from: "entry.match === 'exact' ? pathname === entry.path || pathname === `${entry.path}/` : matches(pathname, entry.path);", to: 'matches(pathname, entry.path);', tests: PATHS },
  { name: 'an exact entry tolerates any number of trailing slashes', file: paths, from: 'pathname === `${entry.path}/` :', to: 'pathname.startsWith(`${entry.path}/`) :', tests: PATHS },
  { name: '/login stops being an exact entry (it becomes a prefix)', file: paths, from: "{ path: '/login', match: 'exact', why:", to: "{ path: '/login', why:", tests: PATHS },
  { name: '/xmlrpc.php leaves the list', file: paths, from: "  { path: '/xmlrpc.php', match: 'exact', why: 'The WordPress XML-RPC endpoint (the mobile apps and pingbacks of the old site).' },\n", to: '', tests: PATHS },
  { name: '/wp-content is misspelled in the list', file: paths, from: "    path: '/wp-content',", to: "    path: '/wp-contents',", tests: PATHS },
  { name: 'a page of the new site (/blog) is on the forwarded list', file: paths, from: LIST_HEAD, to: `${LIST_HEAD}  { path: '/blog', why: 'a page of the new site that must never reach the origin, 40 characters' },\n`, tests: PATHS },
  { name: 'the old Next static prefix /images is forwarded again', file: paths, from: LIST_HEAD, to: `${LIST_HEAD}  { path: '/images', why: 'the old Next static files that no origin serves any more, 40 chars' },\n`, tests: PATHS },
  { name: 'the middleware stops forwarding (the list decides nothing)', file: middleware, from: 'if (isLegacyPath(pathname)) {\n    return forwardToLegacy', to: 'if (false) {\n    return forwardToLegacy', tests: PATHS },
  { name: 'the middleware adds the security headers to an origin answer', file: middleware, from: 'return forwardToLegacy(context.request, env.LEGACY_ORIGIN_URL);', to: 'return withSecurityHeaders(await forwardToLegacy(context.request, env.LEGACY_ORIGIN_URL));', tests: PATHS },

  // ---- the redirect table: nothing may shadow the pass-through, and /daftar is not a rule
  { name: '/daftar is a redirect rule again (the shortlink would never be reached)', file: redirects, from: REDIRECT_ANCHOR, to: `${REDIRECT_ANCHOR}  '/daftar': to('/gabung-siswa'),\n`, tests: REDIRECTS },
  { name: '/apply is a redirect rule again (a custom shortlink called apply would never be reached; SAKEM-107)', file: redirects, from: REDIRECT_ANCHOR, to: `${REDIRECT_ANCHOR}  '/apply': to('/gabung-siswa'),\n`, tests: REDIRECTS },
  { name: '/login is a redirect into the portal again (WordPress would never see it)', file: redirects, from: REDIRECT_ANCHOR, to: `${REDIRECT_ANCHOR}  '/login': to('/portal/login'),\n`, tests: REDIRECTS },
  { name: '/register is a redirect into the portal again', file: redirects, from: REDIRECT_ANCHOR, to: `${REDIRECT_ANCHOR}  '/register': to('/portal/register'),\n`, tests: REDIRECTS },
  { name: 'the old registration form goes to /portal/daftar again', file: redirects, from: "'/gabung-siswa/form': to('/daftar'),", to: "'/gabung-siswa/form': to('/portal/daftar'),", tests: REDIRECTS },
  { name: 'the splat over /wp-content/uploads is back (an upload this site did not copy would be sent to a 404)', file: redirects, from: REDIRECT_ANCHOR, to: `${REDIRECT_ANCHOR}  '/wp-content/uploads/[...path]': to('/blog/images/[...path]'),\n`, tests: REDIRECTS },

  // ---- the WordPress uploads this build copied
  { name: 'an @ in an upload name is not written in its %40 form (two hops again)', file: redirects, from: 'to: assetUrl(`/${file}`) }))', to: 'to: `/${file}` }))', tests: REDIRECTS },
  { name: 'a folder of blog/images gets a rule too', file: redirects, from: '/[^/]\\.[A-Za-z0-9]+$/.test(file.slice(PREFIX.length))', to: '/./.test(file.slice(PREFIX.length))', tests: REDIRECTS },
  { name: 'the upload rules are written after the dynamic ones (the file is ordered the way wrangler warns about)', file: redirects, from: '  staticEntries.forEach(emit);\n', to: '  staticEntries.forEach(emit);\n  dynamicEntries.forEach(emit);\n', tests: REDIRECTS },

  // ---- reserved names
  { name: '`daftar` is reserved by the admin again (the registration link could not be created)', file: adminReserved, from: '  "tentang-kami",\n', to: '  "tentang-kami",\n  "daftar",\n', tests: RESERVED },
  { name: '`apply` is reserved by the admin again (a custom link called apply could not be created; SAKEM-107)', file: adminReserved, from: '  "tentang-kami",\n', to: '  "tentang-kami",\n  "apply",\n', tests: RESERVED },
  { name: 'a WordPress path (wp-json) is no longer reserved', file: adminReserved, from: '  "wp-json",\n', to: '', tests: RESERVED },
  { name: 'wp-admin is no longer reserved', file: adminReserved, from: '  "wp-admin",\n', to: '', tests: RESERVED },

  // ---- the volunteer link (SAKEM-107)
  { name: 'the volunteer button points at the Linktree again (the form is no longer behind /apply)', file: 'src/pages/tim.astro', from: '<Button href={VOLUNTEER_PATH} size="lg">', to: '<Button href="https://linktr.ee/JoinSakolaKembara" size="lg">', tests: VOLUNTEER },
  { name: 'the volunteer link is renamed (the button would point at a name nobody made a shortlink of)', file: site, from: "export const VOLUNTEER_PATH = '/apply';", to: "export const VOLUNTEER_PATH = '/relawan';", tests: VOLUNTEER },

  // ---- the registration link and its polite page
  { name: 'the registration link is renamed (every Daftar Sekarang would point at another name)', file: site, from: "export const REGISTRATION_PATH = '/daftar';", to: "export const REGISTRATION_PATH = '/pendaftaran';", tests: REGISTRATION },
  { name: 'the hero button of /gabung-siswa points at /portal/daftar again', file: 'src/pages/gabung-siswa.astro', from: '<div class="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3">\n            <Button href={REGISTRATION_PATH}', to: '<div class="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3">\n            <Button href="/portal/daftar"', tests: REGISTRATION },
  { name: 'the home page\'s student card points at /gabung-siswa again', file: 'src/components/sections/CTASection.astro', from: '    href: REGISTRATION_PATH,', to: "    href: '/gabung-siswa',", tests: REGISTRATION },
  { name: 'the "formulir pendaftaran" link of the documents page points at /portal/daftar again', file: 'src/pages/gabung-siswa/docs.astro', from: '<a href={REGISTRATION_PATH} class="underline', to: '<a href="/portal/daftar" class="underline', tests: REGISTRATION },
  { name: 'every unknown link gets the registration page (the flag is always on)', file: catchAll, from: 'registrationUnavailable = slug === REGISTRATION_SLUG;', to: 'registrationUnavailable = true;', tests: REGISTRATION },
  { name: 'the registration link never gets its page (the flag is never set)', file: catchAll, from: 'registrationUnavailable = slug === REGISTRATION_SLUG;', to: 'registrationUnavailable = false;', tests: REGISTRATION },
  { name: 'the polite page is a 200 (a soft 404, and a closed form that looks open to a monitor)', file: catchAll, from: 'Astro.response.status = 404;\n', to: 'Astro.response.status = 200;\n', tests: REGISTRATION },
  { name: 'the polite page may be cached (the link would stay "closed" after an admin creates it)', file: catchAll, from: "if (registrationUnavailable) Astro.response.headers.set('cache-control', 'no-store');", to: '', tests: REGISTRATION },
  { name: 'names WordPress owns are looked up as shortlinks (a wasted D1 read per /WP-ADMIN)', file: catchAll, from: ' && !isLegacyPath(`/${slug}`)', to: '', tests: REGISTRATION },
  { name: 'the polite page says the form is closed for good (not the sentence that was approved)', file: polite, from: 'Saat ini formulir pendaftaran belum dapat dibuka.', to: 'Pendaftaran sudah ditutup.', tests: REGISTRATION },
  { name: 'the polite page is indexable (a page head instead of the 404\'s)', file: polite, from: "<Base seo={{ kind: 'notfound', title: 'Formulir pendaftaran belum tersedia' }}>", to: "<Base seo={{ kind: 'page', title: 'Formulir pendaftaran belum tersedia', description: 'x', path: '/daftar' }}>", tests: REGISTRATION },

  // ---- the staged HSTS
  { name: 'HSTS carries includeSubDomains again (the middleware list)', file: securityHeaders, from: "'Strict-Transport-Security': 'max-age=300',", to: "'Strict-Transport-Security': 'max-age=300; includeSubDomains',", tests: HEADERS },
  { name: 'HSTS carries preload again (the middleware list)', file: securityHeaders, from: "'Strict-Transport-Security': 'max-age=300',", to: "'Strict-Transport-Security': 'max-age=300; preload',", tests: HEADERS },
  { name: 'HSTS is back to a year (the middleware list)', file: securityHeaders, from: "'Strict-Transport-Security': 'max-age=300',", to: "'Strict-Transport-Security': 'max-age=31536000',", tests: HEADERS },
  { name: 'HSTS is back to the Caddyfile\'s value in public/_headers (the assets)', file: headersFile, from: '  Strict-Transport-Security: max-age=300\n', to: '  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload\n', tests: HEADERS },
  { name: 'HSTS carries includeSubDomains in public/_headers (the assets)', file: headersFile, from: '  Strict-Transport-Security: max-age=300\n', to: '  Strict-Transport-Security: max-age=300; includeSubDomains\n', tests: HEADERS },
];

let bad = 0;
for (const check of checks) {
  const original = readFileSync(check.file, 'utf8');
  const found = original.split(check.from).length - 1;
  if (found !== 1) {
    console.log(`FAIL  ${check.name}: pattern found ${found} times in ${check.file}, expected exactly once`);
    bad++;
    continue;
  }
  try {
    writeFileSync(check.file, original.replace(check.from, () => check.to));
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...check.tests], { encoding: 'utf8' });
    const failed = (run.stdout + run.stderr).match(/Tests\s+(\d+) failed/);
    if (run.status !== 0 && failed) console.log(`OK    ${check.name}: ${failed[1]} test(s) failed as they should`);
    else {
      console.log(`FAIL  ${check.name}: tests still pass (exit ${run.status})`);
      bad++;
    }
  } finally {
    writeFileSync(check.file, original);
  }
}
console.log(bad === 0 ? `\nAll ${checks.length} safeguards are covered by tests.` : `\n${bad} of ${checks.length} checks did not behave.`);
process.exit(bad === 0 ? 0 : 1);
