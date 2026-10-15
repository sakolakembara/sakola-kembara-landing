#!/usr/bin/env node
// PRINTS the staging deploy command of one Worker, with its public per-deploy values (SAKEM-084,
// docs/cloudflare/staging-runbook.md). It does not run it, it does not call Cloudflare, it reads no secret.
//
//   node ../scripts/staging-deploy-command.mjs admin     (from cf/admin; `pnpm deploy:staging:command`)
//   node ../scripts/staging-deploy-command.mjs web       (from cf/web)
//   node ../scripts/staging-deploy-command.mjs portal    (from cf/admin; `pnpm deploy:staging:portal:command`; reads
//                                                         .staging.vars.portal, because .staging.vars is the admin's)
//
// Why it exists: a Worker's `vars` come from the configuration file on EVERY deploy (what is not in the
// file, or in a `--var`, is removed), and the values that differ per account (the Turnstile site key, the
// address of the public bucket, the `workers.dev` hosts) must not be in git. So they live in an untracked
// file next to the wrangler config, `.staging.vars` (copy `staging.vars.example`; `cf/**/.staging.vars*`
// is git-ignored; the portal's is `.staging.vars.portal`, from `staging.portal.vars.example`), and this prints
// the one command that passes all of them again, quoted, for the owner to read and run. Forgetting one on a
// redeploy would silently remove it.
//
// What goes in that file are PUBLIC values only, from a list per Worker. A secret name, an API URL that
// would pull the site off its service binding, a key, a token, a placeholder or anything that is not an
// https origin where an origin is expected is refused with the line number. Secrets go to
// `wrangler secret put`, typed into wrangler's own prompt.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_NAMES = new Set(['UPLOADS_BASE_URL', 'SITE_URL', 'ADMIN_URL', 'LEGACY_ORIGIN_URL']);
const PRODUCTION_DOMAIN = /(^|\.)sakolakembara\.org$/i;

export const WORKERS = {
  admin: {
    name: 'sakem-admin-staging',
    deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '--env', 'staging'],
    // Both are served to the browser by GET /api/config (the site key and the origins are public by design).
    allowed: ['TURNSTILE_SITE_KEY', 'UPLOADS_BASE_URL', 'SITE_URL', 'EMAIL_FROM'],
    before: 'pnpm build:spa',
    file: '.staging.vars',
  },
  // The student portal's Worker (SAKEM-098): the same package as the admin, its own configuration file and environment.
  // All six are public: GET /portal/api/config serves the site key, the two origins and the two optional WhatsApp values
  // to the browser. The three secrets of this Worker (BETTER_AUTH_SECRET, RESEND_API_KEY, TURNSTILE_SECRET_KEY) go in with
  // `wrangler secret put`, and a test keeps this list equal to the per-deploy variables the staging block declares.
  portal: {
    name: 'sakem-portal-staging',
    deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '-c', 'wrangler.portal.jsonc', '--env', 'staging'],
    allowed: ['TURNSTILE_SITE_KEY', 'SITE_URL', 'ADMIN_URL', 'EMAIL_FROM', 'PORTAL_CONTACT_WHATSAPP', 'PORTAL_WHATSAPP_GROUP_URL'],
    before: 'pnpm build:portal-spa',
    file: '.staging.vars.portal',
  },
  web: {
    name: 'sakem-web-staging',
    deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '-c', 'dist/server/wrangler.json'],
    // LEGACY_ORIGIN_URL is allowed with ONE kind of value, a `.invalid` host (RFC 2606: it never resolves). Staging has no
    // legacy origin behind its hostname, so the pass-through of a path nobody serves (/_next/*, /images/team/*) would
    // fetch the Worker's own workers.dev address again, up to Cloudflare's loop limit of 16 invocations for one request;
    // a host that cannot resolve makes it fail at once instead, with no code change. Never the live site.
    // WEB_ANALYTICS_BEACON_ID (SAKEM-095) is a public value (it is in every page's HTML) and is not named `..._TOKEN`, so the
    // secret-name refusal below stays whole. It is optional and left out on staging; it only reaches the pages the Worker renders.
    allowed: ['TURNSTILE_SITE_KEY', 'UPLOADS_BASE_URL', 'ADMIN_URL', 'LEGACY_ORIGIN_URL', 'CONTENT_CACHE_FRESH_SECONDS', 'TEAM_CACHE_FRESH_SECONDS', 'PAGE_CACHE_SECONDS', 'WEB_ANALYTICS_BEACON_ID'],
    before: 'pnpm build:staging',
    file: '.staging.vars',
  },
};

