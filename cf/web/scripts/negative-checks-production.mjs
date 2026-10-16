// Proves the tests of the Phase A tooling are not vacuous (SAKEM-104): each check breaks ONE safeguard in
// cf/scripts/production-deploy-command.mjs, cf/scripts/production-dry-run.mjs, cf/scripts/check-production-site.mjs,
// cf/scripts/check-zone-export.mjs, a wrangler file, package.json or .gitignore, runs the tests that must notice, expects
// them to FAIL, and always restores the file.
//
//   node scripts/negative-checks-production.mjs                       (pnpm test:negative:production)
//   node scripts/negative-checks-production.mjs --only "checker:"     only the checks whose name contains the text
//   node scripts/negative-checks-production.mjs --patterns-only       only prove that every pattern is found exactly once (no test is run)
//
// Run it on a clean tree. A pattern found other than exactly once is reported as FAIL and nothing is written, so a refactor
// that moves the code cannot silently turn a check into a no-op; the replacement goes in as a function (a `$&` in it is text).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
process.chdir(webRoot);

const PRINTER = '../scripts/production-deploy-command.mjs';
const DRY_RUN = '../scripts/production-dry-run.mjs';
const CHECKER = '../scripts/check-production-site.mjs';
const ZONE = '../scripts/check-zone-export.mjs';
const SCRIPTS = 'tests/production-scripts.test.ts';
const CHECK = 'tests/production-check.test.ts';
const ZONE_TESTS = 'tests/zone-export.test.ts';

