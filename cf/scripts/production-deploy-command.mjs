#!/usr/bin/env node
// PRINTS the PRODUCTION deploy command of one Worker, with its public per-deploy values (SAKEM-104, cutover Phase A,
// docs/cloudflare/cutover-runbook.md section 14). It does not run it, it does not call Cloudflare, it reads no secret.
//
//   node ../scripts/production-deploy-command.mjs admin   (from cf/admin; `pnpm deploy:prod:command`)
//   node ../scripts/production-deploy-command.mjs web     (from cf/web;   `pnpm deploy:prod:command`)
//
// Phase A deploys two Workers: the public site (`web`) and the API and admin (`admin`). The student portal is NOT part
// of Phase A, so it has no production printer on purpose (its staging one stays in staging-deploy-command.mjs).
//
// Why it exists, same as the staging printer next to it: a Worker's `vars` come from the configuration file on EVERY
// deploy and anything not in the file or in a `--var` is DELETED by the deploy (`wrangler deploy --help`, `--keep-vars`);
// secrets are never deleted. So the public values live in an untracked file next to the wrangler config,
// `.production.vars` (copy `production.vars.example`; `cf/**/.production.vars*` is git-ignored), and this prints the one
// command that passes all of them again, quoted, for the owner to read and run.
//
// What it refuses (with the line number), because each of these is a way to deploy the wrong thing to the real domain:
//   - a secret name (secrets go to `wrangler secret put`), a variable that is not one of this Worker's;
//   - an API URL (it would pull the site off its service binding), LEGACY_ORIGIN_URL (unset in production: the
//     pass-through is a plain fetch of the same hostname), ENVIRONMENT, COOKIE_DOMAIN, TRUSTED_ORIGINS;
//   - an empty value, a placeholder (`<...>`), an http:// origin, a path, a trailing slash, credentials, a query;
//   - anything that looks like staging or a local run: a workers.dev or r2.dev host, Cloudflare's always-pass Turnstile
//     TEST keys (1x0000...), `no-legacy-origin.invalid`, `resend.dev`, localhost, the word "staging";
//   - an origin that is not the Phase A host of its role (SITE_URL, ADMIN_URL and UPLOADS_BASE_URL are the three public
//     hostnames of the plan, and nothing else);
//   - a required value that is missing, because a redeploy without it would REMOVE it from the Worker;
//   - running while CLOUDFLARE_ENV is set: `wrangler deploy` and `pnpm build` obey it, so a shell left on staging would
//     deploy or build the staging Worker. (The printed admin command carries `--env=""`, which selects the top level
//     whatever the variable says; the web build is `pnpm build:prod`, which unsets it.)
//   - for the site, a `dist/` that is not the production build of the beacon id in the file (a stale staging build, or a
//     build made without WEB_ANALYTICS_BEACON_ID, which would leave the prerendered pages without the beacon) or whose
//     prerendered home page disagrees with the file about the student portal (PORTAL_ENABLED, SAKEM-103: Phase A is off; a
//     build made with it on, in a shell that still had it, would show "Masuk" on the static pages and call a Worker that is
//     not deployed).
//   - PORTAL_ENABLED=true: Phase A accepts `false` or no line. Like the beacon id it has two sources (the shell of the build
//     for the prerendered pages, the `--var` for the rendered ones), and the printed build line carries it from the same file.
//
// To add a variable of the site that a later change introduces, add ONE entry to `SPECS.web` below;
// tests/production-scripts.test.ts then fails for any variable of src/env.d.ts that is neither there nor in NEVER, so a new
// variable cannot be forgotten (PORTAL_ENABLED, SAKEM-103, is the first one it caught).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVarsFile, shellQuote } from './staging-deploy-command.mjs';

/** The three public origins of the Phase A plan, by the variable that carries them. Nothing else is accepted for these names. */
export const PRODUCTION_ORIGINS = {
  SITE_URL: 'https://sakolakembara.org',
  ADMIN_URL: 'https://admin.sakolakembara.org',
  UPLOADS_BASE_URL: 'https://files.sakolakembara.org',
};

/** The domain a production sender address must be on (the Resend domain is verified for it). */
const MAIL_DOMAIN = 'sakolakembara.org';

/**
 * Variables that never go through this printer, with the reason shown to the owner. Order matters: the first match wins.
 * @type {[RegExp, string][]}
 */
