import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECT, HOSTS } from '../../scripts/check-production-site.mjs';
import { PRODUCTION_ORIGINS, SPECS, WORKERS, readJsonc } from '../../scripts/production-deploy-command.mjs';
import { readRoot, repoRoot } from './helpers';

// docs/cloudflare/cutover-runbook.md section 14 (Phase A, SAKEM-104) is a procedure a person types from on the day, so its bookkeeping
// is held to the standard of code (as tests/staging-runbook.test.ts does for the staging runbook): every ID it uses exists, the IDs it
// defines are unique and in order, every link lands, every command names a script that exists, and what it says about the printers,
// the checker and the configuration is what they do. Nothing here talks to Cloudflare.

const docsDir = path.join(repoRoot, 'docs/cloudflare');
const runbook = readFileSync(path.join(docsDir, 'cutover-runbook.md'), 'utf8');
const lines = runbook.split('\n');
const start = lines.findIndex((l) => l.startsWith('## 14. '));
const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
const phaseA = lines.slice(start, end).join('\n');

/** The anchor GitHub gives a heading: lower case, punctuation dropped (hyphens and underscores stay), spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
const headingsOf = (text: string) => text.split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => l.replace(/^#+ /, ''));
const anchorsOf = (text: string) => {
  const seen = new Map<string, number>();
  return new Set(
    headingsOf(text.replace(/```[\s\S]*?```/g, '')).map((heading) => {
      const base = slug(heading);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n === 0 ? base : `${base}-${n}`;
    }),
  );
};
/** The cells of every table row of `text` whose first cell matches `first`. */
const rows = (text: string, first = /.*/) =>
  text.split('\n').flatMap((line) => {
    if (!/^\| /.test(line) || /^\| ---/.test(line)) return [];
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    return first.test(cells[0] ?? '') ? [cells] : [];
  });
const noFences = (text: string) => text.replace(/```[\s\S]*?```/g, '');

/** Every ID the document defines: the first cell of a table row, or a bold lead (`**PA-1: ...`). */
const defined = new Set<string>();
for (const cells of rows(runbook)) for (const id of cells[0]!.matchAll(/(?:[A-Z]{1,3}-\d{1,2}|H[12])\b/g)) defined.add(id[0]);
for (const m of runbook.matchAll(/\*\*([A-Z]{1,3}-\d{1,2})\b/g)) defined.add(m[1]!);

// IDs as they are written in the text; a time offset of the day ("T-72 h", "T-7 d") is not a test ID.
const ID = /(?<![A-Za-z-])(?:(?:P|S|T|C|M|X|F|R|D)-\d\d(?!\s?[hd]\b)|H[12]\b|RB-\d\b|(?:PA|DA)-\d\b|(?:SA|TA)-\d\d\b|RBA-\d\b)/g;