const checks = [
  // ---------------------------------------------------------------- the printer: names
  { name: 'printer: a secret name is no longer refused', file: PRINTER, from: '[/^BETTER_AUTH_SECRET$|SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE|^GOOGLE_CLIENT_/i, ', to: '[/^NO_SUCH_NAME$/, ', tests: SCRIPTS },
  { name: 'printer: Google sign-in key names are no longer treated as secrets', file: PRINTER, from: '|PRIVATE|^GOOGLE_CLIENT_/i', to: '|PRIVATE/i', tests: SCRIPTS },
  { name: 'printer: an API URL is no longer refused', file: PRINTER, from: '[/^(CONTENT_API_URL|CONTACT_API_URL)$/, ', to: '[/^NO_SUCH_NAME$/, ', tests: SCRIPTS },
  { name: 'printer: the legacy origin is no longer refused with its reason', file: PRINTER, from: '[/^LEGACY_ORIGIN_URL$/, ', to: '[/^NO_SUCH_NAME$/, ', tests: SCRIPTS },
  { name: 'printer: ENVIRONMENT may be passed', file: PRINTER, from: '[/^ENVIRONMENT$/, ', to: '[/^NO_SUCH_NAME$/, ', tests: SCRIPTS },
  { name: 'printer: the cookie settings may be passed', file: PRINTER, from: '[/^COOKIE_DOMAIN$|^TRUSTED_ORIGINS$/, ', to: '[/^NO_SUCH_NAME$/, ', tests: SCRIPTS },
  { name: "printer: the portal's two public values may be passed", file: PRINTER, from: '[/^PORTAL_(CONTACT_WHATSAPP|WHATSAPP_GROUP_URL)$/, ', to: '[/^NO_SUCH_NAME$/, ', tests: SCRIPTS },
  { name: 'printer: the fixed settings may be passed', file: PRINTER, from: '[/^PRIVATE_FILES_BUDGET_BYTES$|^AUDIT_RETENTION_DAYS$|', to: '[/^PRIVATE_FILES_BUDGET_BYTES_X$|', tests: SCRIPTS },
  { name: "printer: the admin's list holds the site's ADMIN_URL", file: PRINTER, from: "    { name: 'EMAIL_FROM', required: false, kind: 'email-from' },\n", to: "    { name: 'EMAIL_FROM', required: false, kind: 'email-from' },\n    { name: 'ADMIN_URL', required: false, kind: 'origin' },\n", tests: SCRIPTS },
  { name: 'printer: a variable that belongs to another Worker is no longer classified (the coverage of the environment declarations)', file: PRINTER, from: "({ admin: ['ADMIN_URL'], web: [] });", to: '({ admin: [], web: [] });', tests: SCRIPTS },

  // ---------------------------------------------------------------- the printer: values
  { name: 'printer: an empty value is accepted', file: PRINTER, from: "    if (value === '') throw new Error(", to: '    if (false) throw new Error(', tests: SCRIPTS },
  { name: 'printer: a placeholder is accepted', file: PRINTER, from: "    if (/\\.\\.\\.|REPLACE|CHANGEME|placeholder/i.test(value) || (spec.kind !== 'email-from' && /[<>]/.test(value))) {", to: '    if (false) {', tests: SCRIPTS },
  { name: 'printer: a character that does not belong in a public value is accepted', file: PRINTER, from: '    if (/[\\n\\r`$\\\\]/.test(value)) throw new Error(', to: '    if (false) throw new Error(', tests: SCRIPTS },
  { name: 'printer: a staging-looking value is accepted', file: PRINTER, from: '    if (STAGING_LOOK.test(value)) throw new Error(', to: '    if (false) throw new Error(', tests: SCRIPTS },
  { name: 'printer: workers.dev and r2.dev are no longer recognised as staging', file: PRINTER, from: 'const STAGING_LOOK = /workers\\.dev|r2\\.dev|staging|', to: 'const STAGING_LOOK = /staging|', tests: SCRIPTS },
  { name: 'printer: the resend.dev sender is no longer recognised as staging', file: PRINTER, from: '|resend\\.dev|', to: '|', tests: SCRIPTS },
  { name: "printer: Cloudflare's always-pass Turnstile test keys are accepted", file: PRINTER, from: '    if (TURNSTILE_TEST_KEY.test(value)) throw new Error(', to: '    if (false) throw new Error(', tests: SCRIPTS },
  { name: 'printer: an http origin is accepted', file: PRINTER, from: "      if (url.protocol !== 'https:') return 'must be an https origin';\n", to: '', tests: SCRIPTS },
  { name: 'printer: an origin with a path, a trailing slash, a query or credentials is accepted', file: PRINTER, from: "      if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || value.endsWith('/')) {", to: '      if (false) {', tests: SCRIPTS },
  { name: 'printer: an origin may be any host (not the host of its role)', file: PRINTER, from: '      if (value !== PRODUCTION_ORIGINS[name]) return', to: '      if (false) return', tests: SCRIPTS },
  { name: 'printer: the admin host of the plan is another host', file: PRINTER, from: "  ADMIN_URL: 'https://admin.sakolakembara.org',", to: "  ADMIN_URL: 'https://www.sakolakembara.org',", tests: SCRIPTS },
  { name: 'printer: the sender may be on any domain', file: PRINTER, from: 'return host === MAIL_DOMAIN || host.endsWith(`.${MAIL_DOMAIN}`) ? null :', to: 'return true ? null :', tests: SCRIPTS },
  { name: 'printer: the beacon id may be any text', file: PRINTER, from: "      return /^[0-9a-fA-F]{32}$/.test(value) ? null : 'not a Web Analytics beacon id", to: "      return /./.test(value) ? null : 'not a Web Analytics beacon id", tests: SCRIPTS },
  { name: 'printer: the page copy may be 0 seconds (off)', file: PRINTER, from: "{ name: 'PAGE_CACHE_SECONDS', required: true, kind: 'seconds', min: 1, max: 120 },", to: "{ name: 'PAGE_CACHE_SECONDS', required: true, kind: 'seconds', min: 0, max: 120 },", tests: SCRIPTS },
  { name: 'printer: the page copy is no longer required', file: PRINTER, from: "{ name: 'PAGE_CACHE_SECONDS', required: true,", to: "{ name: 'PAGE_CACHE_SECONDS', required: false,", tests: SCRIPTS },
  { name: 'printer: the beacon id is no longer required', file: PRINTER, from: "{ name: 'WEB_ANALYTICS_BEACON_ID', required: true,", to: "{ name: 'WEB_ANALYTICS_BEACON_ID', required: false,", tests: SCRIPTS },
  { name: 'printer: a required value that is missing is not reported', file: PRINTER, from: 'spec.required && !entries.some((e) => e.name === spec.name)).map((spec) => spec.name);\n}', to: 'false && !entries.some((e) => e.name === spec.name)).map((spec) => spec.name);\n}', tests: SCRIPTS },
  { name: 'printer: a file with a missing required value still prints', file: PRINTER, from: '    if (missing.length > 0) throw new Error(', to: '    if (false) throw new Error(', tests: SCRIPTS },
  { name: 'printer: a name set twice is accepted', file: PRINTER, from: '    if (seen.has(name)) throw new Error(', to: '    if (false) throw new Error(', tests: SCRIPTS },

  // ---------------------------------------------------------------- the printer: the command and the shell
  { name: 'printer: it prints while CLOUDFLARE_ENV is set', file: PRINTER, from: '  if (process.env.CLOUDFLARE_ENV) {', to: '  if (false) {', tests: SCRIPTS },
  { name: 'printer: the admin command does not select the top level (a CLOUDFLARE_ENV left in the shell would decide)', file: PRINTER, from: "deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '--env=\"\"'],", to: "deploy: ['pnpm', 'exec', 'wrangler', 'deploy'],", tests: SCRIPTS },
  { name: 'printer: a value is not quoted for the shell', file: PRINTER, from: "['--var', shellQuote(`${name}:${value}`)]", to: "['--var', `${name}:${value}`]", tests: SCRIPTS },
  { name: 'printer: the production build line is the plain build (a CLOUDFLARE_ENV left in the shell would decide)', file: PRINTER, from: "    before: 'pnpm build:prod',", to: "    before: 'pnpm build',", tests: SCRIPTS },
  { name: 'printer: a dist/ that is not the production site is accepted', file: PRINTER, from: '  if (config.name !== WORKERS.web.name) problems.push(', to: '  if (false) problems.push(', tests: SCRIPTS },
  { name: 'printer: a dist/ bound to another admin Worker is accepted', file: PRINTER, from: '  if (services !== JSON.stringify(', to: '  if (false && services !== JSON.stringify(', tests: SCRIPTS },
  { name: 'printer: a dist/ that carries variables is accepted', file: PRINTER, from: '  if (Object.keys(config.vars ?? {}).length > 0) problems.push(', to: '  if (false) problems.push(', tests: SCRIPTS },
  { name: 'printer: a dist/ with workers.dev on is accepted', file: PRINTER, from: '  if (config.workers_dev !== false) problems.push(', to: '  if (false) problems.push(', tests: SCRIPTS },
  { name: 'printer: a dist/ built without the beacon id is accepted', file: PRINTER, from: '  if (tags.length === 0) return [', to: '  if (false) return [', tests: SCRIPTS },
  { name: 'printer: a dist/ built with another beacon id is accepted', file: PRINTER, from: '  if (!tags[0].includes(', to: '  if (false && !tags[0].includes(', tests: SCRIPTS },
  { name: 'printer: a dist/ with two beacon tags is accepted', file: PRINTER, from: '  if (tags.length > 1) return [', to: '  if (false) return [', tests: SCRIPTS },
  { name: 'printer: the site is deployed from anything but the built config', file: PRINTER, from: "deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '-c', 'dist/server/wrangler.json'],", to: "deploy: ['pnpm', 'exec', 'wrangler', 'deploy'],", tests: SCRIPTS },

  { name: 'printer: PORTAL_ENABLED=true is accepted in Phase A', file: PRINTER, from: '      if (value === \'true\') return \'refused in Phase A:', to: '      if (false) return \'refused in Phase A:', tests: SCRIPTS },
  { name: 'printer: PORTAL_ENABLED may be any text', file: PRINTER, from: '      return value === \'false\' ? null : \'exactly true or false\';', to: '      return null;', tests: SCRIPTS },
  { name: 'printer: the build line carries the beacon id only (PORTAL_ENABLED is left out of it)', file: PRINTER, from: '[\'WEB_ANALYTICS_BEACON_ID\', \'PORTAL_ENABLED\']\n', to: '[\'WEB_ANALYTICS_BEACON_ID\']\n', tests: SCRIPTS },
  { name: 'printer: the build line carries the portal switch only (the beacon id is left out of it)', file: PRINTER, from: '[\'WEB_ANALYTICS_BEACON_ID\', \'PORTAL_ENABLED\']\n', to: '[\'PORTAL_ENABLED\']\n', tests: SCRIPTS },
  { name: 'printer: a dist/ whose home page offers the portal is accepted', file: PRINTER, from: '  if (!enabled && (hasSession || hasLink)) return [', to: '  if (false) return [', tests: SCRIPTS },
  { name: 'printer: a dist/ without the portal is accepted when the file says true', file: PRINTER, from: '  if (enabled && !(hasSession && hasLink)) return [', to: '  if (false) return [', tests: SCRIPTS },
  { name: 'printer: the portal switch of dist/ is not compared with the file', file: PRINTER, from: '    problems.push(...builtPortalProblems(html, portalOn).map(', to: '    problems.push(...[].map(', tests: SCRIPTS },

  // ---------------------------------------------------------------- the dry run
  { name: 'dry run: the admin dry run selects no top level (a CLOUDFLARE_ENV would decide)', file: DRY_RUN, from: "args: ['deploy', '--dry-run', '--env=', '--outdir', 'dist/worker-production'],", to: "args: ['deploy', '--dry-run', '--outdir', 'dist/worker-production'],", tests: SCRIPTS },
  { name: 'dry run: the word staging is allowed in a production listing', file: DRY_RUN, from: "const NEVER_IN_PRODUCTION = ['staging', ", to: 'const NEVER_IN_PRODUCTION = [', tests: SCRIPTS },
  { name: 'dry run: a variable that must stay unset may appear', file: DRY_RUN, from: "'env.CONTENT_API_URL', 'env.CONTACT_API_URL', 'env.LEGACY_ORIGIN_URL', ", to: '', tests: SCRIPTS },
  { name: 'dry run: the child keeps the CLOUDFLARE_ENV of the shell', file: DRY_RUN, from: '  delete env.CLOUDFLARE_ENV;\n', to: '', tests: SCRIPTS },
  { name: "dry run: the paths wrangler prints are read as well as the listing", file: DRY_RUN, from: '    .filter((line) => /^\\s*(env\\.|Total Upload)/.test(line))', to: '    .filter(() => true)', tests: SCRIPTS },
  { name: 'dry run: the private bucket is no longer required in the bundle', file: DRY_RUN, from: "      'env.PRIVATE_FILES (sakem-private)',\n", to: '', tests: SCRIPTS },
  { name: "dry run: the site's service binding is no longer required", file: DRY_RUN, from: "mustContain: ['env.API (sakem-admin#PublicApi)', 'env.ASSETS'],", to: "mustContain: ['env.ASSETS'],", tests: SCRIPTS },
  { name: 'dry run: the production Worker name is the staging one', file: DRY_RUN, from: "    workerName: 'sakola-kembara-web',", to: "    workerName: 'sakem-web-staging',", tests: SCRIPTS },

  // ---------------------------------------------------------------- the wrangler files, package.json, the ignore file
  { name: 'config: the production site Worker is on workers.dev again', file: 'wrangler.jsonc', from: '  "workers_dev": false,', to: '  "workers_dev": true,', tests: SCRIPTS },
  { name: 'config: the production admin Worker is on workers.dev again', file: '../admin/wrangler.jsonc', from: '  "workers_dev": false,', to: '  "workers_dev": true,', tests: SCRIPTS },
  { name: 'config: the production site Worker has per-version preview hosts', file: 'wrangler.jsonc', from: '  "preview_urls": false,\n\n  // The API Worker', to: '  "preview_urls": true,\n\n  // The API Worker', tests: SCRIPTS },
  { name: 'package: the production build does not unset CLOUDFLARE_ENV', file: 'package.json', from: '"build:prod": "env -u CLOUDFLARE_ENV pnpm build",', to: '"build:prod": "pnpm build",', tests: SCRIPTS },
  { name: 'ignore: the production vars file is no longer ignored', file: '../../.gitignore', from: 'cf/**/.production.vars*\n', to: '', tests: SCRIPTS },

  // ---------------------------------------------------------------- the checker
  { name: 'checker: the pause between requests can be lowered', file: CHECKER, from: '  if (!Number.isFinite(delayMs) || delayMs < MIN_DELAY_MS) throw new RangeError(', to: '  if (false) throw new RangeError(', tests: CHECK },
  { name: 'checker: the pause is not kept', file: CHECKER, from: '      if (wait > 0) await sleep(wait);\n', to: '', tests: CHECK },
  { name: 'checker: a host outside the four is asked', file: CHECKER, from: '    if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) throw new RefusedHost(', to: '    if (false) throw new RefusedHost(', tests: CHECK },
  { name: 'checker: a port or credentials are accepted', file: CHECKER, from: '    if (target.username || target.password || target.port) throw new RefusedHost(', to: '    if (false) throw new RefusedHost(', tests: CHECK },
  { name: 'checker: a redirect is followed', file: CHECKER, from: "        redirect: 'manual',", to: "        redirect: 'follow',", tests: CHECK },
  { name: 'checker: credentials are sent', file: CHECKER, from: "        credentials: 'omit',", to: "        credentials: 'include',", tests: CHECK },
  { name: 'checker: it sends another method than GET', file: CHECKER, from: "        method: 'GET',", to: "        method: 'HEAD',", tests: CHECK },
  { name: 'checker: it sends without --allow-network', file: CHECKER, from: '  if (!options.allowNetwork) {', to: '  if (false) {', tests: CHECK },
  { name: 'checker: an unknown group is accepted', file: CHECKER, from: '        for (const g of groups) if (!Object.hasOwn(HOSTS, g)) throw new UsageError(', to: '        for (const g of groups) if (false) throw new UsageError(', tests: CHECK },
  { name: 'checker: a failed check still exits 0', file: CHECKER, from: '  return summarize(results).fail > 0 ? 1 : 0;', to: '  return 0;', tests: CHECK },
  { name: 'checker: a run where nothing answered exits 0', file: CHECKER, from: '    return 3;\n', to: '    return 0;\n', tests: CHECK },
  { name: 'checker: a wrong HSTS value is accepted', file: CHECKER, from: '        else if (hsts !== EXPECT.hsts) sec.push(', to: '        else if (false) sec.push(', tests: CHECK },
  { name: 'checker: the PHP header is no longer an old-stack header', file: CHECKER, from: "    if (name === 'x-powered-by' && /php|wordpress/i.test(value)) hits.push(name);", to: '    if (false) hits.push(name);', tests: CHECK },
  { name: "checker: the LiteSpeed 'server' header is no longer an old-stack header", file: CHECKER, from: "    else if (name === 'server' && !/^cloudflare$/i.test(value.trim())) hits.push(name);", to: '    else if (false) hits.push(name);', tests: CHECK },
  { name: 'checker: a WordPress cookie is no longer an old-stack header', file: CHECKER, from: "    else if (name === 'set-cookie' && /(^|\\n)\\s*(wordpress_|wp-settings|wp_|phpsessid|comment_author)/i.test(value)) hits.push(name);", to: '    else if (false) hits.push(name);', tests: CHECK },
  { name: 'checker: a header named with --legacy-header is ignored', file: CHECKER, from: '      const rule = extra.find((candidate) => candidate.name === name);', to: '      const rule = undefined;', tests: CHECK },
  { name: 'checker: an old-stack header on a new-site path is a pass', file: CHECKER, from: "    else add('TA-04', 'FAIL',", to: "    else add('TA-04', 'PASS',", tests: CHECK },
  { name: 'checker: a cookie on the home page is accepted', file: CHECKER, from: "        if (home.headers['set-cookie']) problems.push('a cookie is set');", to: '', tests: CHECK },
  { name: 'checker: the sitemap may be short', file: CHECKER, from: '        if (locs.length < minSitemapUrls) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: an image on r2.dev is accepted in an article', file: CHECKER, from: '        const bad = images.filter((host) => /(^|\\.)(r2\\.dev|workers\\.dev)$/.test(host));', to: '        const bad = [];', tests: CHECK },
  { name: 'checker: www may redirect with any status', file: CHECKER, from: '    expectRedirect(www, [301], ', to: '    expectRedirect(www, [301, 302, 307, 308], ', tests: CHECK },
  { name: 'checker: /daftar may be the old 308', file: CHECKER, from: '        if (daftar.status !== 307) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: the admin config may name another files host', file: CHECKER, from: '          if (json.uploadsBaseUrl !== `https://${HOSTS.files}`) problems.push(', to: '          if (false) problems.push(', tests: CHECK },
  { name: "checker: Cloudflare's Turnstile test key is accepted on the admin host", file: CHECKER, from: '          else if (/^[1-9]x0{4,}/i.test(key)) problems.push(', to: '          else if (false) problems.push(', tests: CHECK },
  { name: 'checker: the admin may answer /api/me with something else than 401', file: CHECKER, from: '        if (me.status !== 401) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: the admin app sending no frame header is no longer said', file: CHECKER, from: "      if (missing.length > 0) add('TA-05', 'WARN',", to: "      if (false) add('TA-05', 'WARN',", tests: CHECK },
  { name: 'checker: a bucket that lists its objects is accepted', file: CHECKER, from: '        if (/<ListBucketResult|<Contents>/i.test(root.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: an uploaded file without the immutable cache-control is accepted', file: CHECKER, from: "        if (file.headers['cache-control'] !== EXPECT.immutable) problems.push(", to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: the blog cache-control is not compared', file: CHECKER, from: "        if (blog.headers['cache-control'] !== EXPECT.blogCacheControl) problems.push(", to: '        if (false) problems.push(', tests: CHECK },

  { name: 'checker: an unknown path or a look-alike that answers 200 is accepted', file: CHECKER, from: '    if (answer.status !== 404) problems.push(`status ${answer.status}, expected 404`);', to: '    if (false) problems.push(`status ${answer.status}, expected 404`);', tests: CHECK },
  { name: 'checker: a 404 without noindex is accepted', file: CHECKER, from: '    else if (!hasNoindex(answer.body)) problems.push(', to: '    else if (false) problems.push(', tests: CHECK },
  { name: 'checker: WordPress\'s own 404 passes for the new site\'s', file: CHECKER, from: '    if (looksLikeWordPress(answer.body) || legacyHeaders(answer.headers, legacy).length > 0) problems.push(\'the old origin answered\');', to: '    if (false) problems.push(\'the old origin answered\');', tests: CHECK },
  { name: 'checker: the new site\'s 404 passes for WordPress\'s login', file: CHECKER, from: '[\'/wp-login.php\', wpLogin, (a, problems) => {\n        if (a.status !== 200) problems.push(', to: '[\'/wp-login.php\', wpLogin, (a, problems) => {\n        if (false) problems.push(', tests: CHECK },
  { name: 'checker: a JSON that is not WordPress\'s /wp-json/ is accepted', file: CHECKER, from: '        if (!/json/i.test(a.headers[\'content-type\'] ?? \'\')) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: a WordPress path answered with the Worker\'s own HSTS is accepted', file: CHECKER, from: '        if (workerHsts(answer)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: a Cloudflare challenge in front of WordPress is no longer a warning', file: CHECKER, from: '      if (!answer.error && answer.headers[\'cf-mitigated\']) {', to: '      if (false) {', tests: CHECK },
  { name: 'checker: /login may be a 308 into the portal or anything else', file: CHECKER, from: '        if (![301, 302].includes(login.status)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: /login answered with the Worker\'s HSTS is accepted', file: CHECKER, from: '        if (workerHsts(login)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: the look-alikes of WordPress paths are not asked', file: CHECKER, from: 'for (const lookAlike of [\'/wp-adminx\', \'/wp-login\', \'/wp-login.php.bak\', \'/login/x\', \'/Login\']) {', to: 'for (const lookAlike of []) {', tests: CHECK },
  { name: 'checker: a copied upload may take two hops', file: CHECKER, from: '        expectRedirect(upload, [308], ', to: '        expectRedirect(upload, [308, 307, 301], ', tests: CHECK },
  { name: 'checker: /daftar may be kept by a browser (no no-store)', file: CHECKER, from: '          if (daftar.headers[\'cache-control\'] !== \'no-store\') problems.push(', to: '          if (false) problems.push(', tests: CHECK },
  { name: 'checker: the polite page of a missing shortlink is reported as a plain wrong status', file: CHECKER, from: '        if (daftar.status === 404 && /Formulir pendaftaran belum tersedia/.test(daftar.body)) {', to: '        if (false) {', tests: CHECK },
  { name: 'checker: /daftar/ may be anything', file: CHECKER, from: '        if (daftarSlash.status !== 308 || locOf(daftarSlash) !== site(\'/daftar\')) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: /Daftar may be anything', file: CHECKER, from: '        if (daftarCaps.status !== 307) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: /gabung-siswa may lack the link to /daftar', file: CHECKER, from: '        if (!/href=["\']\\/daftar["\']/.test(gabung.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: /gabung-siswa may link into /portal', file: CHECKER, from: '        if (/href=["\']\\/portal/.test(gabung.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: the session address on a page is accepted', file: CHECKER, from: '        if (/get-session/.test(answer.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: the Masuk link on a page is accepted', file: CHECKER, from: '        if (/href=["\']\\/portal\\/login["\']|data-auth-link/.test(answer.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: a registration button in the navbar is accepted', file: CHECKER, from: '        if (/Daftar Sekarang|\\/daftar/.test(nav)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: a filled navbar slot is accepted', file: CHECKER, from: '        if (/justify-self-end/.test(answer.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: a wrong HSTS value on a Worker answer is accepted (T-36)', file: CHECKER, from: '        if (value !== EXPECT.hsts) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  // ---- SAKEM-105: the reports are a section of /donasi, /laporan is one hop to it (T-37), the sitemap no longer lists /laporan (T-05), T-19 asks a static page
  { name: 'checker: /laporan may be any redirect status, not only a 308 (T-37)', file: CHECKER, from: "      expectRedirect(laporan, [308], site('/donasi#laporan'), problems);", to: "      expectRedirect(laporan, [301, 302, 307, 308], site('/donasi#laporan'), problems);", tests: CHECK },
  { name: 'checker: /laporan is not asked to be a redirect at all (T-37)', file: CHECKER, from: "      expectRedirect(laporan, [308], site('/donasi#laporan'), problems);\n", to: '', tests: CHECK },
  { name: 'checker: /laporan/ is not asked to be a redirect at all (T-37)', file: CHECKER, from: "      expectRedirect(laporanSlash, [308], site('/donasi#laporan'), problems);\n", to: '', tests: CHECK },
  { name: 'checker: /donasi may answer anything but 200 (T-37)', file: CHECKER, from: '        if (donasi.status !== 200) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: /donasi may lack the Laporan section (T-37)', file: CHECKER, from: '        if (!/<section\\b[^>]*\\bid=["\']laporan["\']/i.test(donasi.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: /donasi may be rendered from a stale or empty reports list (T-37)', file: CHECKER, from: '        if (!EXPECT.healthyReportsSources.includes(source)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: /donasi may show the failure panel of the reports (T-37)', file: CHECKER, from: '        if (/Laporan belum dapat ditampilkan/.test(donasi.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: a link to /laporan on /donasi is accepted (T-37)', file: CHECKER, from: '        if (/href=["\']\\/laporan\\/?["\']/i.test(donasi.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: /donasi may lack the footer link to /donasi#laporan (T-37)', file: CHECKER, from: '        if (!/<a\\b[^>]*\\bhref=["\']\\/donasi#laporan["\']/i.test(donasi.body)) problems.push(', to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: a sitemap that still lists /laporan is accepted (T-05)', file: CHECKER, from: "        if (locs.includes(site('/laporan'))) problems.push(", to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: a sitemap without /donasi is accepted (T-05)', file: CHECKER, from: "        if (!locs.includes(site('/donasi'))) problems.push(", to: '        if (false) problems.push(', tests: CHECK },
  { name: 'checker: the slash of a static page may take the assets layer\'s 307 (T-19)', file: CHECKER, from: "      expectRedirect(slash, [308], site('/gabung-siswa'), problems);", to: "      expectRedirect(slash, [308, 307], site('/gabung-siswa'), problems);", tests: CHECK },

  // ---------------------------------------------------------------- the zone-export check
  { name: 'zone: a Cloudflare range is missing from the list', file: ZONE, from: "'104.16.0.0/13', ", to: '', tests: ZONE_TESTS },
  { name: 'zone: a Cloudflare address counts only when the record is proxied', file: ZONE, from: "&& isCloudflareAddress(r.rdata.trim()));\n  for (const r of cloudflareContent)", to: "&& isCloudflareAddress(r.rdata.trim()) && r.proxied === true);\n  for (const r of cloudflareContent)", tests: ZONE_TESTS },
  { name: 'zone: a wildcard is only a warning', file: ZONE, from: "add('Z-02', allowWildcard ? 'WARN' : 'FAIL',", to: "add('Z-02', 'WARN',", tests: ZONE_TESTS },
  { name: 'zone: only an A wildcard is seen', file: ZONE, from: "r.name.split('.')[0] === '*');", to: "r.name.split('.')[0] === '*' && r.type === 'A');", tests: ZONE_TESTS },
  { name: 'zone: a proxied mail or autodiscover name is allowed', file: ZONE, from: '      return DNS_ONLY_LABELS.has(first) || ', to: '      return false || ', tests: ZONE_TESTS },
  { name: 'zone: a proxied CNAME to Microsoft 365 is allowed', file: ZONE, from: "(r.type === 'CNAME' && MICROSOFT_TARGET.test(", to: "(false && MICROSOFT_TARGET.test(", tests: ZONE_TESTS },
  { name: 'zone: an unproxied apex is only a warning', file: ZONE, from: "else if (!apex.some((r) => r.proxied === true)) add('Z-05', 'FAIL',", to: "else if (!apex.some((r) => r.proxied === true)) add('Z-05', 'WARN',", tests: ZONE_TESTS },
  { name: 'zone: a record that points at workers.dev passes', file: ZONE, from: '  const workersDev = inZone.filter((r) => /workers\\.dev/i.test(r.rdata));', to: '  const workersDev = [];', tests: ZONE_TESTS },
  { name: 'zone: a file inside the repository is read', file: ZONE, from: "  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {", to: '  if (false) {', tests: ZONE_TESTS },
  { name: 'zone: a semicolon inside a quoted string ends the record', file: ZONE, from: "    } else if (c === '\"') inString = true;\n    else if (c === ';') return { code", to: "    } else if (c === ';') return { code", tests: ZONE_TESTS },
];

// `--only <text>` runs the checks whose name contains <text>.
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
const patternsOnly = process.argv.includes('--patterns-only');

let bad = 0;
let ran = 0;
for (const check of checks) {
  if (only && !check.name.includes(only)) continue;
  ran++;
  const original = readFileSync(check.file, 'utf8');
  const found = original.split(check.from).length - 1;
  if (found !== 1) {
    console.log(`FAIL  ${check.name}: pattern found ${found} times in ${check.file}, expected exactly once`);
    bad++;
    continue;
  }
  // `--patterns-only`: only prove that every pattern is found exactly once (a second, instant pass after moving code); no test is run.
  if (patternsOnly) continue;
  try {
    writeFileSync(check.file, original.replace(check.from, () => check.to));
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...check.tests.split(' ')], { encoding: 'utf8' });
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
console.log(bad === 0 ? (patternsOnly ? `\nAll ${ran} patterns are found exactly once.` : `\nAll ${ran} safeguards are covered by tests.`) : `\n${bad} of ${ran} checks did not behave.`);
process.exit(bad === 0 ? 0 : 1);
