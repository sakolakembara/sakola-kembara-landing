#!/usr/bin/env node
// PRINTS the staging deploy command of one Worker, with its public per-deploy values (SAKEM-084,
// docs/cloudflare/staging-runbook.md). It does not run it, it does not call Cloudflare, it reads no secret.
//
//   node ../scripts/staging-deploy-command.mjs admin     (from cf/admin; `pnpm deploy:staging:command`)
//   node ../scripts/staging-deploy-command.mjs web       (from cf/web)
//
// Why it exists: a Worker's `vars` come from the configuration file on EVERY deploy (what is not in the
// file, or in a `--var`, is removed), and the values that differ per account (the Turnstile site key, the
// address of the public bucket, the `workers.dev` hosts) must not be in git. So they live in an untracked
// file next to the wrangler config, `.staging.vars` (copy `staging.vars.example`; `cf/**/.staging.vars*`
// is git-ignored), and this prints the one command that passes all of them again, quoted, for the owner to
// read and run. Forgetting one on a redeploy would silently remove it.
//
// What goes in that file are PUBLIC values only, from a list per Worker. A secret name, an API URL that
// would pull the site off its service binding, a key, a token, a placeholder or anything that is not an
// https origin where an origin is expected is refused with the line number. Secrets go to
// `wrangler secret put`, typed into wrangler's own prompt.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_NAMES = new Set(['UPLOADS_BASE_URL', 'SITE_URL', 'ADMIN_URL']);

export const WORKERS = {
  admin: {
    name: 'sakem-admin-staging',
    deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '--env', 'staging'],
    // Both are served to the browser by GET /api/config (the site key and the origins are public by design).
    allowed: ['TURNSTILE_SITE_KEY', 'UPLOADS_BASE_URL', 'SITE_URL', 'EMAIL_FROM'],
    before: 'pnpm build:spa',
  },
  web: {
    name: 'sakem-web-staging',
    deploy: ['pnpm', 'exec', 'wrangler', 'deploy', '-c', 'dist/server/wrangler.json'],
    allowed: ['TURNSTILE_SITE_KEY', 'UPLOADS_BASE_URL', 'ADMIN_URL', 'CONTENT_CACHE_FRESH_SECONDS', 'TEAM_CACHE_FRESH_SECONDS'],
    before: 'pnpm build:staging',
  },
};

/** Names that must never be passed this way, with the reason (shown to the owner). */
const NEVER = [
  [/^(CONTENT_API_URL|CONTACT_API_URL)$/, 'these move the reads and the contact form off the service binding onto public HTTP'],
  [/^LEGACY_ORIGIN_URL$/, 'staging has no legacy origin and must not forward to the live site'],
  [/^ENVIRONMENT$/, 'the staging block of wrangler.jsonc sets it'],
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
    } else if (name === 'TURNSTILE_SITE_KEY') {
      if (!/^[0-9A-Za-z_-]{10,64}$/.test(value)) throw new Error(`${where}: not a Turnstile site key (letters, digits, - and _, 10 to 64 characters)`);
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

function main(argv) {
  const worker = argv[0];
  if (!WORKERS[worker]) {
    process.stderr.write('usage: node ../scripts/staging-deploy-command.mjs <admin|web> [file]   (default file: .staging.vars in the current folder)\n');
    return 2;
  }
  const file = path.resolve(argv[1] ?? '.staging.vars');
  if (!existsSync(file)) {
    process.stderr.write(`${path.basename(file)} not found in ${path.dirname(file)}. Copy staging.vars.example to .staging.vars (it is git-ignored) and fill in the public values.\n`);
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
      `# 3. read the command below, then run it. Without --var the value is removed from the Worker.`,
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