export const NEVER = [
  [/^(CONTENT_API_URL|CONTACT_API_URL)$/, 'these move the reads and the contact form off the service binding onto public HTTP'],
  [/^LEGACY_ORIGIN_URL$/, 'unset in production: the pass-through is a plain fetch of the same hostname, which reaches the old origin behind the route (a value here would send it somewhere else; no-legacy-origin.invalid is the staging value)'],
  [/^ENVIRONMENT$/, 'the top level of the wrangler configuration sets it to "production"'],
  [/^PRIVATE_FILES_BUDGET_BYTES$|^AUDIT_RETENTION_DAYS$|^(DRAFT|REJECTED_FILES|ACCEPTED_FILES)_RETENTION_DAYS$/, 'a fixed setting of the wrangler configuration, not a per-deploy value'],
  [/^BETTER_AUTH_SECRET$|SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE|^GOOGLE_CLIENT_/i, 'a secret: use `wrangler secret put`, typed at its prompt (Google sign-in is not part of Phase A)'],
  [/^COOKIE_DOMAIN$|^TRUSTED_ORIGINS$/, 'unset in production: the admin and the public site are different hosts with host-only cookies'],
  // Only the two known ones: a new PORTAL_* variable of a later change must be classified by a person (the coverage test says so).
  [/^PORTAL_(CONTACT_WHATSAPP|WHATSAPP_GROUP_URL)$/, 'the student portal is not part of Phase A'],
];

/**
 * Variables a Worker reads that its production printer deliberately does not print, though they are neither refused above
 * nor in SPECS: they belong to another Worker. (`ADMIN_URL` is the portal Worker's variable, declared in the shared env.ts of
 * cf/admin; the admin Worker does not read it.) The coverage test counts them as classified.
 */
export const NOT_PRINTED = /** @type {Record<'admin'|'web', string[]>} */ ({ admin: ['ADMIN_URL'], web: [] });

/**
 * The per-deploy PUBLIC variables of each Worker. `required`: a deploy without it would leave the Worker broken or
 * would REMOVE it (the printer refuses a file that lacks it). `kind` picks the value check.
 */
/**
 * @typedef {{ name: string, required: boolean, kind: 'origin'|'turnstile'|'beacon'|'seconds'|'email-from'|'portal-switch', min?: number, max?: number }} Spec
 * @type {{ admin: Spec[], web: Spec[] }}
 */
export const SPECS = {
  admin: [
    { name: 'TURNSTILE_SITE_KEY', required: true, kind: 'turnstile' },
    { name: 'UPLOADS_BASE_URL', required: true, kind: 'origin' },
    { name: 'SITE_URL', required: true, kind: 'origin' },
    // Only with a Resend key: without one the invitation, verification and reset mails fail closed (503).
    { name: 'EMAIL_FROM', required: false, kind: 'email-from' },
  ],
  web: [
    { name: 'TURNSTILE_SITE_KEY', required: true, kind: 'turnstile' },
    { name: 'ADMIN_URL', required: true, kind: 'origin' },
    { name: 'UPLOADS_BASE_URL', required: true, kind: 'origin' },
    // Public (it is in every page), and needed twice: here, and in the shell of the BUILD for the prerendered pages.
    { name: 'WEB_ANALYTICS_BEACON_ID', required: true, kind: 'beacon' },
    // SAKEM-103: whether the navbar offers "Masuk" and its session call. OFF by default and in Phase A (unset or `false`); like the
    // beacon id it has TWO sources, the shell of the BUILD (prerendered pages) and the `--var` (pages the Worker renders), printed
    // from this one value. Strictly `true` or `false`; Phase A accepts `false` only (the portal Worker is Phase B).
    { name: 'PORTAL_ENABLED', required: false, kind: 'portal-switch' },
    // Required: the staging probe put /blog above the CPU gate without the page copy (free-plan-audit.md, section 10).
    { name: 'PAGE_CACHE_SECONDS', required: true, kind: 'seconds', min: 1, max: 120 },
    { name: 'CONTENT_CACHE_FRESH_SECONDS', required: false, kind: 'seconds', min: 1, max: 3600 },
    { name: 'TEAM_CACHE_FRESH_SECONDS', required: false, kind: 'seconds', min: 1, max: 3600 },
  ],
};

