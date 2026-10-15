#!/usr/bin/env node
// Offline check of an EXPORT of the Cloudflare zone `sakolakembara.org` (SAKEM-104, cutover Phase A, docs/cloudflare/cutover-runbook.md
// section 14, step SA-03). It reads ONE file, the BIND export of the dashboard (DNS, Records, Import and Export, Export), and
// says what must be sorted out BEFORE the public site and the admin move onto the zone. It uses no network, no account, no
// token, and it writes nothing. The export is private (it holds the origin's address): it must live OUTSIDE the repository, and
// the tool refuses a file inside it.
//
//   node ../scripts/check-zone-export.mjs <export file> [--allow-wildcard]      (from cf/web: `pnpm check:zone-export -- <file>`)
//
// Why it exists: on 2026-10-15 the DNS scan that came with the zone's onboarding copied Cloudflare's OWN proxy addresses as
// the content of A and AAAA records, and the live site answered error 1000 for about 1 h 40. A record that is proxied and
// whose content is a Cloudflare address is invisible from outside (`dig` shows Cloudflare's addresses either way), so the
// export is the only place to see it. What it flags:
//   Z-01  an A or AAAA record whose CONTENT is in Cloudflare's published proxy ranges (error 1000)      FAIL
//   Z-02  a wildcard record (`*`), which answers for every name nobody listed                            FAIL (unless --allow-wildcard)
//   Z-03  a PROXIED record on a mail, autodiscover, DKIM or hosting-panel name, or one that points at
//         Microsoft 365 (proxying breaks mail clients, DKIM lookups and every non-HTTP protocol)         FAIL
//   Z-04  a record that points at workers.dev                                                            FAIL
//   Z-05  the apex has no proxied A, AAAA or CNAME record (a route cannot be attached without one)      FAIL; www not proxied: WARN
//   Z-06  Microsoft 365 mail records present or missing (MX, SPF, autodiscover, DKIM)                    INFO or WARN
//   Z-07  every proxied name, so the reviewer sees the whole set                                          INFO
// The proxy status comes from the `cf_tags=cf-proxied:true|false` comment Cloudflare writes after every record. A file
// without it (an export of the OLD provider) has no proxy information: the proxy rules are skipped and the tool says so.
// It prints names and types, never the content of a record, except an address of Cloudflare's own.
//
//   0 nothing failed   1 a check failed   2 refused or bad arguments
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ZONE = 'sakolakembara.org';

/** Cloudflare's published proxy ranges (https://www.cloudflare.com/ips-v4 and /ips-v6, read on 2026-10-15). */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

/** First labels that must never be proxied: mail and autodiscover names, the hosting panel's, and anything `_domainkey`. */
export const DNS_ONLY_LABELS = new Set([
  'mail', 'smtp', 'imap', 'pop', 'pop3', 'webmail', 'autodiscover', 'autoconfig', 'lyncdiscover', 'sip', 'enterpriseregistration', 'enterpriseenrollment', 'msoid',
  'cpanel', 'whm', 'webdisk', 'cpcalendars', 'cpcontacts', 'ftp',
]);
const MICROSOFT_TARGET = /(^|\.)(outlook\.com|office365\.com|onmicrosoft\.com|microsoft\.com|microsoftonline(-p)?\.com|microsoftonline-p\.net|lync\.com|windows\.net|protection\.outlook\.com)\.?$/i;

// ------------------------------------------------------------------------------------------------ addresses

function ipv4ToBigInt(text) {
  const parts = text.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n);
}

function ipv6ToBigInt(text) {
  if (!/^[0-9a-f:]+$/i.test(text) || text.split('::').length > 2) return null;
  const [head, tail] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 1) return null;
  const groups = [...left, ...Array(tail === undefined ? 0 : missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(`0x${g}`), 0n);
}

/** Is `address` (IPv4 or IPv6 text) inside one of Cloudflare's ranges? Anything that is not an address is false. */
export function isCloudflareAddress(address) {
  const v4 = ipv4ToBigInt(address);
  const v6 = v4 === null ? ipv6ToBigInt(address) : null;
  if (v4 === null && v6 === null) return false;
  for (const range of CLOUDFLARE_RANGES) {
    const [base, bits] = range.split('/');
    const six = range.includes(':');
    if (six !== (v6 !== null)) continue;
    const size = six ? 128n : 32n;
    const mask = ((1n << BigInt(bits)) - 1n) << (size - BigInt(bits));
    const value = six ? v6 : v4;
    const network = six ? ipv6ToBigInt(base) : ipv4ToBigInt(base);
    if ((value & mask) === network) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------ the export

/** Code and comment of one line, splitting at the first `;` that is not inside a quoted string. */
function splitComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === ';') return { code: line.slice(0, i), comment: line.slice(i + 1) };
  }
  return { code: line, comment: '' };
}

const depthOf = (code) => {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
  }
  return depth;
};