/** The example file each Worker's vars file is copied from (next to the wrangler configuration). */
const EXAMPLES = { admin: 'staging.vars.example', web: 'staging.vars.example', portal: 'staging.portal.vars.example' };

/** Names that must never be passed this way, with the reason (shown to the owner). */
const NEVER = [
  [/^(CONTENT_API_URL|CONTACT_API_URL)$/, 'these move the reads and the contact form off the service binding onto public HTTP'],
  [/^ENVIRONMENT$/, 'the staging block of the wrangler configuration sets it'],
  [/^PRIVATE_FILES_BUDGET_BYTES$|^(DRAFT|REJECTED_FILES|ACCEPTED_FILES)_RETENTION_DAYS$/, 'a fixed setting of the wrangler configuration (the private bucket budget, the "never delete" retention), not a per-deploy value'],
  [/^BETTER_AUTH_SECRET$|SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE/i, 'a secret: use `wrangler secret put`, typed at its prompt'],
  [/^COOKIE_DOMAIN$|^TRUSTED_ORIGINS$/, 'not used on staging (host-only cookies, same-origin writes)'],
];

/** `KEY=VALUE` lines (dotenv style, `#` comments, optional "double" or 'single' quotes) -> [{ name, value, line }]. */
export function parseVarsFile(text) {
  const entries = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) throw new Error(`line ${line}: not KEY=VALUE`);
    let value = match[2].trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    entries.push({ name: match[1], value, line });
  });
  return entries;
}