describe('section 14: the shape', () => {
  it('exists, with 14.1 to 14.12 in order, and sits between the risk register and the open decisions', () => {
    expect(start).toBeGreaterThan(0);
    const subs = lines.slice(start, end).filter((l) => /^### 14\.\d+ /.test(l)).map((l) => Number(/^### 14\.(\d+) /.exec(l)![1]));
    expect(subs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(lines.findIndex((l) => l.startsWith('## 13. '))).toBeLessThan(start);
    expect(lines[end]).toBe('## Open decisions for Dzul');
    // the sections before it keep their numbers: 0 to 13 once each, in order
    const numbered = lines.flatMap((l) => (/^## (\d+)\. /.test(l) ? [Number(/^## (\d+)\. /.exec(l)![1])] : []));
    expect(numbered).toEqual(Array.from({ length: 15 }, (_, i) => i));
  });

  it('the older sections point at it (the banner, the decisions, the open decisions, the sources) and the evidence table lists what was tested', () => {
    const before = lines.slice(0, start).join('\n') + lines.slice(end).join('\n');
    expect(before).toContain('PHASE A (decided by Dzul on 2026-10-15) DOES NOT WAIT FOR M4');
    expect(before).toContain('cutover Phase A.**');
    expect(before).toContain('| D-12 |');
    expect(before).toContain('production-scripts.test.ts');
    expect(before).toContain('wrangler deploy --help');
  });

  it('the IDs it defines are unique, and the steps and rollback steps are in ascending order', () => {
    for (const family of ['SA', 'TA', 'RBA', 'DA']) {
      const ids = rows(phaseA, new RegExp(`^${family}-\\d+$`)).map((cells) => cells[0]!);
      expect(ids.length, family).toBeGreaterThan(2);
      expect(new Set(ids).size, `${family} unique`).toBe(ids.length);
      if (family === 'SA' || family === 'RBA' || family === 'DA') expect(ids, `${family} ascending`).toEqual([...ids].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])));
    }
    for (const id of ['F-16', 'F-17', 'F-18', 'F-19', 'R-31', 'R-32', 'R-33', 'C-09']) expect(rows(phaseA, new RegExp(`^${id}$`)).length, id).toBe(1);
    expect(runbook).toContain('**PA-1:');
  });

  it('every ID the document uses is defined: the older families outside section 14, the Phase A families inside it', () => {
    const used = new Set(noFences(phaseA).match(ID) ?? []);
    expect(used.size).toBeGreaterThan(60);
    for (const id of used) expect(defined.has(id), id).toBe(true);
    // and the Phase A IDs are not used anywhere before it, where nothing defines them
    for (const id of (lines.slice(0, start).join('\n').match(ID) ?? [])) expect(defined.has(id), `before section 14: ${id}`).toBe(true);
  });

  it('every step and rollback row has the five or four cells of its table and a Who that starts with Dzul or agent', () => {
    for (const cells of rows(phaseA, /^SA-\d+$/)) {
      expect(cells.length, cells[0]).toBe(5);
      expect(/^(Dzul|agent)/.test(cells[4]!), `${cells[0]}: ${cells[4]}`).toBe(true);
    }
    for (const cells of rows(phaseA, /^RBA-\d+$/)) {
      expect(cells.length, cells[0]).toBe(4);
      expect(/^(Dzul|agent)/.test(cells[3]!), `${cells[0]}: ${cells[3]}`).toBe(true);
    }
  });
});

describe('section 14: links and commands', () => {
  const anchors = anchorsOf(runbook);

  it('every #anchor of the page lands on a heading, and every link to another page names a file and a heading that exist', () => {
    for (const m of noFences(runbook).matchAll(/\]\(#([^)\s]+)\)/g)) expect(anchors.has(m[1]!), `#${m[1]}`).toBe(true);
    const links = [...noFences(phaseA).matchAll(/\]\(([\w./-]+\.md)(?:#([^)\s]+))?\)/g)].map((m) => ({ file: m[1]!, anchor: m[2] }));
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const { file, anchor } of links) {
      const target = path.resolve(docsDir, file);
      expect(existsSync(target), file).toBe(true);
      if (anchor) expect(anchorsOf(readFileSync(target, 'utf8')).has(anchor), `${file}#${anchor}`).toBe(true);
    }
  });

  it('every `pnpm <script>` of a command is a script of cf/web or cf/admin', () => {
    const scripts = (rel: string) => Object.keys((JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8')) as { scripts: Record<string, string> }).scripts);
    const known = new Set([...scripts('cf/admin/package.json'), ...scripts('cf/web/package.json')]);
    const code = [...phaseA.matchAll(/```(?:bash|sh)?\n([\s\S]*?)```/g)].map((m) => m[1]!).join('\n');
    const names = [...code.matchAll(/(?:^|[\s&(])pnpm (?!exec\b|install\b|dlx\b)([a-z][\w:-]*\w)/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(10);
    for (const name of new Set(names)) expect(known.has(name), `pnpm ${name}`).toBe(true);
    for (const name of ['deploy:prod:dry', 'deploy:prod:command', 'build:prod', 'check:production', 'check:zone-export', 'test:negative:production']) {
      expect(known.has(name), name).toBe(true);
    }
  });

  it('every file the section names exists: the scripts, the examples, the fixture', () => {
    for (const rel of ['cf/scripts/check-production-site.mjs', 'cf/scripts/check-zone-export.mjs', 'cf/scripts/production-deploy-command.mjs', 'cf/scripts/production-dry-run.mjs', 'cf/web/production.vars.example', 'cf/admin/production.vars.example', 'cf/web/tests/production-site-fixture.ts']) {
      expect(existsSync(path.join(repoRoot, rel)), rel).toBe(true);
      expect(phaseA.includes(rel.replace(/^cf\/(web|admin)\//, '')) || phaseA.includes(rel), rel).toBe(true);
    }
  });

  it('no id, account value or workers.dev host of an account is written, and the only hostnames are the plan\'s and the generic ones the text talks about', () => {
    expect(phaseA).not.toMatch(/[0-9a-f]{32}/i);
    expect(phaseA).not.toMatch(/\b[a-z0-9][a-z0-9-]*\.[a-z0-9-]+\.workers\.dev/i);
    const hosts = new Set((noFences(phaseA).replace(/\$n\./g, '').replace(/\.test\.ts/g, '').match(/\b(?:[a-z0-9-]+\.)+(?:org|com|net|dev|test|io)\b/g) ?? []));
    const allowed = new Set(['sakolakembara.org', 'www.sakolakembara.org', 'admin.sakolakembara.org', 'files.sakolakembara.org', 'cache-test.sakolakembara.org', 'workers.dev', 'r2.dev', 'resend.dev', 'mail.protection.outlook.com', 'spf.protection.outlook.com']);
    for (const host of hosts) expect(allowed.has(host), host).toBe(true);
    for (const host of Object.values(HOSTS)) expect(phaseA, host).toContain(host);
  });
});

describe('section 14 says what the code does', () => {
  it('the variables table is the printers\' lists: every name, its Worker, required or optional', () => {
    const table = rows(phaseA).filter((cells) => cells.length === 4 && /^`[A-Z_]+`/.test(cells[0]!) && /^(admin|site|admin and site|none)/.test(cells[1]!));
    for (const [worker, label] of [['admin', 'admin'], ['web', 'site']] as const) {
      for (const spec of SPECS[worker]) {
        const row = table.find((cells) => cells[0]!.includes(`\`${spec.name}\``) && (cells[1] === label || cells[1] === 'admin and site'));
        expect(row, `${worker} ${spec.name}`).toBeDefined();
        expect(/required/.test(row![2]!), `${worker} ${spec.name} required`).toBe(spec.required);
        expect(/optional/.test(row![2]!), `${worker} ${spec.name} optional`).toBe(!spec.required);
      }
    }
    const never = table.find((cells) => cells[1] === 'none')!;
    for (const name of ['LEGACY_ORIGIN_URL', 'CONTENT_API_URL', 'CONTACT_API_URL', 'COOKIE_DOMAIN', 'TRUSTED_ORIGINS', 'ENVIRONMENT']) expect(never[0], name).toContain(name);
    // the three origins and the values the table gives
    for (const [name, value] of Object.entries(PRODUCTION_ORIGINS)) expect(phaseA, name).toContain(value);
    expect(phaseA).toContain('`PAGE_CACHE_SECONDS`');
  });

  it('the resource names are the top-level configurations\' names, and the printers\' names for the Workers', () => {
    const admin = readJsonc(readRoot('cf/admin/wrangler.jsonc'));
    const web = readJsonc(readRoot('cf/web/wrangler.jsonc'));
    const names = [admin.name, web.name, admin.d1_databases[0].database_name, ...admin.r2_buckets.map((b: { bucket_name: string }) => b.bucket_name)];
    expect(names).toEqual(['sakem-admin', 'sakola-kembara-web', 'sakem-admin', 'sakem-files', 'sakem-private']);
    const table = rows(phaseA).filter((cells) => ['Worker', 'D1', 'R2'].includes(cells[0]!));
    expect(table.map((cells) => cells[1])).toEqual(['`sakem-admin`', '`sakola-kembara-web`', '`sakem-admin`', '`sakem-files`', '`sakem-private`']);
    expect(WORKERS.admin.name).toBe(admin.name);
    expect(WORKERS.web.name).toBe(web.name);
    expect(admin.workers_dev).toBe(false);
    expect(web.workers_dev).toBe(false);
  });

  it('the Phase A values it quotes are the checker\'s: the HSTS value, the one request a second, the four hosts, the exit codes', () => {
    expect(phaseA).toContain(`\`strict-transport-security: ${EXPECT.hsts}\``);
    expect(phaseA).toContain('**one request per second**');
    expect(phaseA).toContain('0 all passed, 1 a check failed, 2 refused or bad arguments, 3 nothing answered');
    expect(readFileSync(path.join(repoRoot, 'cf/scripts/check-production-site.mjs'), 'utf8')).toContain('0 every check passed (warnings may exist)   1 at least one check failed   2 refused or bad arguments   3 nothing answered');
    expect(phaseA).toContain('**GET and nothing else**');
  });

  it('every ID the checker prints is a smoke test of the document, and the TA tests the table gives to the checker are the ones it prints', () => {
    const source = readFileSync(path.join(repoRoot, 'cf/scripts/check-production-site.mjs'), 'utf8');
    const emitted = new Set([...source.matchAll(/(?:verdict|add)\('((?:T|TA|C)-\d\d)'/g)].map((m) => m[1]!));
    expect(emitted.size).toBeGreaterThan(20);
    const smoke = lines.slice(lines.findIndex((l) => l.startsWith('### 14.7 ')), lines.findIndex((l) => l.startsWith('### 14.8 '))).join('\n');
    const checkerRows = rows(smoke).filter((cells) => cells.length === 4 && /checker/.test(cells[3]!));
    const expand = (cell: string) => {
      const out = new Set<string>();
      for (const m of cell.matchAll(/\b([A-Z]{1,2})-(\d\d) to \1-(\d\d)\b/g)) for (let n = Number(m[2]); n <= Number(m[3]); n++) out.add(`${m[1]}-${String(n).padStart(2, '0')}`);
      for (const m of cell.matchAll(/\b(?:[A-Z]{1,2})-\d\d\b/g)) out.add(m[0]);
      return out;
    };
    const documented = new Set(checkerRows.flatMap((cells) => [...expand(cells[0]!)]));
    for (const id of emitted) expect(documented.has(id), `${id} is printed by the checker but the table does not give it to the checker`).toBe(true);
    // the TA family exactly: every TA test the table gives to the checker is printed, and every printed TA test is in the table
    expect([...emitted].filter((id) => id.startsWith('TA-')).sort()).toEqual([...documented].filter((id) => id.startsWith('TA-')).sort());
    expect(rows(smoke, /^TA-0[1-6]$/).length).toBe(6);
    expect(rows(smoke, /^TA-07$/).length).toBe(0);
  });

  it("section 7's rows that SAKEM-103 and SAKEM-105 wrote (T-09, T-16, T-31, T-34, T-35, T-36, T-37) say what the checker expects, so the two documents do not contradict", () => {
    const section7 = lines.slice(0, start).join('\n');
    const row = (id: string) => rows(section7, new RegExp(`^${id}$`))[0]?.join(' | ') ?? '';
    expect(row('T-36')).toContain(`strict-transport-security: ${EXPECT.hsts}`);
    for (const path of ['`/`', '`/blog`', '`/daftar`', '`/no-such-page`', '`/robots.txt`']) expect(row('T-36'), path).toContain(path);
    expect(row('T-01')).toContain(`strict-transport-security: ${EXPECT.hsts}`);
    // T-31: the registration link and WordPress's own paths
    expect(row('T-31')).toContain('**307** to the registration form, `cache-control: no-store`');
    expect(row('T-31')).toContain('**308** to `/daftar`');
    expect(row('T-31')).toContain('`/Daftar`: 307');
    expect(row('T-31')).toContain('`/wp-login.php` 200');
    expect(row('T-31')).toContain('`/wp-admin/` 302 to the sign-in');
    expect(row('T-31')).toContain('`/login` 302 to `/wp-login.php`');
    expect(row('T-31')).toContain('`/wp-json/` 200 JSON');
    expect(row('T-31')).toContain(`none carries \`strict-transport-security: ${EXPECT.hsts}\` from the Worker`);
    // T-34: the five look-alikes the checker asks
    for (const lookAlike of ['/wp-adminx', '/wp-login', '/wp-login.php.bak', '/login/x', '/Login']) expect(row('T-34'), lookAlike).toContain(`\`${lookAlike}\``);
    expect(row('T-34')).toContain("the **site's 404 page**");
    // T-35: the three greps and the empty slot
    expect(row('T-35')).toContain('get-session');
    expect(row('T-35')).toContain('href="/portal/login"');
    expect(row('T-35')).toContain('justify-self-end');
    // T-37 (SAKEM-105): the reports are a section of Donasi, and /laporan is one hop to it
    expect(row('T-37')).toContain('`/donasi#laporan`');
    expect(row('T-37')).toContain('**one 308**');
    expect(row('T-37')).toContain('id=\"laporan\"');
    expect(row('T-37')).toContain('never a chain through `/laporan`');
    // T-16 and T-17: Phase A
    expect(row('T-16')).toContain('`/login` reaches **WordPress** (a 302 to `/wp-login.php`');
    expect(row('T-16')).toContain("`/register` and `/forgot-password` are the site's **404 page**");
    expect(row('T-17')).toContain("web Worker's **404 page**");
    // T-09: a copied upload is one hop
    expect(row('T-09')).toContain('**308** straight to `/blog/images/...`');
    // and the checker's own source says the same numbers
    const source = readFileSync(path.join(repoRoot, 'cf/scripts/check-production-site.mjs'), 'utf8');
    expect(source).toContain("daftar.headers['cache-control'] !== 'no-store'");
    expect(source).toContain('daftarSlash.status !== 308');
    expect(source).toContain('daftarCaps.status !== 307');
  });

  it('PORTAL_ENABLED is in the variables table as optional and `false`, the build line of the commands carries it, and the production example sets it to false', () => {
    expect(phaseA).toContain('WEB_ANALYTICS_BEACON_ID=<the id> GTM_CONTAINER_ID=<GTM-id> PORTAL_ENABLED=false pnpm build:prod');
    const row = rows(phaseA).find((cells) => cells[0] === '`PORTAL_ENABLED`')!;
    expect(row[1]).toBe('site');
    expect(row[2]).toBe('public var, optional');
    expect(row[3]).toContain('exactly `false` in Phase A');
    expect(readFileSync(path.join(repoRoot, 'cf/web/production.vars.example'), 'utf8')).toMatch(/^PORTAL_ENABLED=false$/m);
    expect(readFileSync(path.join(repoRoot, 'cf/admin/production.vars.example'), 'utf8')).not.toContain('PORTAL_ENABLED');
  });

  it('F-17 and F-18 are written as resolved, and no document of the repository calls the production site Worker `sakem-web`', () => {
    for (const id of ['F-17', 'F-18']) expect(rows(phaseA, new RegExp(`^${id}$`))[0]!.join(' '), id).toMatch(/^F-1[78] \*\*Resolved by SAKEM-103/);
    for (const rel of ['docs/cloudflare/cutover-runbook.md', 'docs/cloudflare/portal-architecture.md', 'docs/cloudflare/account-setup.md', 'docs/cloudflare/staging-runbook.md', 'docs/cloudflare/README.md', 'docs/cloudflare/web-skeleton.md']) {
      expect(readRoot(rel), rel).not.toMatch(/sakem-web([^-]|$)/);
    }
    expect(rows(phaseA, /^DA-7$/)[0]!.join(' ')).toContain('`sakola-kembara-web`');
  });

  it('the documented variables and dashboard rules never mention a staging value as a thing to set', () => {
    const settable = rows(phaseA).filter((cells) => cells.length === 4 && /^`[A-Z_]+`/.test(cells[0]!) && cells[1] !== 'none').map((cells) => cells.join(' '));
    for (const row of settable) expect(row, row).not.toMatch(/workers\.dev|r2\.dev|resend\.dev|staging/i);
  });
});