/** @type {Record<'admin'|'web', { name: string, deploy: string[], before: string, file: string, example: string, secrets: string[], allowed: string[] }>} */
export const WORKERS = {
  admin: {
    name: 'sakem-admin',
    allowed: [],
    // `--env=""` is wrangler's own way to say "the top level" (its warning recommends it): it wins over CLOUDFLARE_ENV.
    deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '--env=""'],
    before: 'pnpm build:spa',
    file: '.production.vars',
    example: 'production.vars.example',
    secrets: ['BETTER_AUTH_SECRET', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY (only if invitation and reset mails are wanted at launch)'],
  },
  web: {
    name: 'sakola-kembara-web',
    allowed: [],
    deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '-c', 'dist/server/wrangler.json'],
    before: 'pnpm build:prod',
    file: '.production.vars',
    example: 'production.vars.example',
    secrets: [],
  },
};
for (const worker of /** @type {('admin'|'web')[]} */ (['admin', 'web'])) WORKERS[worker].allowed = SPECS[worker].map((spec) => spec.name);

/** Text that means a staging or local value, wherever it appears in a value. Cloudflare's Turnstile test keys are 1x, 2x and 3x followed by zeros. */
const STAGING_LOOK = /workers\.dev|r2\.dev|staging|\.invalid\b|\blocalhost\b|127\.0\.0\.1|\[::1\]|resend\.dev|(^|[.@/])example\.(com|org|net)\b|\.test\b/i;
const TURNSTILE_TEST_KEY = /^[1-9]x0{4,}/i;

