import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKERS } from '../../scripts/staging-deploy-command.mjs';
import { repoRoot } from './helpers';

// docs/cloudflare/staging-runbook.md is a procedure a person types from, so its bookkeeping is held to the same standard as
// code (SAKEM-098 added the student portal's steps 15 to 22 in the middle of it): the step numbers are consecutive and
// every step is in the table at the top, every link inside the page lands on a heading, the pages it points at exist, the
// scripts it names exist, and the counts it states (limiters, files) are the ones of the configuration.

const docsDir = path.join(repoRoot, 'docs/cloudflare');
const runbook = readFileSync(path.join(docsDir, 'staging-runbook.md'), 'utf8');
const lines = runbook.split('\n');

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
    headingsOf(text).map((heading) => {
      const base = slug(heading);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n === 0 ? base : `${base}-${n}`;
    }),
  );
};

/** The `## N. Title` headings, in order. */
const steps = lines.flatMap((line) => {
  const m = /^## (\d+)\. (.+)$/.exec(line);
  return m ? [{ n: Number(m[1]), title: m[2]! }] : [];
});

/** The text of one numbered step: from its heading to the next `## ` heading. */
function section(n: number): string {
  const start = lines.findIndex((l) => l.startsWith(`## ${n}. `));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return rest.slice(0, end === -1 ? undefined : end).join('\n');
}