/** Throws a message naming the line when a name or a value is not allowed for this Worker. */
export function validateVars(worker, entries) {
  const config = WORKERS[worker];
  const seen = new Set();
  for (const { name, value, line } of entries) {
    const where = `line ${line} (${name})`;
    for (const [pattern, why] of NEVER) {
      if (pattern.test(name)) throw new Error(`${where}: refused, ${why}`);
    }
    if (!config.allowed.includes(name)) throw new Error(`${where}: not a variable of ${config.name} (allowed: ${config.allowed.join(', ')})`);
    if (seen.has(name)) throw new Error(`${where}: set twice`);
    seen.add(name);
    // Angle brackets only belong in "Name <address@host>"; everywhere else they mean an unfilled placeholder.
    const placeholder = /\.\.\.|REPLACE|CHANGEME|placeholder/i.test(value) || (name !== 'EMAIL_FROM' && /[<>]/.test(value));
    if (value === '' || placeholder || /[\n\r`$\\]/.test(value)) {
      throw new Error(`${where}: empty, a placeholder or a character that does not belong in a public value`);
    }
    if (URL_NAMES.has(name)) {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`${where}: not a URL`);
      }
      if (url.protocol !== 'https:') throw new Error(`${where}: must be an https origin`);
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || value.endsWith('/')) {
        throw new Error(`${where}: must be an origin only, like https://host (no path, no trailing slash, no credentials)`);
      }
      if (name === 'LEGACY_ORIGIN_URL' && !url.hostname.endsWith('.invalid')) {
        throw new Error(`${where}: refused, staging must never forward to a real host: only a *.invalid host (it never resolves) is accepted`);
      }
      // The same line as the probe's: a staging Worker never points at the live domain (a link, a redirect, a bucket).
      if (PRODUCTION_DOMAIN.test(url.hostname)) throw new Error(`${where}: refused, ${url.hostname} is the production domain; staging points at staging hosts only`);
    } else if (name === 'PORTAL_CONTACT_WHATSAPP') {
      // src/portal/contact.ts: the country code and the number, digits only, 8 to 15 digits, no `+`, no space, no leading zero.
      if (!/^[1-9]\d{7,14}$/.test(value)) throw new Error(`${where}: digits only with the country code, 8 to 15 digits, no +, no spaces, no leading zero (an invented number, never a real person's)`);
    } else if (name === 'PORTAL_WHATSAPP_GROUP_URL') {
      // src/portal/contact.ts: https with a host, no credentials, at most 300 characters, nothing that does not belong in an href.
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`${where}: not a URL`);
      }
      if (value.length > 300 || !/^https:\/\/[^/\s]/i.test(value) || /[\s\u0000-\u001f\u007f"'<>`\\]/.test(value) || url.protocol !== 'https:' || url.username || url.password) {
        throw new Error(`${where}: an https address with a host, no credentials, at most 300 characters, no spaces or quotes (an invented invitation, never a real group's)`);
      }
      if (PRODUCTION_DOMAIN.test(url.hostname)) throw new Error(`${where}: refused, ${url.hostname} is the production domain`);
      // A staging answer of GET /portal/api/config is public to anyone who has the host: a real invitation must not be on it.
      if (/(^|\.)(whatsapp\.com|wa\.me)$/i.test(url.hostname)) throw new Error(`${where}: refused, ${url.hostname} is WhatsApp's own address: a real group invitation must not be on a public staging page, use an invented https address`);
    } else if (name === 'TURNSTILE_SITE_KEY') {
      if (!/^[0-9A-Za-z_-]{10,64}$/.test(value)) throw new Error(`${where}: not a Turnstile site key (letters, digits, - and _, 10 to 64 characters)`);
    } else if (name === 'WEB_ANALYTICS_BEACON_ID') {
      // The same shape as cf/web/web-analytics.config.mjs (a test keeps the two equal). The message does not repeat the value.
      if (!/^[0-9a-fA-F]{32}$/.test(value)) throw new Error(`${where}: not a Web Analytics beacon id (exactly 32 hexadecimal characters)`);
    } else if (name === 'EMAIL_FROM') {
      if (!/^(?:[^<>"'\\]{1,80}<[^\s<>@"']+@[^\s<>@"']+>|[^\s<>@"']+@[^\s<>@"']+)$/.test(value)) {
        throw new Error(`${where}: expected Name <address@host> or address@host`);
      }
    } else if (/_SECONDS$/.test(name)) {
      if (!/^\d{1,5}$/.test(value)) throw new Error(`${where}: a whole number of seconds`);
    }
  }
}

/** POSIX single-quoting: safe for any value, spaces and angle brackets included. */
export function shellQuote(text) {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/** The command as one string: the deploy words, then one `--var 'NAME:value'` per entry (in the file's order). */
export function buildCommand(worker, entries) {
  const config = WORKERS[worker];
  return [...config.deploy, ...entries.flatMap(({ name, value }) => ['--var', shellQuote(`${name}:${value}`)])].join(' ');
}

/** Lines for the owner that depend on what the file holds. Today one: a `--var` does not reach the prerendered pages of the site. */
export function extraNotes(worker, entries) {
  if (worker === 'web' && entries.some((e) => e.name === 'WEB_ANALYTICS_BEACON_ID')) {
    return [
      '# the prerendered pages (/, /donasi, /gabung-siswa, /program/<id>) are static files: they get WEB_ANALYTICS_BEACON_ID from the shell of the BUILD,',
      '# so run step 2 as `WEB_ANALYTICS_BEACON_ID=<the same value> pnpm build:staging`; the --var below reaches the pages the Worker renders only.',
    ];
  }
  return [];
}

function main(argv) {
  const worker = argv[0];
  if (!WORKERS[worker]) {
    process.stderr.write('usage: node ../scripts/staging-deploy-command.mjs <admin|web|portal> [file]   (default file: .staging.vars in the current folder, .staging.vars.portal for the portal)\n');
    return 2;
  }
  const file = path.resolve(argv[1] ?? WORKERS[worker].file);
  if (!existsSync(file)) {
    process.stderr.write(`${path.basename(file)} not found in ${path.dirname(file)}. Copy ${EXAMPLES[worker]} to ${WORKERS[worker].file} (it is git-ignored) and fill in the public values.\n`);
    return 1;
  }
  let entries;
  try {
    entries = parseVarsFile(readFileSync(file, 'utf8'));
    validateVars(worker, entries);
  } catch (error) {
    process.stderr.write(`${path.basename(file)}: ${error.message}\n`);
    return 1;
  }
  const config = WORKERS[worker];
  const missing = config.allowed.filter((name) => !entries.some((e) => e.name === name));
  process.stderr.write(
    [
      `# ${config.name}: this prints the command, it does not run it.`,
      `# 1. pin the ORGANISATION account in this shell first (value not printed here): ${process.env.CLOUDFLARE_ACCOUNT_ID ? 'CLOUDFLARE_ACCOUNT_ID is set' : 'CLOUDFLARE_ACCOUNT_ID is NOT set'}`,
      `# 2. ${config.before}`,
      `# 3. read the command below, then run it. Without --var the value is removed from the Worker (blanked, where the staging block declares it empty).`,
      ...extraNotes(worker, entries),
      missing.length > 0 ? `# not set in ${path.basename(file)} (fine if you do not need them): ${missing.join(', ')}` : '',
      '',
    ]
      .filter((line, index, all) => line !== '' || index === all.length - 1)
      .join('\n'),
  );
  process.stdout.write(`${buildCommand(worker, entries)}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