/** Throws a message naming the line when a name or a value is not allowed for this Worker's production deploy. */
export function validateVars(worker, entries) {
  const config = WORKERS[worker];
  const specs = SPECS[worker];
  const seen = new Set();
  for (const { name, value, line } of entries) {
    const where = `line ${line} (${name})`;
    for (const [pattern, why] of NEVER) {
      if (pattern.test(name)) throw new Error(`${where}: refused, ${why}`);
    }
    const spec = specs.find((candidate) => candidate.name === name);
    if (!spec) throw new Error(`${where}: not a variable of ${config.name} (allowed: ${config.allowed.join(', ')})`);
    if (seen.has(name)) throw new Error(`${where}: set twice`);
    seen.add(name);
    if (value === '') throw new Error(`${where}: empty (fill it, or delete the line to leave an optional value out)`);
    // Angle brackets only belong in "Name <address@host>"; everywhere else they mean an unfilled placeholder.
    if (/\.\.\.|REPLACE|CHANGEME|placeholder/i.test(value) || (spec.kind !== 'email-from' && /[<>]/.test(value))) {
      throw new Error(`${where}: a placeholder, not a value`);
    }
    if (/[\n\r`$\\]/.test(value)) throw new Error(`${where}: a character that does not belong in a public value`);
    if (STAGING_LOOK.test(value)) throw new Error(`${where}: looks like staging or a local value (workers.dev, r2.dev, resend.dev, localhost, .invalid, "staging"): production uses the real hosts only`);
    if (TURNSTILE_TEST_KEY.test(value)) throw new Error(`${where}: Cloudflare's published TEST key (1x00...): production needs the real widget's site key`);
    const problem = checkValue(spec, name, value);
    if (problem) throw new Error(`${where}: ${problem}`);
  }
}

/** The shape check of one value by its kind: a message, or null. */
function checkValue(spec, name, value) {
  switch (spec.kind) {
    case 'origin': {
      let url;
      try {
        url = new URL(value);
      } catch {
        return 'not a URL';
      }
      if (url.protocol !== 'https:') return 'must be an https origin';
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || value.endsWith('/')) {
        return 'must be an origin only, like https://host (no path, no trailing slash, no credentials, no query)';
      }
      if (value !== PRODUCTION_ORIGINS[name]) return `not the Phase A host: ${name} must be exactly ${PRODUCTION_ORIGINS[name]}`;
      return null;
    }
    case 'turnstile':
      return /^[0-9A-Za-z_-]{10,64}$/.test(value) ? null : 'not a Turnstile site key (letters, digits, - and _, 10 to 64 characters)';
    case 'beacon':
      // The same shape as cf/web/web-analytics.config.mjs (a test keeps the two equal). The message does not repeat the value.
      return /^[0-9a-fA-F]{32}$/.test(value) ? null : 'not a Web Analytics beacon id (exactly 32 hexadecimal characters)';
    case 'portal-switch':
      // The same rule as cf/web/portal-enabled.config.mjs (a test keeps the two equal): exactly true or false. The message does not repeat the value.
      if (value === 'true') return 'refused in Phase A: `true` would show "Masuk" and call a portal Worker that is not deployed (Phase B changes this list); use `false` or leave the line out';
      return value === 'false' ? null : 'exactly true or false';
    case 'seconds': {
      if (!/^\d{1,5}$/.test(value)) return 'a whole number of seconds';
      const n = Number(value);
      return n >= spec.min && n <= spec.max ? null : `between ${spec.min} and ${spec.max} seconds`;
    }
    case 'email-from': {
      const match = /^(?:[^<>"'\\]{1,80}<([^\s<>@"']+@[^\s<>@"']+)>|([^\s<>@"']+@[^\s<>@"']+))$/.exec(value);
      if (!match) return 'expected Name <address@host> or address@host';
      const host = (match[1] ?? match[2]).split('@')[1].toLowerCase();
      return host === MAIL_DOMAIN || host.endsWith(`.${MAIL_DOMAIN}`) ? null : `the sender must be on ${MAIL_DOMAIN} (the domain verified in Resend), not ${host}`;
    }
    default:
      return null;
  }
}

/** The names of the required variables that `entries` does not carry. */
export function missingRequired(worker, entries) {
  return SPECS[worker].filter((spec) => spec.required && !entries.some((e) => e.name === spec.name)).map((spec) => spec.name);
}

/** The command as one string: the deploy words, then one `--var 'NAME:value'` per entry (in the file's order). */
export function buildCommand(worker, entries) {
  return [...WORKERS[worker].deploy, ...entries.flatMap(({ name, value }) => ['--var', shellQuote(`${name}:${value}`)])].join(' ');
}

/**
 * The build line of the site: the values the PRERENDERED pages need on the command line (never exported), from the same file as
 * the `--var`s: the beacon id and, when the file sets it, PORTAL_ENABLED. One value, two places, for each.
 */
export function buildLine(worker, entries) {
  if (worker !== 'web') return WORKERS[worker].before;
  const prefix = ['WEB_ANALYTICS_BEACON_ID', 'PORTAL_ENABLED']
    .map((name) => [name, entries.find((e) => e.name === name)?.value])
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${value}`);
  return [...prefix, WORKERS.web.before].join(' ');
}

// ------------------------------------------------------------------------------------------------ JSONC and resources

/** JSONC to a value: comments and trailing commas removed OUTSIDE strings (a `//` inside "https://..." stays). */
export function readJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** What each production resource is for, by binding name: the printer says it next to the name so the owner can check. */
const BUCKET_ROLE = {
  UPLOADS: `public, through ${PRODUCTION_ORIGINS.UPLOADS_BASE_URL}; never r2.dev`,
  PRIVATE_FILES: 'PRIVATE: must exist (the admin Worker binds it), stay empty and never public; the student portal is not part of Phase A',
};

/** Where the owner attaches each Worker in the dashboard. The configuration has no `routes` on purpose. */
export const ATTACHMENTS = {
  admin: [`Custom Domain  ${new URL(PRODUCTION_ORIGINS.ADMIN_URL).host}  (dashboard, Settings, Domains & Routes; not this deploy)`],
  web: ['Route          sakolakembara.org/*  (dashboard, fail OPEN; attached on the day of the switch, not by this deploy)'],
};

/** Lines naming the resources the top-level configuration expects. `config` is the parsed wrangler.jsonc (top level). */
export function describeResources(worker, config) {
  const lines = [`Worker         ${config.name}`];
  for (const d1 of config.d1_databases ?? []) lines.push(`D1 database    ${d1.database_name}  (binding ${d1.binding})`);
  for (const bucket of config.r2_buckets ?? []) lines.push(`R2 bucket      ${bucket.bucket_name}  (binding ${bucket.binding}; ${BUCKET_ROLE[bucket.binding] ?? 'role not listed'})`);
  for (const service of config.services ?? []) lines.push(`Service        ${service.binding} -> ${service.service}#${service.entrypoint}  (that Worker must be deployed first)`);
  lines.push(...ATTACHMENTS[worker]);
  lines.push(`workers.dev    ${config.workers_dev === false ? 'off (workers_dev: false in the configuration)' : 'NOT OFF: the configuration must say workers_dev: false'}`);
  return lines;
}

// ------------------------------------------------------------------------------------------------ the built site (dist/)

/** Problems with a built `dist/server/wrangler.json` as a PRODUCTION build of the site (empty = fine). */
export function builtConfigProblems(config) {
  const problems = [];
  if (config.name !== WORKERS.web.name) problems.push(`it names the Worker ${JSON.stringify(config.name)}, not ${WORKERS.web.name}: this is not the production build (a staging build in the same folder? run \`${WORKERS.web.before}\`)`);
  const services = JSON.stringify(config.services ?? []);
  if (services !== JSON.stringify([{ binding: 'API', service: 'sakem-admin', entrypoint: 'PublicApi' }])) problems.push(`its service binding is ${services}, not API -> sakem-admin#PublicApi`);
  if (Object.keys(config.vars ?? {}).length > 0) problems.push(`it carries variables (${Object.keys(config.vars).join(', ')}): the build must hold none, they are passed with --var`);
  if (config.workers_dev !== false) problems.push('workers_dev is not false: a production Worker must never be on workers.dev');
  return problems;
}

/** Problems with a prerendered page of the build as the home page of a build made with `beaconId` (empty = fine). */
export function builtBeaconProblems(html, beaconId) {
  const tags = [...html.matchAll(/<script\b[^>]*beacon\.min\.js[^>]*>/g)].map((m) => m[0]);
  if (tags.length === 0) return ['the prerendered home page has no Web Analytics beacon: the build was made without WEB_ANALYTICS_BEACON_ID (the --var reaches only the pages the Worker renders)'];
  if (tags.length > 1) return [`the prerendered home page has ${tags.length} beacon tags`];
  if (!tags[0].includes(`data-cf-beacon="{&quot;token&quot;:&quot;${beaconId}&quot;}"`)) return ['the beacon id of the prerendered home page is not the one in the vars file: rebuild with the line above'];
  return [];
}

/**
 * Problems with a prerendered page of the build as the home page of a build whose portal switch was `enabled` (SAKEM-103): with it
 * off (Phase A, and unset) the page has no "Masuk" link, no session address and no auth link at all; with it on, it has them.
 * @param {string} html
 * @param {boolean} enabled
 * @returns {string[]}
 */
export function builtPortalProblems(html, enabled) {
  const hasSession = html.includes('get-session');
  const hasLink = /href="\/portal\/login"|data-auth-link/.test(html);
  if (!enabled && (hasSession || hasLink)) return ['the prerendered home page offers the student portal ("Masuk" or its session call): the build was made with PORTAL_ENABLED=true, which Phase A must not have (rebuild with the line above)'];
  if (enabled && !(hasSession && hasLink)) return ['the prerendered home page has no "Masuk" link or session call: the build was made without PORTAL_ENABLED=true, the --var alone reaches only the pages the Worker renders'];
  return [];
}

function checkBuilt(dir, entries) {
  const beaconId = entries.find((e) => e.name === 'WEB_ANALYTICS_BEACON_ID').value;
  const portalOn = entries.find((e) => e.name === 'PORTAL_ENABLED')?.value === 'true';
  const notes = [];
  const problems = [];
  const configFile = path.join(dir, 'dist/server/wrangler.json');
  const homeFile = path.join(dir, 'dist/client/index.html');
  if (!existsSync(configFile)) {
    notes.push('dist/ is not built yet: run the build line above first, then print this again (it checks dist/ before it prints)');
    return { notes, problems };
  }
  try {
    problems.push(...builtConfigProblems(JSON.parse(readFileSync(configFile, 'utf8'))).map((p) => `dist/server/wrangler.json: ${p}`));
  } catch (error) {
    problems.push(`dist/server/wrangler.json: not readable (${error.message})`);
  }
  if (existsSync(homeFile)) {
    const html = readFileSync(homeFile, 'utf8');
    problems.push(...builtBeaconProblems(html, beaconId).map((p) => `dist/client/index.html: ${p}`));
    problems.push(...builtPortalProblems(html, portalOn).map((p) => `dist/client/index.html: ${p}`));
  } else problems.push('dist/client/index.html is missing: the build is incomplete');
  if (problems.length === 0) notes.push(`dist/ checked: the production build, the beacon id of the vars file is in the prerendered home page, and the portal is ${portalOn ? 'ON' : 'OFF'} there as the file says`);
  return { notes, problems };
}

// ------------------------------------------------------------------------------------------------ the program

function main(argv) {
  const worker = argv[0];
  if (!WORKERS[worker]) {
    process.stderr.write('usage: node ../scripts/production-deploy-command.mjs <admin|web> [file]   (default file: .production.vars in the current folder; there is no production printer for the student portal: it is not part of Phase A)\n');
    return 2;
  }
  const config = WORKERS[worker];
  const cwd = process.cwd();
  if (process.env.CLOUDFLARE_ENV) {
    process.stderr.write(
      `CLOUDFLARE_ENV is set in this shell (to "${process.env.CLOUDFLARE_ENV}"): wrangler and the build obey it, so a production deploy from here could deploy or build the wrong Worker. Run \`unset CLOUDFLARE_ENV\` and print again. Nothing was printed.\n`,
    );
    return 1;
  }
  const file = path.resolve(argv[1] ?? config.file);
  if (!existsSync(file)) {
    process.stderr.write(`${path.basename(file)} not found in ${path.dirname(file)}. Copy ${config.example} to ${config.file} (it is git-ignored) and fill in the public values.\n`);
    return 1;
  }
  let entries;
  try {
    entries = parseVarsFile(readFileSync(file, 'utf8'));
    validateVars(worker, entries);
    const missing = missingRequired(worker, entries);
    if (missing.length > 0) throw new Error(`required and missing: ${missing.join(', ')} (a deploy without a value REMOVES it from the Worker)`);
  } catch (error) {
    process.stderr.write(`${path.basename(file)}: ${error.message}\n`);
    return 1;
  }
  let built = { notes: [], problems: [] };
  if (worker === 'web') {
    built = checkBuilt(cwd, entries);
    if (built.problems.length > 0) {
      process.stderr.write(`${built.problems.map((p) => `${p}`).join('\n')}\nNothing was printed. Build with: ${buildLine(worker, entries)}\n`);
      return 1;
    }
  }
  let resources = ['(wrangler.jsonc not found in this folder: run this from cf/admin or cf/web; the resource list is skipped)'];
  const configFile = path.join(cwd, 'wrangler.jsonc');
  if (existsSync(configFile)) {
    try {
      resources = describeResources(worker, readJsonc(readFileSync(configFile, 'utf8')));
    } catch (error) {
      resources = [`(wrangler.jsonc not readable: ${error.message})`];
    }
  }
  const optionalMissing = SPECS[worker].filter((spec) => !spec.required && !entries.some((e) => e.name === spec.name)).map((spec) => spec.name);
  process.stderr.write(
    [
      `# ${config.name} (PRODUCTION, the real domain): this prints the command, it does not run it.`,
      `# 1. pin the ORGANISATION account in this shell first (value not printed): ${process.env.CLOUDFLARE_ACCOUNT_ID ? 'CLOUDFLARE_ACCOUNT_ID is set' : 'CLOUDFLARE_ACCOUNT_ID is NOT set: do not run anything yet'}`,
      `# 2. ${buildLine(worker, entries)}`,
      ...(worker === 'web'
        ? [
            '#    the beacon id goes in the BUILD (prerendered pages: /, /donasi, /gabung-siswa, /program/<id>) and in the --var below (pages the Worker renders): one value, from the vars file.',
            '#    typed on the build line, never exported: a later staging build in the same shell would pick it up.',
            ...(entries.some((e) => e.name === 'PORTAL_ENABLED')
              ? ['#    the same goes for PORTAL_ENABLED (the prerendered pages take it from the shell of the BUILD, the --var reaches the rendered pages only): Phase A is `false`.']
              : ['#    PORTAL_ENABLED is not in the file: the portal is OFF (the default) in the build and on the Worker, which is Phase A.']),
          ]
        : []),
      `# 3. read the command below, then run it. A value that is not passed is REMOVED from the Worker by the deploy; secrets are never removed.`,
      ...(worker === 'admin' ? ['#    `--env=""` selects the top level (production) even if CLOUDFLARE_ENV were set.'] : []),
      ...built.notes.map((note) => `# ${note}`),
      '# production resources this deploy expects (names read from wrangler.jsonc, top level; create them first, see the runbook):',
      ...resources.map((line) => `#   ${line}`),
      config.secrets.length > 0 ? `# secrets expected on ${config.name} (names only; check with: pnpm exec wrangler secret list --env=""): ${config.secrets.join(', ')}` : `# secrets: none on ${config.name}`,
      optionalMissing.length > 0 ? `# not set in ${path.basename(file)} (optional): ${optionalMissing.join(', ')}` : '',
      '',
    ]
      .filter((line, index, all) => line !== '' || index === all.length - 1)
      .join('\n'),
  );
  process.stdout.write(`${buildCommand(worker, entries)}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