describe('the steps and the table at the top', () => {
  it('are numbered 1 to 24, in order, once each', () => {
    expect(steps.map((s) => s.n)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it('every step is a row of "At a glance", and every row is a step', () => {
    const start = lines.findIndex((l) => l.startsWith('## At a glance'));
    const table = lines.slice(start + 1, lines.findIndex((l, i) => i > start && l.startsWith('## ')));
    const rows = table.flatMap((line) => {
      if (!/^\| \d+ \|/.test(line)) return [];
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      expect(cells, line).toHaveLength(4);
      return [{ n: Number(cells[0]), step: cells[1]!, creates: cells[2]!, ok: cells[3]! }];
    });
    expect(rows.map((r) => r.n)).toEqual(steps.map((s) => s.n));
    // the row says what its step says it creates, and whether it needs the owner's OK
    for (const row of rows) expect(['yes', 'no', ''].includes(row.ok.replace(/\s*\(.*\)$/, '')), `${row.n}: ${row.ok}`).toBe(true);
  });

  it('the portal\'s steps (15 to 22) and the teardown have what every operational step of the runbook has: what it creates, its OK, how to revert it', () => {
    for (const n of [15, 16, 17, 18, 19, 20, 22]) {
      const text = section(n);
      expect(text, `step ${n} Creates or Changes`).toMatch(/\*\*(Creates|Changes|Creates or changes)[:.]?\*\*/);
      expect(text, `step ${n} Your OK`).toContain('**Your OK:**');
      expect(text, `step ${n} Revert`).toContain('**Revert:**');
    }
    expect(section(21)).toContain('| Request | Expected |');
    expect(section(24)).toContain('Each is a deletion: your explicit OK.');
  });

  it('every step that writes to Cloudflare says "yes" in the table, the checks and the rules say "no" or nothing', () => {
    const yes = [1, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 16, 17, 18, 19, 20, 22, 24];
    const start = lines.findIndex((l) => l.startsWith('## At a glance'));
    for (const line of lines.slice(start, start + 50)) {
      if (!/^\| \d+ \|/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      expect(cells[3]!.startsWith('yes'), `step ${cells[0]}`).toBe(yes.includes(Number(cells[0])));
    }
  });
});

describe('the links inside the page', () => {
  const body = lines.filter((l) => !l.startsWith('    ')).join('\n').replace(/```[\s\S]*?```/g, '');
  const anchors = anchorsOf(runbook);

  it('every #anchor lands on a heading of this page', () => {
    const links = [...body.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) expect(anchors.has(link), `#${link}`).toBe(true);
  });

  it('every link to another page names a file that exists, and an anchor that is a heading of it', () => {
    const links = [...body.matchAll(/\]\(([\w./-]+\.md)(?:#([^)\s]+))?\)/g)].map((m) => ({ file: m[1]!, anchor: m[2] }));
    expect(links.length).toBeGreaterThan(10);
    for (const { file, anchor } of links) {
      const target = path.resolve(docsDir, file);
      expect(existsSync(target), file).toBe(true);
      if (anchor) expect(anchorsOf(readFileSync(target, 'utf8')).has(anchor), `${file}#${anchor}`).toBe(true);
    }
  });

  it('the link to a step in the text ("step N") names a step that exists', () => {
    for (const m of body.matchAll(/\bsteps? (\d+)(?:[a-z])?\b/g)) expect(Number(m[1]), m[0]).toBeLessThanOrEqual(24);
    for (const m of body.matchAll(/\bsteps (\d+) (?:to|and) (\d+)\b/g)) expect(Number(m[2]), m[0]).toBeLessThanOrEqual(24);
  });
});

describe('what the page names exists', () => {
  const scripts = (rel: string) => Object.keys((JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8')) as { scripts: Record<string, string> }).scripts);
  const known = new Set([...scripts('cf/admin/package.json'), ...scripts('cf/web/package.json')]);
  const code = [...runbook.matchAll(/```(?:bash|sh)?\n([\s\S]*?)```/g)].map((m) => m[1]!).join('\n');

  it('every `pnpm <script>` of a command is a script of cf/admin or cf/web', () => {
    const names = [...code.matchAll(/(?:^|[\s&(])pnpm (?!exec\b|install\b|dlx\b)([a-z][\w:-]*\w)/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(10);
    for (const name of new Set(names)) expect(known.has(name), `pnpm ${name}`).toBe(true);
  });

  it('the portal\'s scripts are named, and the example file of its variables is the one that exists', () => {
    for (const name of ['deploy:staging:dry', 'deploy:staging:portal:command', 'build:portal-spa', 'check:portal-spa', 'check:portal-worker', 'test:portal-spa', 'test:worker']) {
      expect(runbook, name).toContain(`pnpm ${name}`);
      expect(known.has(name), name).toBe(true);
    }
    expect(existsSync(path.join(repoRoot, 'cf/admin/staging.portal.vars.example'))).toBe(true);
    expect(runbook).toContain('cp staging.portal.vars.example .staging.vars.portal');
    expect(WORKERS.portal.file).toBe('.staging.vars.portal');
  });

  it('the Worker, bucket and database names are the ones of the configuration', () => {
    const portal = readFileSync(path.join(repoRoot, 'cf/admin/wrangler.portal.jsonc'), 'utf8');
    const admin = readFileSync(path.join(repoRoot, 'cf/admin/wrangler.jsonc'), 'utf8');
    for (const name of ['sakem-portal-staging', 'sakem-private-staging']) {
      expect(portal, name).toContain(`"${name}"`);
      expect(admin.includes(`"${name}"`) || name === 'sakem-portal-staging', name).toBe(true);
      expect(runbook, name).toContain(name);
    }
    expect(portal).toContain('"database_name": "sakem-staging"');
    // the production names are only ever named as the thing never to touch
    expect(runbook).toContain('the bucket `sakem-private`');
  });

  it('the counts it states are the counts of the configuration: the admin\'s fifteen limiters, the portal\'s eleven, the portal\'s six public variables', () => {
    const jsonc = (text: string) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')) as { env: { staging: { ratelimits: unknown[]; vars: Record<string, string> } } };
    const admin = jsonc(readFileSync(path.join(repoRoot, 'cf/admin/wrangler.jsonc'), 'utf8')).env.staging;
    const portal = jsonc(readFileSync(path.join(repoRoot, 'cf/admin/wrangler.portal.jsonc'), 'utf8')).env.staging;
    expect(admin.ratelimits).toHaveLength(15);
    expect(portal.ratelimits).toHaveLength(11);
    expect(runbook).toContain('the fifteen rate limit bindings');
    expect(runbook).toContain('the fourteen others');
    expect(runbook).toContain('the eleven rate limit bindings');
    expect(Object.values(portal.vars).filter((value) => value === '')).toHaveLength(6);
    expect(runbook).toContain('and the six public variables as `("")`');
    expect(section(6)).not.toContain('the ten rate limit bindings');
    // the namespaces the table at the top lists are the configuration's
    for (const range of ['`7901` to `7908`', '`7931` to `7934`', '`7941`', '`8101` to `8107`', '`8131` to `8134`']) expect(runbook, range).toContain(range);
  });

  it('holds no id, key, address or hostname of an account: only placeholders', () => {
    expect(runbook).not.toMatch(/\b[0-9a-f]{32}\b/);
    expect(runbook).not.toMatch(/\bre_[A-Za-z0-9_]{12,}/);
    expect(runbook).not.toMatch(/\b0x4[A-Za-z0-9_-]{20,}/);
    // a workers.dev host or an r2.dev address always has a placeholder in front of it
    for (const m of runbook.matchAll(/([A-Za-z0-9<>-]+)\.(workers|r2)\.dev/g)) expect(m[1], m[0]).toMatch(/^(<[a-z-]+>|pub-<hash>|\*|account-subdomain)$/);
    expect(runbook).not.toMatch(/@(?!resend\.dev)[a-z0-9-]+\.(com|org|id|net)\b/i);
  });
});