/**
 * The records of a BIND export: `[{ name, type, rdata, proxied: true|false|null }]`, names lower-case without the final dot.
 * `proxied` is null when the line has no `cf_tags` comment. Comments, `$` directives and multi-line records are tolerated.
 */
export function parseZoneExport(text) {
  const records = [];
  let owner = null;
  let origin = ZONE;
  let pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const { code, comment } = splitComment(raw);
    if (pending) {
      pending.code += ` ${code}`;
      pending.comment += comment;
      if (depthOf(pending.code) <= 0) {
        finish(pending);
        pending = null;
      }
      continue;
    }
    if (code.trim() === '') continue;
    if (/^\$ORIGIN\s/i.test(code)) {
      origin = code.trim().split(/\s+/)[1].replace(/\.$/, '').toLowerCase();
      continue;
    }
    if (code.startsWith('$')) continue;
    const entry = { code, comment, indented: /^\s/.test(code) };
    if (depthOf(code) > 0) pending = entry;
    else finish(entry);
  }
  if (pending) finish(pending);
  return records;

  function finish({ code, comment, indented }) {
    const tokens = code.replaceAll('(', ' ').replaceAll(')', ' ').match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
    let i = 0;
    if (!indented) {
      const name = tokens[i++];
      owner = name === '@' ? origin : name.endsWith('.') ? name.slice(0, -1).toLowerCase() : `${name}.${origin}`.toLowerCase();
    }
    while (i < tokens.length && (/^\d+$/.test(tokens[i]) || /^(IN|CH|HS)$/i.test(tokens[i]))) i++;
    const type = tokens[i++]?.toUpperCase();
    if (!type || owner === null) return;
    const tag = /cf-proxied:(true|false)/i.exec(comment)?.[1]?.toLowerCase();
    records.push({ name: owner, type, rdata: tokens.slice(i).join(' '), proxied: tag === undefined ? null : tag === 'true' });
  }
}

// ------------------------------------------------------------------------------------------------ the checks

/** @returns {{ id: string, level: 'FAIL'|'WARN'|'INFO'|'PASS', text: string }[]} */
export function checkZone(records, { allowWildcard = false } = {}) {
  const results = [];
  const add = (id, level, text) => results.push({ id, level, text });
  const inZone = records.filter((r) => r.name === ZONE || r.name.endsWith(`.${ZONE}`));
  if (inZone.length === 0) {
    add('Z-00', 'FAIL', `no record of ${ZONE} was found: is this the export of the right zone?`);
    return results;
  }
  const hasProxyInfo = inZone.some((r) => r.proxied !== null);
  if (!hasProxyInfo) add('Z-00', 'WARN', 'no cf_tags comment on any record: this does not look like a Cloudflare export (the old provider\'s?), so the proxy rules are skipped');
  const label = (r) => `${r.type} ${r.name === ZONE ? '@' : r.name.slice(0, -(ZONE.length + 1))}`;

  // Z-01
  const cloudflareContent = inZone.filter((r) => (r.type === 'A' || r.type === 'AAAA') && isCloudflareAddress(r.rdata.trim()));
  for (const r of cloudflareContent) add('Z-01', 'FAIL', `${label(r)} has the Cloudflare address ${r.rdata.trim()} as its content${r.proxied ? ' (proxied)' : ''}: a record must hold the ORIGIN's address (error 1000 otherwise)`);
  if (cloudflareContent.length === 0) add('Z-01', 'PASS', `no A or AAAA record has a Cloudflare address as its content (${inZone.filter((r) => r.type === 'A' || r.type === 'AAAA').length} checked)`);

  // Z-02
  const wildcards = inZone.filter((r) => r.name.split('.')[0] === '*');
  for (const r of wildcards) add('Z-02', allowWildcard ? 'WARN' : 'FAIL', `${label(r)} is a wildcard${r.proxied ? ' and proxied' : ''}: it answers for every name nobody listed${allowWildcard ? ' (accepted with --allow-wildcard: check its content by hand)' : '; delete it or fix it, then run this again (--allow-wildcard once it is intended)'}`);
  if (wildcards.length === 0) add('Z-02', 'PASS', 'no wildcard record');

  // Z-03
  if (hasProxyInfo) {
    const mustBeDnsOnly = inZone.filter((r) => {
      if (r.proxied !== true) return false;
      const first = r.name.split('.')[0];
      return DNS_ONLY_LABELS.has(first) || r.name.includes('._domainkey.') || r.type === 'MX' || (r.type === 'CNAME' && MICROSOFT_TARGET.test(r.rdata.trim().replace(/^"|"$/g, '')));
    });
    for (const r of mustBeDnsOnly) add('Z-03', 'FAIL', `${label(r)} is PROXIED: mail, autodiscover, DKIM, hosting-panel and Microsoft 365 names must be DNS-only (grey cloud)`);
    if (mustBeDnsOnly.length === 0) add('Z-03', 'PASS', 'no mail, autodiscover, DKIM, hosting-panel or Microsoft 365 record is proxied');
  }

  // Z-04
  const workersDev = inZone.filter((r) => /workers\.dev/i.test(r.rdata));
  for (const r of workersDev) add('Z-04', 'FAIL', `${label(r)} points at workers.dev`);
  if (workersDev.length === 0) add('Z-04', 'PASS', 'no record points at workers.dev');

  // Z-05
  if (hasProxyInfo) {
    const web = (name) => inZone.filter((r) => r.name === name && ['A', 'AAAA', 'CNAME'].includes(r.type));
    const apex = web(ZONE);
    if (apex.length === 0) add('Z-05', 'FAIL', 'the apex has no A, AAAA or CNAME record: nothing to attach the route to, and the site is down');
    else if (!apex.some((r) => r.proxied === true)) add('Z-05', 'FAIL', 'the apex record is not proxied: a route needs a proxied record for the hostname (requests would fail with ERR_NAME_NOT_RESOLVED)');
    else add('Z-05', 'PASS', 'the apex has a proxied record');
    const www = web(`www.${ZONE}`);
    if (www.length === 0) add('Z-05', 'WARN', 'there is no www record: the www to apex redirect has nothing to start from');
    else if (!www.some((r) => r.proxied === true)) add('Z-05', 'WARN', 'the www record is not proxied: the zone rule that redirects www to the apex never sees it');
    else add('Z-05', 'PASS', 'www has a proxied record');
  }

  // Z-06
  const mx = inZone.filter((r) => r.name === ZONE && r.type === 'MX');
  const m365Mx = mx.some((r) => /\.mail\.protection\.outlook\.com\.?$/i.test(r.rdata.trim()));
  const spf = inZone.filter((r) => r.name === ZONE && r.type === 'TXT' && /v=spf1/i.test(r.rdata));
  const m365Spf = spf.some((r) => /spf\.protection\.outlook\.com/i.test(r.rdata));
  const cname = (name) => inZone.some((r) => r.name === `${name}.${ZONE}` && r.type === 'CNAME');
  const dkim = ['selector1', 'selector2'].filter((s) => cname(`${s}._domainkey`));
  if (mx.length === 0) add('Z-06', 'WARN', 'no MX record at the apex: inbound mail has nowhere to go');
  else if (m365Mx) {
    add('Z-06', 'INFO', `Microsoft 365 mail: MX present, SPF ${m365Spf ? 'includes spf.protection.outlook.com' : 'does NOT include spf.protection.outlook.com'}, autodiscover ${cname('autodiscover') ? 'present' : 'missing'}, DKIM selectors ${dkim.length === 2 ? 'both present' : `${dkim.length} of 2 present`}`);
    if (!m365Spf) add('Z-06', 'WARN', 'the MX is Microsoft 365 but no SPF record includes spf.protection.outlook.com: outgoing mail may land in spam');
    if (!cname('autodiscover') || dkim.length < 2) add('Z-06', 'WARN', 'an autodiscover CNAME or a DKIM selector of Microsoft 365 is missing from the export');
  } else add('Z-06', 'INFO', 'the apex MX is not Microsoft 365 (the mail provider is something else: check it by hand)');

  // Z-07
  if (hasProxyInfo) {
    const proxied = inZone.filter((r) => r.proxied === true).map(label);
    add('Z-07', 'INFO', `${proxied.length} proxied record(s): ${proxied.join(', ') || 'none'}`);
  }
  return results;
}

export function render(results) {
  const lines = ['zone export check (offline: one file read, no network, nothing written)'];
  for (const r of results) lines.push(`${r.level.padEnd(4)} ${r.id.padEnd(4)} ${r.text}`);
  const fails = results.filter((r) => r.level === 'FAIL').length;
  const warns = results.filter((r) => r.level === 'WARN').length;
  lines.push(`-- ${fails} failed, ${warns} warnings`);
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------ the program

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export function main(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  const files = argv.filter((a) => !a.startsWith('--'));
  const flags = argv.filter((a) => a.startsWith('--'));
  const unknown = flags.filter((f) => f !== '--allow-wildcard');
  if (files.length !== 1 || unknown.length > 0) {
    err(`usage: node ../scripts/check-zone-export.mjs <export file> [--allow-wildcard]${unknown.length > 0 ? `\nunknown option ${unknown[0]}` : ''}\n`);
    return 2;
  }
  const file = path.resolve(files[0]);
  const relative = path.relative(repoRoot, file);
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    err('refused: the export holds the origin\'s address and is private. Keep it outside the repository (a password manager note, an encrypted folder) and pass that path.\n');
    return 2;
  }
  if (!existsSync(file)) {
    err(`refused: ${path.basename(file)} does not exist.\n`);
    return 2;
  }
  const results = checkZone(parseZoneExport(readFileSync(file, 'utf8')), { allowWildcard: flags.includes('--allow-wildcard') });
  out(`${render(results)}\n`);
  return results.some((r) => r.level === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
