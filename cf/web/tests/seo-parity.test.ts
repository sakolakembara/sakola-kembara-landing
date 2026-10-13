// Unit tests of the SEO parity tool (scripts/seo-parity.mjs and its two libraries). NO network: the network
// source is driven by a fake `fetch`, the offline mode reads recorded directories written into a temp folder
// (and one small committed sample, tests/fixtures/seo-parity/sample), and the report is read back from disk.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as core from '../scripts/lib/seo-parity-core.mjs';
import * as sources from '../scripts/lib/seo-parity-sources.mjs';
import { HELP, MAIN_PATHS, UsageError, main, parseCli, planRun, readSitemaps, runFromOptions } from '../scripts/seo-parity.mjs';
import { ARTICLE_COUNT, blogPosts, readRoot, webRoot } from './helpers';

const tmp = mkdtempSync(path.join(tmpdir(), 'sakem-seo-parity-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ---------------------------------------------------------------- HTML builders

const LIVE = 'https://live.example.test';
const STAGING = 'https://staging.example.test';

interface Page {
  title?: string | null;
  description?: string | null;
  canonical?: string | null;
  robots?: string | null;
  googlebot?: string | null;
  h1?: string[];
  og?: Record<string, string | null>;
  twitter?: Record<string, string | null>;
  lang?: string | null;
  ld?: unknown[] | null;
  hreflang?: string[];
  amp?: string | null;
  extraHead?: string;
}

/** A page with every signal set, overridden per case; `null` leaves a field out. */
function html(p: string, o: Page = {}): string {
  const canonical = o.canonical === undefined ? `${LIVE}${p}` : o.canonical;
  const og: Record<string, string | null> = { title: 'Halaman', description: 'Deskripsi halaman', image: `${LIVE}/img/a.jpg`, url: canonical ?? `${LIVE}${p}`, type: 'website', ...o.og };
  const twitter: Record<string, string | null> = { card: 'summary_large_image', title: 'Halaman', ...o.twitter };
  const lang = o.lang === undefined ? 'id-ID' : o.lang;
  const ld = o.ld === undefined ? [{ '@context': 'https://schema.org', '@type': 'Article', headline: 'Halaman', datePublished: '2026-05-21' }] : o.ld;
  const h1 = o.h1 ?? ['Halaman'];
  return [
    `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head>`,
    o.title === null ? '' : `<title>${o.title ?? 'Halaman | Sakola Kembara'}</title>`,
    o.description === null ? '' : `<meta name="description" content="${o.description ?? 'Deskripsi halaman'}">`,
    canonical === null ? '' : `<link rel="canonical" href="${canonical}">`,
    o.robots === null ? '' : `<meta name="robots" content="${o.robots ?? 'index, follow'}">`,
    o.googlebot ? `<meta name="googlebot" content="${o.googlebot}">` : '',
    ...Object.entries(og).map(([k, v]) => (v === null ? '' : `<meta property="og:${k}" content="${v}">`)),
    ...Object.entries(twitter).map(([k, v]) => (v === null ? '' : `<meta name="twitter:${k}" content="${v}">`)),
    ...(o.hreflang ?? []).map((l) => `<link rel="alternate" hreflang="${l}" href="${LIVE}/${l}${p}">`),
    o.amp ? `<link rel="amphtml" href="${o.amp}">` : '',
    ld ? ld.map((n) => `<script type="application/ld+json">${JSON.stringify(n)}</script>`).join('') : '',
    o.extraHead ?? '',
    '</head><body>',
    ...h1.map((t) => `<h1>${t}</h1>`),
    '<p>isi</p></body></html>',
  ].join('\n');
}

type Entry = { status: number; location?: string; html?: string; type?: string; headers?: Record<string, string>; error?: string; text?: string };

/** Writes a recorded directory: manifest.json plus one file per body. */
function writeSide(dir: string, base: string, entries: Record<string, Entry>): string {
  mkdirSync(path.join(dir, 'bodies'), { recursive: true });
  const manifest: Record<string, unknown> = {};
  let n = 0;
  for (const [key, e] of Object.entries(entries)) {
    if (e.error) {
      manifest[key] = { error: e.error };
      continue;
    }
    const entry: Record<string, unknown> = { status: e.status };
    const body = e.html ?? e.text;
    if (e.location) entry.headers = { ...e.headers, location: e.location };
    else if (e.headers) entry.headers = e.headers;
    if (body !== undefined) {
      entry.contentType = e.type ?? (e.html !== undefined ? 'text/html; charset=UTF-8' : 'text/plain');
      const file = `bodies/${n++}.txt`;
      writeFileSync(path.join(dir, file), body);
      entry.file = file;
    } else if (e.type) entry.contentType = e.type;
    manifest[key] = entry;
  }
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, base, entries: manifest }, null, 2));
  return dir;
}

const urlset = (paths: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${LIVE}${p}</loc></url>`).join('')}</urlset>`;

// ---------------------------------------------------------------- the classification table

interface Case {
  path: string;
  live?: Entry | Record<string, Entry>;
  cand?: Entry | Record<string, Entry>;
  /** Paths the candidate sitemap lists (default: the live path). */
  candSitemap?: string[] | 'none';
  expect: string[];
  absent?: string[];
  verdict: 'ok' | 'info' | 'warn' | 'blocker' | 'skipped';
}

const page = (p: string, o?: Page, extra: Partial<Entry> = {}): Entry => ({ status: 200, html: html(p, o), ...extra });
const isEntryMap = (v: unknown): v is Record<string, Entry> => typeof v === 'object' && v !== null && !('status' in v) && !('error' in v);

const CASES: Case[] = [
  { path: '/ok/', expect: [], verdict: 'ok' },
  {
    path: '/moved/',
    cand: { '/moved/': { status: 308, location: '/new/moved' }, '/new/moved': page('/new/moved', { title: 'Halaman - Sakola Kembara' }) },
    candSitemap: ['/new/moved'],
    expect: ['address-moved', 'title-suffix-changed'], absent: ['redirect-chain', 'canonical-other-url'], verdict: 'info',
  },
  { path: '/not-recorded/', cand: { error: 'not-recorded', status: 0 }, expect: ['status-mismatch'], verdict: 'blocker' },
  { path: '/url-missing/', cand: { status: 404, html: '<html><head><title>x</title></head></html>' }, expect: ['url-missing'], verdict: 'blocker' },
  {
    path: '/redirect-to-missing/',
    cand: { '/redirect-to-missing/': { status: 308, location: '/gone' }, '/gone': { status: 404, html: '<title>x</title>' } },
    expect: ['redirect-to-missing'], verdict: 'blocker',
  },
  {
    path: '/folded-missing/',
    cand: { '/folded-missing/': { status: 308, location: '/folded-missing' }, '/folded-missing': { status: 404, html: '<title>nf</title>' } },
    expect: ['url-missing'], absent: ['redirect-to-missing'], verdict: 'blocker',
  },
  { path: '/server-error/', cand: { status: 500, html: '<title>boom</title>' }, expect: ['status-mismatch'], verdict: 'blocker' },
  { path: '/timeout/', cand: { error: 'timeout', status: 0 }, expect: ['status-mismatch'], verdict: 'blocker' },
  {
    path: '/loop/',
    cand: { '/loop/': { status: 308, location: '/loop-b' }, '/loop-b': { status: 308, location: '/loop/' } },
    expect: ['redirect-loop'], verdict: 'blocker',
  },
  { path: '/no-canonical/', cand: page('/no-canonical/', { canonical: null }), expect: ['canonical-missing'], verdict: 'blocker' },
  { path: '/other-canonical/', cand: page('/other-canonical/', { canonical: `${LIVE}/elsewhere` }), expect: ['canonical-other-url'], verdict: 'blocker' },
  { path: '/staging-canonical/', cand: page('/staging-canonical/', { canonical: `${STAGING}/staging-canonical/` }), expect: ['canonical-host'], absent: ['canonical-other-url'], verdict: 'blocker' },
  { path: '/www-canonical/', cand: page('/www-canonical/', { canonical: 'https://www.live.example.test/www-canonical/' }), expect: ['canonical-host'], verdict: 'blocker' },
  { path: '/canonical-scheme/', cand: page('/canonical-scheme/', { canonical: 'http://live.example.test/canonical-scheme/' }), expect: ['canonical-other-url'], verdict: 'blocker' },
  {
    path: '/live-canonical-elsewhere/',
    live: page('/live-canonical-elsewhere/', { canonical: `${LIVE}/target` }),
    cand: page('/live-canonical-elsewhere/', { canonical: `${LIVE}/target` }),
    expect: [], absent: ['canonical-other-url'], verdict: 'ok',
  },
  { path: '/noindex/', cand: page('/noindex/', { robots: 'noindex, nofollow' }), expect: ['noindex-introduced'], verdict: 'blocker' },
  { path: '/noindex-googlebot/', cand: page('/noindex-googlebot/', { googlebot: 'noindex' }), expect: ['noindex-introduced'], verdict: 'blocker' },
  { path: '/x-robots/', cand: page('/x-robots/', {}, { headers: { 'x-robots-tag': 'noindex' } }), expect: ['noindex-introduced'], verdict: 'blocker' },
  { path: '/x-robots-agent/', cand: page('/x-robots-agent/', {}, { headers: { 'x-robots-tag': 'googlebot: noindex' } }), expect: ['noindex-introduced'], verdict: 'blocker' },
  {
    path: '/both-noindex/',
    live: page('/both-noindex/', { robots: 'noindex' }),
    cand: page('/both-noindex/', { robots: 'noindex', canonical: null }),
    expect: [], absent: ['noindex-introduced', 'canonical-missing'], verdict: 'ok',
  },
  { path: '/nofollow/', cand: page('/nofollow/', { robots: 'index, nofollow' }), expect: ['nofollow-introduced'], verdict: 'warn' },
  { path: '/title-changed/', live: page('/title-changed/', { title: 'Tim - Sakola Kembara' }), cand: page('/title-changed/', { title: 'Tim Kami | Sakola Kembara' }), expect: ['title-changed'], absent: ['title-suffix-changed'], verdict: 'warn' },
  { path: '/title-entities/', live: page('/title-entities/', { title: 'Beasiswa &amp; Bimbel &#8211; Sakola Kembara' }), cand: page('/title-entities/', { title: 'Beasiswa & Bimbel | Sakola Kembara' }), expect: ['title-suffix-changed'], absent: ['title-changed'], verdict: 'info' },
  // SAKEM-090: the live WordPress pages end in the foundation's full name; a page without that suffix against the same page with it
  // is a suffix difference (info), the same suffix on both sides is no difference at all, and a real difference still warns.
  { path: '/title-legal-name/', live: page('/title-legal-name/', { title: 'Tim Kami' }), cand: page('/title-legal-name/', { title: 'Tim Kami - Yayasan Sakola Kembara Indonesia' }), expect: ['title-suffix-changed'], absent: ['title-changed'], verdict: 'info' },
  { path: '/title-legal-name-same/', live: page('/title-legal-name-same/', { title: 'Tim Kami - Yayasan Sakola Kembara Indonesia' }), cand: page('/title-legal-name-same/', { title: 'Tim Kami - Yayasan Sakola Kembara Indonesia' }), expect: [], absent: ['title-changed', 'title-suffix-changed'], verdict: 'ok' },
  { path: '/title-legal-name-other/', live: page('/title-legal-name-other/', { title: 'Pengurus - Yayasan Sakola Kembara Indonesia' }), cand: page('/title-legal-name-other/', { title: 'Tim Kami - Yayasan Sakola Kembara Indonesia' }), expect: ['title-changed'], verdict: 'warn' },
  { path: '/desc-changed/', cand: page('/desc-changed/', { description: 'Lain' }), expect: ['description-changed'], verdict: 'warn' },
  { path: '/desc-missing/', cand: page('/desc-missing/', { description: null }), expect: ['description-missing'], verdict: 'warn' },
  { path: '/desc-added/', live: page('/desc-added/', { description: null }), cand: page('/desc-added/'), expect: ['description-added'], verdict: 'info' },
  {
    path: '/jsonld-dropped/',
    live: page('/jsonld-dropped/', {
      ld: [{ '@context': 'https://schema.org', '@graph': [{ '@type': 'Article', headline: 'Halaman', datePublished: '2026-05-21' }, { '@type': 'BreadcrumbList' }, { '@type': 'WebPage' }, { '@type': 'ImageObject' }] }],
    }),
    cand: page('/jsonld-dropped/'),
    expect: ['jsonld-type-dropped', 'jsonld-structural-dropped'], verdict: 'warn',
  },
  {
    path: '/org-dropped/',
    live: page('/org-dropped/', { ld: [{ '@type': 'Article', headline: 'Halaman', datePublished: '2026-05-21' }, { '@type': 'Organization', name: 'Sakola Kembara' }] }),
    cand: page('/org-dropped/'),
    expect: ['jsonld-structural-dropped'], absent: ['jsonld-type-dropped'], verdict: 'info',
  },
  {
    path: '/',
    live: page('/', { ld: [{ '@type': 'Organization', name: 'Sakola Kembara' }] }),
    cand: page('/', { ld: [{ '@type': 'WebSite', name: 'Sakola Kembara' }] }),
    expect: ['jsonld-type-dropped'], verdict: 'warn',
  },
  { path: '/jsonld-added/', live: page('/jsonld-added/', { ld: null }), cand: page('/jsonld-added/'), expect: ['jsonld-type-added'], verdict: 'info' },
  {
    path: '/jsonld-article-family/',
    live: page('/jsonld-article-family/', { ld: [{ '@type': 'NewsArticle', headline: 'Halaman', datePublished: '2026-05-21' }] }),
    cand: page('/jsonld-article-family/'),
    expect: [], absent: ['jsonld-type-dropped', 'jsonld-type-added'], verdict: 'ok',
  },
  {
    path: '/jsonld-field/',
    live: page('/jsonld-field/', { ld: [{ '@type': 'Article', headline: 'Halaman', datePublished: '2026-05-21T10:00:00+00:00' }] }),
    cand: page('/jsonld-field/', { ld: [{ '@type': 'Article', headline: 'Halaman', datePublished: '2026-05-22' }] }),
    expect: ['jsonld-field-changed'], verdict: 'warn',
  },
  {
    path: '/jsonld-date-format/',
    live: page('/jsonld-date-format/', { ld: [{ '@type': 'Article', headline: 'Halaman', datePublished: '2026-05-21T10:00:00+00:00' }] }),
    cand: page('/jsonld-date-format/', { ld: [{ '@type': 'Article', headline: 'Halaman', datePublished: '2026-05-21' }] }),
    expect: [], absent: ['jsonld-field-changed'], verdict: 'ok',
  },
  { path: '/jsonld-invalid/', cand: page('/jsonld-invalid/', { ld: null, extraHead: '<script type="application/ld+json">{ not json</script>' }), live: page('/jsonld-invalid/', { ld: null }), expect: ['jsonld-invalid'], verdict: 'warn' },
  {
    path: '/temp-redirect/',
    cand: { '/temp-redirect/': { status: 307, location: '/dest' }, '/dest': page('/dest') },
    candSitemap: ['/dest'],
    expect: ['redirect-temporary'], verdict: 'warn',
  },
  {
    path: '/chain/',
    cand: { '/chain/': { status: 308, location: '/hop' }, '/hop': { status: 308, location: '/final' }, '/final': page('/final') },
    candSitemap: ['/final'],
    expect: ['redirect-chain'], absent: ['address-moved'], verdict: 'warn',
  },
  {
    path: '/dropped/',
    live: { '/dropped/': { status: 301, location: '/dropped-target/' }, '/dropped-target/': page('/dropped-target/', { title: 'Lain | Sakola Kembara', description: 'Lain', h1: ['Lain'] }) },
    cand: page('/dropped/'),
    expect: ['live-redirect-dropped'], absent: ['redirect-shape-changed', 'address-moved', 'title-changed', 'description-changed', 'h1-text-changed', 'og-changed'], verdict: 'warn',
  },
  {
    path: '/q/?utm_source=x',
    live: page('/q/?utm_source=x', { canonical: `${LIVE}/q/` }),
    cand: page('/q/?utm_source=x', { canonical: `${LIVE}/q/` }),
    candSitemap: ['/q/?utm_source=x'],
    expect: [], absent: ['canonical-other-url'], verdict: 'ok',
  },
  {
    path: '/slash/',
    cand: { '/slash/': { status: 308, location: '/slash' }, '/slash': page('/slash', { canonical: `${LIVE}/slash` }) },
    candSitemap: ['/slash'],
    expect: ['redirect-shape-changed'], absent: ['address-moved', 'canonical-other-url'], verdict: 'info',
  },
  { path: '/og-missing/', cand: page('/og-missing/', { og: { image: null, title: null } }), expect: ['og-missing'], verdict: 'warn' },
  { path: '/og-url-mismatch/', cand: page('/og-url-mismatch/', { og: { url: `${LIVE}/something-else` } }), expect: ['og-url-mismatch'], verdict: 'warn' },
  {
    path: '/jsonld-minor/',
    live: page('/jsonld-minor/', { ld: [{ '@type': 'Article', headline: 'Halaman', datePublished: '2026-05-21', author: { '@type': 'Person', name: 'Deanita' } }] }),
    cand: page('/jsonld-minor/', { ld: [{ '@type': 'Article', headline: 'Halaman', datePublished: '2026-05-21', author: { '@type': 'Organization', name: 'Sakola Kembara' } }] }),
    expect: ['jsonld-minor-field-changed'], absent: ['jsonld-field-changed'], verdict: 'info',
  },
  { path: '/og-twitter-card/', cand: page('/og-twitter-card/', { twitter: { card: null } }), expect: ['twitter-card-missing'], verdict: 'warn' },
  { path: '/h1-missing/', cand: page('/h1-missing/', { h1: [] }), expect: ['h1-missing'], verdict: 'warn' },
  { path: '/h1-multiple/', cand: page('/h1-multiple/', { h1: ['Satu', 'Dua'] }), expect: ['h1-multiple'], verdict: 'warn' },
  { path: '/h1-text/', cand: page('/h1-text/', { h1: ['Lain'] }), expect: ['h1-text-changed'], verdict: 'info' },
  { path: '/lang-changed/', cand: page('/lang-changed/', { lang: 'en' }), expect: ['lang-changed'], verdict: 'warn' },
  { path: '/lang-region/', cand: page('/lang-region/', { lang: 'id' }), expect: ['lang-region-changed'], absent: ['lang-changed'], verdict: 'info' },
  {
    path: '/info-only/',
    live: page('/info-only/', { robots: 'index, follow, max-image-preview:large', og: { image: `${LIVE}/img/old.jpg` }, twitter: { title: 'Lama' } }),
    cand: page('/info-only/'),
    expect: ['og-changed', 'robots-meta-changed'], verdict: 'info',
  },
  { path: '/hreflang/', live: page('/hreflang/', { hreflang: ['en'] }), cand: page('/hreflang/'), expect: ['hreflang-dropped'], verdict: 'warn' },
  { path: '/amp/', live: page('/amp/', { amp: `${LIVE}/amp/amp/` }), cand: page('/amp/'), expect: ['amp-link-live'], verdict: 'warn' },
  { path: '/not-in-sitemap/', candSitemap: [], expect: ['not-in-candidate-sitemap'], verdict: 'warn' },
  { path: '/soft-404/', cand: page('/soft-404/', { title: 'Halaman tidak ditemukan | Sakola Kembara' }), expect: ['soft-404-suspect'], verdict: 'warn' },
  { path: '/staging-leak/', cand: page('/staging-leak/', { og: { url: `${STAGING}/staging-leak/` } }), expect: ['staging-host-leak'], verdict: 'warn' },
  {
    path: '/file.pdf',
    live: { status: 200, type: 'application/pdf' },
    cand: { status: 200, html: '<html><body>not a pdf</body></html>' },
    candSitemap: 'none',
    expect: ['content-type-changed'], verdict: 'warn',
  },
  { path: '/robots-blocked/', cand: { error: 'not-recorded', status: 0 }, expect: ['robots-txt-blocks-url'], absent: ['status-mismatch'], verdict: 'blocker' },
  { path: '/live-robots-disallowed/', expect: ['skipped-by-robots'], verdict: 'skipped' },
  { path: '/live-404/', live: { status: 404, html: '<title>nf</title>' }, cand: { status: 404, html: '<title>nf</title>' }, candSitemap: 'none', expect: [], verdict: 'ok' },
  { path: '/live-404-cand-200/', live: { status: 404, html: '<title>nf</title>' }, cand: page('/live-404-cand-200/'), candSitemap: 'none', expect: ['served-where-live-404'], verdict: 'info' },
  { path: '/live-404-soft/', live: { status: 404, html: '<title>nf</title>' }, cand: page('/live-404-soft/', { title: '404 | Sakola Kembara' }), candSitemap: 'none', expect: ['served-where-live-404', 'soft-404-suspect'], verdict: 'warn' },
  { path: '/live-500/', live: { status: 500, html: '<title>boom</title>' }, candSitemap: 'none', expect: ['live-not-200'], verdict: 'info' },
  { path: '/live-error/', live: { error: 'timeout', status: 0 }, candSitemap: 'none', expect: ['live-unreachable'], verdict: 'info' },
  { path: '/live-redirect-external/', live: { '/live-redirect-external/': { status: 301, location: 'https://elsewhere.example.net/x' } }, candSitemap: 'none', expect: ['live-unreachable'], verdict: 'info' },
];

function buildRun(name: string, cases: Case[], tweak: { candRobots?: string; liveRobots?: string; candSitemapStatus?: 'none' } = {}) {
  const root = path.join(tmp, name);
  const liveEntries: Record<string, Entry> = {};
  const candEntries: Record<string, Entry> = {};
  const candSitemap: string[] = [];
  const liveSitemap: string[] = [];
  for (const c of cases) {
    liveSitemap.push(c.path);
    const live = c.live ?? page(c.path);
    if (isEntryMap(live)) Object.assign(liveEntries, live);
    else liveEntries[c.path] = live;
    const cand = c.cand ?? page(c.path);
    if (isEntryMap(cand)) Object.assign(candEntries, cand);
    else candEntries[c.path] = cand;
    if (c.candSitemap === undefined) candSitemap.push(c.path);
    else if (c.candSitemap !== 'none') candSitemap.push(...c.candSitemap);
  }
  liveEntries['/robots.txt'] = { status: 200, text: tweak.liveRobots ?? 'User-agent: *\nDisallow: /wp-admin/\nDisallow: /live-robots-disallowed/\n' };
  candEntries['/robots.txt'] = { status: 200, text: tweak.candRobots ?? 'User-agent: *\nAllow: /\nDisallow: /portal\nDisallow: /robots-blocked/\n' };
  liveEntries['/sitemap.xml'] = { status: 200, text: urlset(liveSitemap), type: 'application/xml' };
  candEntries['/sitemap.xml'] = tweak.candSitemapStatus === 'none' ? { status: 404, html: '<title>nf</title>' } : { status: 200, text: urlset(candSitemap), type: 'application/xml' };
  const liveDir = writeSide(path.join(root, 'live'), LIVE, liveEntries);
  const candDir = writeSide(path.join(root, 'candidate'), STAGING, candEntries);
  return { liveDir, candDir, out: path.join(root, 'out') };
}

async function run(name: string, cases: Case[], tweak = {}) {
  const { liveDir, candDir, out } = buildRun(name, cases, tweak);
  const options = parseCli(['--live-dir', liveDir, '--candidate-dir', candDir, '--no-main', '--no-articles', '--no-wp-ids', '--out', out, '--quiet']);
  const result = await runFromOptions(options as never, { log: () => {} });
  return { result, out };
}

describe('classification: one fixture per finding', async () => {
  const { result } = await run('table', CASES);
  const byPath = new Map(result.json.results.map((r: { path: string }) => [r.path, r]));

  it('compared every case', () => {
    expect(result.json.results).toHaveLength(CASES.length);
  });

  it.each(CASES.map((c) => [c.path, c] as const))('%s', (p, c) => {
    const r = byPath.get(p) as { findings: { code: string; severity: string }[]; verdict: string };
    expect(r, `no result for ${p}`).toBeDefined();
    const codes = r.findings.map((f) => f.code);
    for (const code of c.expect) expect(codes, `${p} should have ${code}; got ${codes.join(', ')}`).toContain(code);
    for (const code of c.absent ?? []) expect(codes, `${p} should not have ${code}`).not.toContain(code);
    if (c.expect.length === 0 && !c.absent) expect(codes).toEqual([]);
    expect(r.verdict, `${p}: ${codes.join(', ')}`).toBe(c.verdict);
    // the severity of every finding is the one of the table
    for (const f of r.findings) expect(f.severity).toBe(core.SEVERITY[f.code as keyof typeof core.SEVERITY].severity);
  });

  it('every finding code of the table is exercised by at least one fixture (site-level ones have their own tests)', () => {
    const exercised = new Set(result.json.results.flatMap((r: { findings: { code: string }[] }) => r.findings.map((f) => f.code)));
    const siteLevel = new Set(['robots-txt-blocks-all', 'candidate-sitemap-unavailable']);
    const missing = Object.keys(core.SEVERITY).filter((c) => !exercised.has(c) && !siteLevel.has(c));
    expect(missing).toEqual([]);
  });

  it('the verdict is FAIL while a blocker exists, and the counts add up', () => {
    const s = result.summary;
    expect(s.pass).toBe(false);
    expect(s.blocker + s.warn + s.info + s.ok + s.skipped).toBe(CASES.length);
    expect(s.blocker).toBe(CASES.filter((c) => c.verdict === 'blocker').length);
    expect(s.skipped).toBe(1);
  });

  it('a path disallowed for this tool by the LIVE robots.txt is never asked for on either side', async () => {
    const r = byPath.get('/live-robots-disallowed/') as { candidate: { final: unknown } | null };
    expect(r.candidate?.final ?? null).toBeNull();
  });
});

describe('site-level checks', () => {
  const one: Case[] = [{ path: '/ok/', expect: [], verdict: 'ok' }];

  it('a candidate robots.txt that disallows everything is a blocker the live site does not have', async () => {
    const { result } = await run('site-robots', one, { candRobots: 'User-agent: *\nDisallow: /\n' });
    expect(result.json.site.findings.map((f: { code: string }) => f.code)).toContain('robots-txt-blocks-all');
    expect(result.summary.pass).toBe(false);
    expect(result.summary.siteBlockers).toBe(1);
    expect(result.exitCode).toBe(1);
  });

  it('the same Disallow: / on both sides is not a finding', async () => {
    const { result } = await run('site-robots-both', one, { candRobots: 'User-agent: *\nDisallow: /\n', liveRobots: 'User-agent: *\nDisallow: /\n' });
    expect(result.json.site.findings.map((f: { code: string }) => f.code)).not.toContain('robots-txt-blocks-all');
  });

  it('a candidate sitemap that is not there is a blocker', async () => {
    const { result } = await run('site-sitemap', one, { candSitemapStatus: 'none' });
    expect(result.json.site.findings.map((f: { code: string }) => f.code)).toContain('candidate-sitemap-unavailable');
    expect(result.summary.pass).toBe(false);
  });

  it('a clean pair passes, exit code 0, and the report says so', async () => {
    const { result, out } = await run('site-pass', one);
    expect(result.summary.pass).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path.join(out, 'report.md'), 'utf8')).toContain('## Verdict: PASS');
  });

  it('--fail-on warn turns a warning into exit code 1', async () => {
    const { liveDir, candDir, out } = buildRun('fail-on', [{ path: '/desc-changed/', cand: page('/desc-changed/', { description: 'Lain' }), expect: [], verdict: 'warn' }]);
    const base = ['--live-dir', liveDir, '--candidate-dir', candDir, '--no-main', '--no-articles', '--no-wp-ids', '--out', out, '--quiet'];
    expect((await runFromOptions(parseCli(base) as never, { log: () => {} })).exitCode).toBe(0);
    expect((await runFromOptions(parseCli([...base, '--fail-on', 'warn']) as never, { log: () => {} })).exitCode).toBe(1);
  });
});

describe('the reports', () => {
  it('writes report.md and report.json with the documented shape', async () => {
    const { result, out } = await run('report', CASES);
    const md = readFileSync(path.join(out, 'report.md'), 'utf8');
    const json = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8'));
    expect(md).toContain('# SEO parity report');
    expect(md).toContain('## Verdict: FAIL');
    expect(md).toContain('## Blockers');
    expect(md).toContain('## Warnings');
    expect(md).toContain('## Address changes');
    expect(md).toContain('## Legend');
    for (const code of Object.keys(core.SEVERITY)) expect(md, `legend lists ${code}`).toContain(`\`${code}\``);
    expect(md).toContain('GET only, no cookies, no credentials');
    expect(json.tool).toBe('SakemSeoParity');
    expect(Object.keys(json)).toEqual(['tool', 'version', 'meta', 'summary', 'urlSet', 'site', 'results']);
    expect(json.meta).toMatchObject({ liveBase: LIVE, candidateBase: STAGING, liveMode: 'recorded', candidateMode: 'recorded', delayMs: 1000, max: 500 });
    expect(json.summary.compared).toBe(CASES.length);
    expect(json.results[0]).toMatchObject({ path: expect.any(String), verdict: expect.any(String), findings: expect.any(Array) });
    expect(result.files).toEqual([path.join(out, 'report.md'), path.join(out, 'report.json')]);
  });

  it('the JSON holds no page body, no cookie and no header value of the answers', async () => {
    const { out } = await run('report-clean', CASES);
    const raw = readFileSync(path.join(out, 'report.json'), 'utf8');
    expect(raw).not.toContain('<html');
    expect(raw).not.toContain('<body');
    expect(raw.toLowerCase()).not.toContain('set-cookie');
  });

  it('a long list of info findings is grouped, with five examples each', async () => {
    const many: Case[] = Array.from({ length: 12 }, (_, i) => ({
      path: `/old/${i}/`,
      cand: { [`/old/${i}/`]: { status: 308, location: `/new/${i}` }, [`/new/${i}`]: page(`/new/${i}`) },
      candSitemap: [`/new/${i}`],
      expect: ['address-moved'], verdict: 'info' as const,
    }));
    const { out } = await run('report-info', many);
    const md = readFileSync(path.join(out, 'report.md'), 'utf8');
    expect(md).toContain('### `address-moved` (12)');
    expect(md).toContain('... and 7 more');
  });

  it('--max cuts the list and the report says how many were not compared', async () => {
    const { liveDir, candDir, out } = buildRun('max', CASES.slice(0, 6));
    const result = await runFromOptions(parseCli(['--live-dir', liveDir, '--candidate-dir', candDir, '--no-main', '--no-articles', '--no-wp-ids', '--max', '3', '--out', out, '--quiet']) as never, { log: () => {} });
    expect(result.summary.compared).toBe(3);
    expect(result.markdown).toContain('3 not compared because of --max 3');
    expect(result.json.urlSet).toEqual({ total: 6, truncated: 3 });
  });
});

describe('offline mode on the committed sample (tests/fixtures/seo-parity/sample)', () => {
  const sample = path.join(webRoot, 'tests/fixtures/seo-parity/sample');

  it('reads a WordPress-shaped live side and an Astro-shaped candidate: the article moves, no blocker', async () => {
    const out = path.join(tmp, 'sample-out');
    const logs: string[] = [];
    const code = await main(['--live-dir', path.join(sample, 'live'), '--candidate-dir', path.join(sample, 'candidate'), '--no-main', '--no-articles', '--no-wp-ids', '--out', out, '--quiet'], { out: (l: string) => logs.push(l), err: (l: string) => logs.push(l) });
    const json = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8'));
    expect(code, logs.join('\n')).toBe(0);
    const article = json.results.find((r: { path: string }) => r.path === '/cerita/sample-post/');
    expect(article.findings.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(['address-moved', 'title-suffix-changed', 'jsonld-structural-dropped']));
    expect(article.candidate.final.path).toBe('/blog/sample-post');
    expect(json.summary).toMatchObject({ pass: true, blocker: 0 });
  });
});

// ---------------------------------------------------------------- extraction

describe('extractPage', () => {
  it('reads a Yoast-shaped WordPress head: graph JSON-LD, single quotes, attribute order, entities, comments', () => {
    const wp = `<!DOCTYPE html>
<html lang="id-ID" prefix="og: https://ogp.me/ns#">
<head><meta charset='UTF-8' />
<!-- This site is optimized with the Yoast SEO plugin -->
<title>Tanpa Jasa Ahdan &#8211; Sakola Kembara</title>
<meta name='robots' content='index, follow, max-image-preview:large, max-snippet:-1' />
<link rel="canonical" href="https://sakolakembara.org/cerita/tanpa-jasa-ahdan/" />
<meta content="Kenal dengan Ahdan &amp; kawan-kawan" name="description" />
<meta property="og:locale" content="id_ID" /><meta property="og:type" content="article" />
<meta property="og:title" content="Tanpa Jasa Ahdan" /><meta property="og:url" content="https://sakolakembara.org/cerita/tanpa-jasa-ahdan/" />
<meta property="og:image" content="https://sakolakembara.org/wp-content/uploads/2026/05/a.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="alternate" hreflang="id" href="https://sakolakembara.org/cerita/tanpa-jasa-ahdan/" />
<link rel="amphtml" href="https://sakolakembara.org/cerita/tanpa-jasa-ahdan/amp/" />
<script type="application/ld+json" class="yoast-schema-graph">{"@context":"https://schema.org","@graph":[{"@type":"Article","headline":"Tanpa Jasa Ahdan","datePublished":"2026-05-21T10:00:00+00:00","author":{"@id":"https://sakolakembara.org/#/schema/person/x"}},{"@type":"WebPage","url":"https://sakolakembara.org/cerita/tanpa-jasa-ahdan/"},{"@type":"BreadcrumbList","itemListElement":[]},{"@type":["Organization","NGO"],"name":"Sakola Kembara"}]}</script>
<script>var h1 = "<h1>not a heading</h1>";</script>
</head><body><!-- <h1>commented</h1> --><h1 class="entry-title">Tanpa Jasa <span>Ahdan</span></h1></body></html>`;
    const p = core.extractPage(wp);
    expect(p.lang).toBe('id-ID');
    expect(p.title).toBe('Tanpa Jasa Ahdan – Sakola Kembara');
    expect(p.description).toBe('Kenal dengan Ahdan & kawan-kawan');
    expect(p.canonical).toEqual({ href: 'https://sakolakembara.org/cerita/tanpa-jasa-ahdan/', count: 1 });
    expect(p.robots.robots).toBe('index, follow, max-image-preview:large, max-snippet:-1');
    expect(p.og).toMatchObject({ locale: 'id_ID', type: 'article', title: 'Tanpa Jasa Ahdan' });
    expect(p.og.image).toBe('https://sakolakembara.org/wp-content/uploads/2026/05/a.jpg');
    expect(p.twitter.card).toBe('summary_large_image');
    expect(p.hreflang).toEqual([{ hreflang: 'id', href: 'https://sakolakembara.org/cerita/tanpa-jasa-ahdan/' }]);
    expect(p.amphtml).toBe('https://sakolakembara.org/cerita/tanpa-jasa-ahdan/amp/');
    expect(p.h1).toEqual(['Tanpa Jasa Ahdan']);
    expect(p.jsonld.types).toEqual(['Article', 'BreadcrumbList', 'NGO', 'Organization', 'WebPage']);
    const article = p.jsonld.nodes.find((n: { types: string[] }) => n.types.includes('Article'));
    expect(article?.fields).toMatchObject({ headline: 'Tanpa Jasa Ahdan', datePublished: '2026-05-21T10:00:00+00:00', author: null });
    expect(p.jsonld.nodes.find((n: { types: string[] }) => n.types.includes('NGO'))?.families).toEqual(['organization']);
  });

  it('reads the head this site renders (the Astro layout): title, canonical, OG, Twitter, Article JSON-LD', () => {
    const astro = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Judul | Sakola Kembara</title><meta name="description" content="Ringkas">
<link rel="canonical" href="https://sakolakembara.org/blog/judul"><meta name="robots" content="index, follow"><meta name="googlebot" content="index, follow, max-video-preview:-1">
<meta property="og:type" content="website"><meta property="og:title" content="Judul"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Judul","author":{"@type":"Organization","name":"Sakola Kembara"}}</script></head><body><h1>Judul</h1></body></html>`;
    const p = core.extractPage(astro, { headers: { 'x-robots-tag': 'noindex' } });
    expect(p).toMatchObject({ lang: 'id', title: 'Judul | Sakola Kembara', description: 'Ringkas', h1: ['Judul'] });
    expect(p.robots).toEqual({ robots: 'index, follow', googlebot: 'index, follow, max-video-preview:-1', xRobotsTag: 'noindex' });
    expect(p.jsonld.types).toEqual(['Article']);
  });

  it('does not throw on empty or broken input and reports invalid JSON-LD', () => {
    expect(() => core.extractPage('')).not.toThrow();
    expect(() => core.extractPage('<html><head><title>x')).not.toThrow();
    expect(core.extractPage('<script type="application/ld+json">{oops</script>').jsonld.errors).toBe(1);
    expect(core.extractPage('<p>no head at all</p>')).toMatchObject({ title: null, canonical: null, description: null, h1: [] });
  });

  it('counts a second canonical link and keeps the first', () => {
    const p = core.extractPage('<link rel="canonical" href="/a"><link rel="canonical" href="/b">');
    expect(p.canonical).toEqual({ href: '/a', count: 2 });
  });

  it('decodes entities and collapses whitespace', () => {
    expect(core.normText('  a &amp;  b\n&#8211;\t&hellip; &unknown; &#xZZ; ')).toBe('a & b – … &unknown; &#xZZ;');
    expect(core.decodeEntities('&#128512;')).toBe('\u{1F600}');
    expect(core.decodeEntities('&#0;')).toBe('&#0;');
  });
});

describe('paths, robots.txt, sitemaps, url lists', () => {
  it('pathKey folds the trailing slash, duplicate slashes and the case of %XX', () => {
    expect(core.pathKey('/a/b/')).toBe('/a/b');
    expect(core.pathKey('/')).toBe('/');
    expect(core.pathKey('//a//b//')).toBe('/a/b');
    expect(core.pathKey('/a%c3%a9/?x=1')).toBe('/a%C3%A9?x=1');
    expect(core.pathKey('/a/?')).toBe('/a');
  });

  it('siteHosts keeps the www twin for a domain and nothing extra for localhost or an IP', () => {
    expect([...core.siteHosts('https://sakolakembara.org')].sort()).toEqual(['sakolakembara.org', 'www.sakolakembara.org']);
    expect([...core.siteHosts('https://www.sakolakembara.org')].sort()).toEqual(['sakolakembara.org', 'www.sakolakembara.org']);
    expect([...core.siteHosts('http://127.0.0.1:8791')]).toEqual(['127.0.0.1:8791']);
    expect([...core.siteHosts('http://localhost:3000')]).toEqual(['localhost:3000']);
    expect(core.isLoopbackUrl('http://127.0.0.1:1')).toBe(true);
    expect(core.isLoopbackUrl('http://localhost:1')).toBe(true);
    expect(core.isLoopbackUrl('https://x.localhost')).toBe(true);
    expect(core.isLoopbackUrl('https://sakolakembara.org')).toBe(false);
  });

  it('parses robots.txt groups and answers allow/disallow the way crawlers do', () => {
    const r = core.parseRobotsTxt(`# WordPress
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Disallow: /*?replytocom=
Disallow: /private$

User-agent: SakemSeoParity
Disallow: /only-for-us/

Sitemap: https://x.example/sitemap_index.xml`);
    expect(r.sitemaps).toEqual(['https://x.example/sitemap_index.xml']);
    const ua = core.USER_AGENT;
    // the group that names this tool wins over "*": the wp-admin rule is not applied to it
    expect(core.robotsAllows(r, ua, '/only-for-us/x')).toBe(false);
    expect(core.robotsAllows(r, ua, '/wp-admin/')).toBe(true);
    expect(core.robotsAllows(r, 'Other/1.0', '/wp-admin/x')).toBe(false);
    expect(core.robotsAllows(r, 'Other/1.0', '/wp-admin/admin-ajax.php')).toBe(true);
    expect(core.robotsAllows(r, 'Other/1.0', '/post/?replytocom=3')).toBe(false);
    expect(core.robotsAllows(r, 'Other/1.0', '/private')).toBe(false);
    expect(core.robotsAllows(r, 'Other/1.0', '/private/x')).toBe(true);
    expect(core.robotsAllows(null, ua, '/anything')).toBe(true);
    expect(core.robotsBlocksAll(core.parseRobotsTxt('User-agent: *\nDisallow: /'), ua)).toBe(true);
    expect(core.robotsBlocksAll(core.parseRobotsTxt('User-agent: *\nDisallow:'), ua)).toBe(false);
  });

  it('parses a sitemap index, a urlset with images, CDATA and entities', () => {
    const index = core.parseSitemap('<?xml version="1.0"?><sitemapindex><sitemap><loc>https://x.example/post-sitemap.xml</loc><lastmod>2026-05-21T10:00:00+00:00</lastmod></sitemap><sitemap><loc><![CDATA[https://x.example/page-sitemap.xml]]></loc></sitemap></sitemapindex>');
    expect(index.kind).toBe('index');
    expect(index.entries.map((e: { loc: string }) => e.loc)).toEqual(['https://x.example/post-sitemap.xml', 'https://x.example/page-sitemap.xml']);
    const set = core.parseSitemap('<urlset xmlns:image="x"><url><loc>https://x.example/a/?p=1&amp;q=2</loc><image:image><image:loc>https://x.example/i.jpg</image:loc></image:image></url></urlset>');
    expect(set.kind).toBe('urlset');
    expect(set.entries[0]).toMatchObject({ loc: 'https://x.example/a/?p=1&q=2', images: ['https://x.example/i.jpg'] });
    expect(core.parseSitemap('<html>').kind).toBe('unknown');
  });

  it('parses an extra list: paths, URLs of the site, comments; drops other hosts', () => {
    const hosts = core.siteHosts('https://x.example');
    const r = core.parseUrlList('# top\n/a/\nhttps://x.example/b/ # trailing\nhttps://www.x.example/c\nhttps://other.example/d\n\n  /e?x=1  ', hosts);
    expect(r.paths).toEqual(['/a/', '/b/', '/c', '/e?x=1']);
    expect(r.ignored).toEqual(['https://other.example/d']);
  });

  it('buildUrlSet de-duplicates by address, keeps the most faithful spelling, orders by source and caps', () => {
    const set = core.buildUrlSet({ mainPaths: ['/tim', '/'], extraPaths: ['/x'], articlePaths: ['/cerita/a/'], sitemapPaths: ['/tim/', '/cerita/a/', '/new/'], max: 5 });
    expect(set.urls.map((u: { path: string }) => u.path)).toEqual(['/tim/', '/', '/x', '/cerita/a/', '/new/']);
    expect(set.urls.find((u: { path: string }) => u.path === '/tim/')).toMatchObject({ inLiveSitemap: true, source: 'sitemap' });
    expect(set.urls.find((u: { path: string }) => u.path === '/')).toMatchObject({ inLiveSitemap: false, source: 'main' });
    const capped = core.buildUrlSet({ mainPaths: ['/a', '/b', '/c'], max: 2 });
    expect(capped).toMatchObject({ total: 3, truncated: 1 });
    expect(capped.urls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- the network source, with a fake fetch

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const html200 = (body = '<html><head><title>x</title></head></html>') => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });
const redirect = (status: number, location: string) => new Response(null, { status, headers: { location } });

describe('the network source is polite', () => {
  it('sends GET only, with three headers: no cookie, no authorization, redirect handled by hand, credentials omitted', async () => {
    const f = fakeFetch(() => html200());
    const source = sources.createNetworkSource({ base: LIVE, fetchImpl: f.impl, delayMs: 0 });
    await source.get(`${LIVE}/a`);
    expect(f.calls).toHaveLength(1);
    const init = f.calls[0].init;
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect(init.credentials).toBe('omit');
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(['accept', 'accept-language', 'user-agent']);
    expect(headers['user-agent']).toBe(core.USER_AGENT);
    expect(headers['user-agent']).toMatch(/^SakemSeoParity\/\d+\.\d+ \(\+https:\/\/.+seo-audit\.md\)$/);
  });

  it('never makes a request other than GET, even for a redirect chain, robots and sitemaps', async () => {
    const f = fakeFetch((url) => (url.endsWith('/a') ? redirect(301, '/b') : html200()));
    const source = sources.createNetworkSource({ base: LIVE, fetchImpl: f.impl, delayMs: 0 });
    await source.get(`${LIVE}/a`);
    await source.get(`${LIVE}/robots.txt`);
    expect(f.calls.map((c) => c.init.method)).toEqual(['GET', 'GET', 'GET']);
  });

  it('does not retry: one failed request is one call', async () => {
    const f = fakeFetch(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    });
    const source = sources.createNetworkSource({ base: LIVE, fetchImpl: f.impl, delayMs: 0 });
    const answer = await source.get(`${LIVE}/a`);
    expect(answer).toMatchObject({ final: null, error: 'network: ECONNRESET' });
    expect(f.calls).toHaveLength(1);
  });

  it('turns a timeout into "timeout" and a body above the cap into "body-too-large"', async () => {
    const slow = sources.createNetworkSource({ base: LIVE, delayMs: 0, fetchImpl: fakeFetch(() => { throw new DOMException('timed out', 'TimeoutError'); }).impl });
    expect((await slow.get(`${LIVE}/a`)).error).toBe('timeout');
    const big = sources.createNetworkSource({ base: LIVE, delayMs: 0, maxBodyBytes: 100, fetchImpl: fakeFetch(() => html200('x'.repeat(500))).impl });
    expect((await big.get(`${LIVE}/a`)).error).toBe('body-too-large');
  });

  it('waits at least delayMs between requests to one host, and not between two hosts', async () => {
    let t = 1_000;
    const sleeps: number[] = [];
    const f = fakeFetch(() => html200());
    const source = sources.createNetworkSource({
      base: LIVE, fetchImpl: f.impl, delayMs: 1000, extraHosts: ['other.example.test'],
      now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
    });
    await source.get(`${LIVE}/1`);
    await source.get(`${LIVE}/2`);
    await source.get(`${LIVE}/3`);
    expect(sleeps).toEqual([1000, 1000]);
    t += 5_000; // time passes by itself: no sleep needed
    await source.get(`${LIVE}/4`);
    expect(sleeps).toEqual([1000, 1000]);
    await source.get('https://other.example.test/x');
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('paces every hop of a redirect chain like any other request', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const f = fakeFetch((url) => (url.endsWith('/a') ? redirect(308, '/b') : html200()));
    const source = sources.createNetworkSource({ base: LIVE, fetchImpl: f.impl, delayMs: 1000, now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; } });
    await source.get(`${LIVE}/a`);
    expect(f.calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it('follows redirects by hand, records the hops, and keeps to the site hosts (the www twin is the same site)', async () => {
    const f = fakeFetch((url) => {
      if (url === `${LIVE}/a`) return redirect(301, 'https://www.live.example.test/b');
      if (url === 'https://www.live.example.test/b') return redirect(308, '/c');
      return html200();
    });
    const source = sources.createNetworkSource({ base: LIVE, fetchImpl: f.impl, delayMs: 0 });
    const answer = await source.get(`${LIVE}/a`);
    expect(answer.hops.map((h: { status: number }) => h.status)).toEqual([301, 308]);
    expect(answer.final).toMatchObject({ status: 200, url: 'https://www.live.example.test/c' });
  });

  it('does not follow a redirect to another site: the chain stops, no request goes there', async () => {
    const f = fakeFetch((url) => (url.endsWith('/a') ? redirect(302, 'https://evil.example.net/x') : html200()));
    const source = sources.createNetworkSource({ base: LIVE, fetchImpl: f.impl, delayMs: 0 });
    const answer = await source.get(`${LIVE}/a`);
    expect(answer).toMatchObject({ final: null, error: 'redirect-left-allowed-hosts' });
    expect(answer.hops).toHaveLength(1);
    expect(f.calls.map((c) => c.url)).toEqual([`${LIVE}/a`]);
  });

  it('detects a loop and a chain of more than ten hops', async () => {
    const loop = sources.createNetworkSource({ base: LIVE, delayMs: 0, fetchImpl: fakeFetch((url) => redirect(308, url.endsWith('/a') ? '/b' : '/a')).impl });
    expect((await loop.get(`${LIVE}/a`)).error).toBe('redirect-loop');
    let n = 0;
    const long = sources.createNetworkSource({ base: LIVE, delayMs: 0, fetchImpl: fakeFetch(() => redirect(308, `/p${++n}`)).impl });
    const answer = await long.get(`${LIVE}/start`);
    expect(answer.error).toBe('too-many-redirects');
    expect(answer.hops.length).toBeGreaterThan(10);
  });

  it('drops Set-Cookie from the answer and does not read a body that is not text', async () => {
    const headers = new Headers({ 'content-type': 'image/jpeg' });
    headers.append('set-cookie', 'a=1');
    headers.append('set-cookie', 'b=2');
    const f = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers }));
    const source = sources.createNetworkSource({ base: LIVE, fetchImpl: f.impl, delayMs: 0 });
    const answer = await source.get(`${LIVE}/i.jpg`);
    expect(answer.final!.body).toBe('');
    expect(Object.keys(answer.final!.headers)).not.toContain('set-cookie');
    expect(answer.final!.contentType).toBe('image/jpeg');
  });

  it('counts its requests', async () => {
    const source = sources.createNetworkSource({ base: LIVE, fetchImpl: fakeFetch(() => html200()).impl, delayMs: 0 });
    await source.get(`${LIVE}/1`);
    await source.get(`${LIVE}/2`);
    expect(source.stats.requests).toBe(2);
  });
});

describe('recording and replaying', () => {
  it('what --record writes, the recorded source reads back identically (hops, bodies, headers, errors left out)', async () => {
    const dir = path.join(tmp, 'rec-roundtrip');
    const f = fakeFetch((url) => {
      if (url === `${LIVE}/old/`) return redirect(301, '/new');
      return new Response('<html><head><title>Baru</title></head></html>', { status: 200, headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex', 'set-cookie': 'secret=1' } });
    });
    const recorder = sources.createRecorder({ dir, base: LIVE });
    const net = sources.createNetworkSource({ base: LIVE, fetchImpl: f.impl, delayMs: 0, recorder });
    const original = await net.get(`${LIVE}/old/`);
    expect(recorder.flush()).toBe(2);
    const manifest = readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    expect(manifest).not.toContain('secret');
    const replay = await sources.createRecordedSource({ dir }).get(`${LIVE}/old/`);
    expect(replay.hops).toEqual(original.hops);
    expect(replay.final).toMatchObject({ status: 200, url: `${LIVE}/new`, contentType: 'text/html', body: original.final!.body });
    expect(replay.final!.headers['x-robots-tag']).toBe('noindex');
  });

  it('an address that was never recorded is an error, not a guess', async () => {
    const dir = path.join(tmp, 'rec-missing');
    writeSide(dir, LIVE, { '/a': { status: 200, html: '<title>a</title>' } });
    const source = sources.createRecordedSource({ dir });
    expect((await source.get(`${LIVE}/b`)).error).toBe('not-recorded');
    expect((await source.get(`${LIVE}/a/`)).final?.status).toBe(200); // the trailing slash is not a different address
    expect(() => sources.createRecordedSource({ dir: path.join(tmp, 'nope') })).toThrow(/manifest\.json/);
  });

  it('a network run with --record writes the two folders and they can be fed back with --live-dir/--candidate-dir', async () => {
    const root = path.join(tmp, 'rec-run');
    const make = () =>
      fakeFetch((url) => {
        const u = new URL(url);
        if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
        if (u.pathname === '/sitemap.xml') return new Response(urlset(['/page/']), { status: 200, headers: { 'content-type': 'application/xml' } });
        if (u.pathname === '/page/') return new Response(html('/page/'), { status: 200, headers: { 'content-type': 'text/html' } });
        return new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } });
      }).impl;
    const fetchImpl = ((url: string, init: RequestInit) => make()(url, init)) as unknown as typeof fetch;
    const options = parseCli(['--live-base', LIVE, '--candidate-base', STAGING, '--allow-network', '--no-main', '--no-articles', '--no-wp-ids', '--record', path.join(root, 'rec'), '--out', path.join(root, 'out1'), '--quiet']);
    const first = await runFromOptions(options as never, { fetchImpl, sleep: async () => {}, now: () => 0, log: () => {} });
    expect(first.files.some((f: string) => f.includes('rec/live'))).toBe(true);
    const again = await runFromOptions(parseCli(['--live-dir', path.join(root, 'rec/live'), '--candidate-dir', path.join(root, 'rec/candidate'), '--no-main', '--no-articles', '--no-wp-ids', '--out', path.join(root, 'out2'), '--quiet']) as never, { log: () => {} });
    expect(again.json.results.map((r: { path: string; verdict: string }) => [r.path, r.verdict])).toEqual(first.json.results.map((r: { path: string; verdict: string }) => [r.path, r.verdict]));
    expect(first.summary.compared).toBe(1);
  });
});

// ---------------------------------------------------------------- the command line

describe('the command line refuses what it should refuse', () => {
  const refuses = (args: string[], message: RegExp) => {
    try {
      parseCli(args);
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      expect((error as Error).message).toMatch(message);
      return;
    }
    throw new Error(`parseCli accepted: ${args.join(' ')}`);
  };

  it('needs both sides', () => {
    refuses([], /both sides are required/);
    refuses(['--live-base', 'http://127.0.0.1:1'], /both sides are required/);
    refuses(['--candidate-base', 'http://127.0.0.1:1'], /both sides are required/);
    refuses(['--live-dir', 'x'], /both sides are required/);
  });

  it('refuses a remote host without --allow-network, and names it', () => {
    refuses(['--live-base', 'https://live.example.test', '--candidate-base', 'http://127.0.0.1:1'], /live base would send requests to a public host \(live\.example\.test\)\. Add --allow-network/);
    refuses(['--live-base', 'http://127.0.0.1:1', '--candidate-base', 'https://staging.example.test'], /candidate base would send requests/);
    expect(parseCli(['--live-base', 'https://live.example.test', '--candidate-base', 'https://staging.example.test', '--allow-network'])).toMatchObject({ allowNetwork: true });
  });

  it('accepts two loopback bases and a recorded side without the flag', () => {
    expect(parseCli(['--live-base', 'http://127.0.0.1:1', '--candidate-base', 'http://localhost:2'])).toMatchObject({ allowNetwork: false });
    expect(parseCli(['--live-dir', 'a', '--candidate-dir', 'b'])).toMatchObject({ live: { dir: 'a' }, candidate: { dir: 'b' } });
    expect(parseCli(['--live-dir', 'a', '--candidate-base', 'http://localhost:2'])).toBeDefined();
  });

  it('refuses the same origin on both sides, a base with a path, a non-http base', () => {
    refuses(['--live-base', 'http://127.0.0.1:1', '--candidate-base', 'http://127.0.0.1:1'], /same origin/);
    refuses(['--live-base', 'https://a.example.test/blog', '--candidate-base', 'http://127.0.0.1:1', '--allow-network'], /origin without a path/);
    refuses(['--live-base', 'ftp://a.example.test', '--candidate-base', 'http://127.0.0.1:1', '--allow-network'], /http or https/);
    refuses(['--live-base', 'nonsense', '--candidate-base', 'http://127.0.0.1:1'], /not a URL/);
  });

  it('never goes faster than one request per second to a remote host', () => {
    refuses(['--live-base', 'https://live.example.test', '--candidate-base', 'http://127.0.0.1:1', '--allow-network', '--delay-ms', '500'], /one request per second/);
    expect(parseCli(['--live-base', 'http://127.0.0.1:1', '--candidate-base', 'http://127.0.0.1:2', '--delay-ms', '0'])).toMatchObject({ delayMs: 0 });
    expect(parseCli(['--live-base', 'https://live.example.test', '--candidate-base', 'http://127.0.0.1:1', '--allow-network'])).toMatchObject({ delayMs: 1000, timeoutMs: 15_000, max: 500 });
  });

  it('checks numbers and unknown flags', () => {
    const base = ['--live-base', 'http://127.0.0.1:1', '--candidate-base', 'http://127.0.0.1:2'];
    refuses([...base, '--max', '0'], /--max must be a whole number/);
    refuses([...base, '--max', 'abc'], /--max must be a whole number/);
    refuses([...base, '--timeout-ms', '10'], /--timeout-ms/);
    refuses([...base, '--fail-on', 'info'], /--fail-on/);
    refuses([...base, '--post'], /Unknown option/);
    refuses([...base, 'positional'], /./);
    refuses(['--live-dir', 'a', '--candidate-dir', 'b', '--record', 'r'], /--record needs at least one network side/);
  });

  it('main() exits 2 with a message and sends nothing', async () => {
    const f = fakeFetch(() => {
      throw new Error('a request was sent');
    });
    const err: string[] = [];
    const code = await main(['--live-base', 'https://live.example.test', '--candidate-base', 'https://staging.example.test'], { fetchImpl: f.impl, err: (l: string) => err.push(l), out: () => {} });
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('--allow-network');
    expect(f.calls).toHaveLength(0);
    expect(await main([], { err: () => {}, out: () => {} })).toBe(2);
  });

  it('--help prints the options and exits 0', async () => {
    const out: string[] = [];
    expect(await main(['--help'], { out: (l: string) => out.push(l) })).toBe(0);
    expect(out.join('\n')).toBe(HELP);
    for (const flag of ['--live-base', '--candidate-base', '--allow-network', '--max', '--delay-ms', '--record', '--dry-run', '--include-images']) expect(HELP).toContain(flag);
  });

  it('--dry-run prints the plan and sends no request at all', async () => {
    const f = fakeFetch(() => {
      throw new Error('a request was sent');
    });
    const out: string[] = [];
    const code = await main(['--live-base', 'https://live.example.test', '--candidate-base', 'https://staging.example.test', '--allow-network', '--dry-run'], { fetchImpl: f.impl, out: (l: string) => out.push(l), err: () => {} });
    expect(code).toBe(0);
    expect(f.calls).toHaveLength(0);
    const plan = JSON.parse(out[0]);
    expect(plan.sources.articles).toBe(ARTICLE_COUNT);
    expect(plan.sources.main).toBe(MAIN_PATHS.length);
    expect(plan.urlsBeforeSitemap).toBeGreaterThanOrEqual(ARTICLE_COUNT);
    expect(out.at(-1)).toContain('no request was sent');
  });

  it('planRun counts the extra list and drops URLs of other hosts', () => {
    const extra = path.join(tmp, 'extra.txt');
    writeFileSync(extra, '# more\n/special/\nhttps://live.example.test/other/\nhttps://nope.example.net/x\n');
    const options = parseCli(['--live-base', 'https://live.example.test', '--candidate-base', 'https://staging.example.test', '--allow-network', '--extra', extra, '--no-main', '--no-articles', '--no-wp-ids']);
    const plan = planRun(options as never);
    expect(plan.sources).toMatchObject({ extra: 2, ignoredExtra: 1, main: 0, articles: 0 });
    expect(plan.first).toEqual(['/special/', '/other/']);
  });
});

describe('what the run asks the network for', () => {
  it('only the two bases, GET only, through a fake fetch: a full run with every article URL', async () => {
    const live = new Set<string>();
    const f = fakeFetch((url) => {
      const u = new URL(url);
      live.add(u.origin);
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /wp-admin/\n', { status: 200, headers: { 'content-type': 'text/plain' } });
      if (u.pathname === '/sitemap_index.xml' || u.pathname === '/sitemap.xml') return new Response(urlset(['/tim/']), { status: 200, headers: { 'content-type': 'application/xml' } });
      return new Response(html(u.pathname), { status: 200, headers: { 'content-type': 'text/html' } });
    });
    const options = parseCli(['--live-base', LIVE, '--candidate-base', STAGING, '--allow-network', '--max', '120', '--out', path.join(tmp, 'net-run'), '--quiet']);
    const result = await runFromOptions(options as never, { fetchImpl: f.impl, sleep: async () => {}, now: () => 0, log: () => {} });
    expect([...live].sort()).toEqual([LIVE, STAGING]);
    expect(f.calls.every((c) => c.init.method === 'GET')).toBe(true);
    expect(f.calls.every((c) => !('cookie' in (c.init.headers as object)) && !('authorization' in (c.init.headers as object)))).toBe(true);
    expect(result.summary.compared).toBeLessThanOrEqual(120);
    // the article URLs come from the WordPress source URLs of the articles (ARTICLE_COUNT)
    const paths = f.calls.map((c) => new URL(c.url).pathname);
    expect(paths).toContain(new URL(blogPosts().articles[0].sourceUrl).pathname);
    // robots.txt was asked once per side, and it was read before the pages
    expect(paths.filter((p) => p === '/robots.txt')).toHaveLength(2);
    expect(paths.indexOf('/robots.txt')).toBe(0);
  });

  it('a live robots.txt Disallow stops the request on both sides', async () => {
    const f = fakeFetch((url) => {
      const u = new URL(url);
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /blocked/\n', { status: 200, headers: { 'content-type': 'text/plain' } });
      return new Response(html(u.pathname), { status: 200, headers: { 'content-type': 'text/html' } });
    });
    const extra = path.join(tmp, 'extra-blocked.txt');
    writeFileSync(extra, '/blocked/x\n/free/\n');
    const options = parseCli(['--live-base', LIVE, '--candidate-base', STAGING, '--allow-network', '--no-main', '--no-articles', '--no-wp-ids', '--extra', extra, '--out', path.join(tmp, 'net-blocked'), '--quiet']);
    const result = await runFromOptions(options as never, { fetchImpl: f.impl, sleep: async () => {}, now: () => 0, log: () => {} });
    expect(f.calls.map((c) => new URL(c.url).pathname)).not.toContain('/blocked/x');
    expect(result.json.results.find((r: { path: string }) => r.path === '/blocked/x').verdict).toBe('skipped');
  });

  it('readSitemaps follows an index into its children, rewrites them onto the base, caps the files and ignores junk', async () => {
    const dir = path.join(tmp, 'sitemaps');
    writeSide(dir, LIVE, {
      '/sitemap_index.xml': { status: 200, type: 'application/xml', text: `<sitemapindex><sitemap><loc>https://production.example/post-sitemap.xml</loc></sitemap><sitemap><loc>${LIVE}/missing.xml</loc></sitemap><sitemap><loc>${LIVE}/junk.xml</loc></sitemap></sitemapindex>` },
      '/post-sitemap.xml': { status: 200, type: 'application/xml', text: '<urlset><url><loc>https://production.example/cerita/a/</loc><image:image><image:loc>https://production.example/wp-content/uploads/a.jpg</image:loc><image:loc>https://cdn.example/b.jpg</image:loc></image:image></url></urlset>' },
      '/junk.xml': { status: 200, type: 'text/html', html: '<html>not a sitemap</html>' },
    });
    const source = sources.createRecordedSource({ dir });
    const r = await readSitemaps(source, ['/sitemap_index.xml']);
    expect(r.files).toEqual(['/sitemap_index.xml', '/post-sitemap.xml']);
    expect(r.urls).toEqual(['/cerita/a/']);
    expect(r.images).toEqual(['/wp-content/uploads/a.jpg']);
  });
});

// ---------------------------------------------------------------- the repository around it

describe('the tool and the repository agree', () => {
  it('the WordPress article URLs it checks are the ones of lib/blog-posts.json, which redirects.test.ts proves are redirected', () => {
    const plan = planRun(parseCli(['--live-dir', 'a', '--candidate-dir', 'b', '--no-main', '--no-wp-ids']) as never);
    expect(plan.sources.articles).toBe(ARTICLE_COUNT);
    expect(plan.urlsBeforeSitemap).toBe(ARTICLE_COUNT);
  });

  it('and the WordPress shortlinks /?p=<id>, one per article, are checked too unless --no-wp-ids', () => {
    const plan = planRun(parseCli(['--live-dir', 'a', '--candidate-dir', 'b', '--no-main', '--no-articles']) as never);
    expect(plan.sources.wpIds).toBe(ARTICLE_COUNT);
    expect(plan.urlsBeforeSitemap).toBe(ARTICLE_COUNT);
    expect(plan.first[0]).toMatch(/^\/\?p=\d+$/);
    expect(planRun(parseCli(['--live-dir', 'a', '--candidate-dir', 'b', '--no-main', '--no-articles', '--no-wp-ids']) as never).sources.wpIds).toBe(0);
  });

  it('the main pages: no duplicates, no portal or admin names, a file name keeps no trailing slash', () => {
    expect(new Set(MAIN_PATHS).size).toBe(MAIN_PATHS.length);
    expect(MAIN_PATHS).toContain('/');
    expect(MAIN_PATHS).toContain('/index.php');
    expect(MAIN_PATHS.every((p) => !p.startsWith('/portal') && !p.startsWith('/admin') && !p.startsWith('/api'))).toBe(true);
  });

  it('docs/cloudflare/seo-audit.md lists every finding code with the severity the code has', () => {
    const doc = readRoot('docs/cloudflare/seo-audit.md');
    const rows = new Map<string, string>();
    for (const m of doc.matchAll(/^\| `([a-z0-9-]+)` \| (BLOCKER|WARN|INFO) \|/gm)) rows.set(m[1], m[2]);
    const expected = new Map(Object.entries(core.SEVERITY).map(([code, v]) => [code, v.severity]));
    expect([...rows.entries()].sort()).toEqual([...expected.entries()].sort());
  });

  describe('docs/cloudflare/cutover-runbook.md', () => {
    const runbook = readRoot('docs/cloudflare/cutover-runbook.md');
    const rows = runbook.split('\n').filter((l) => /^\| (P|S|T|C|M|X|RB)-\d+ \|/.test(l) || /^\| H\d \|/.test(l));

    it('says up front that go-live is blocked on M4 and makes it a precondition', () => {
      expect(runbook).toMatch(/GO-LIVE IS BLOCKED ON M4/);
      expect(runbook).toMatch(/\/portal\/\*`, `\/login` and `\/register` have \*\*no backend\*\*/);
      expect(runbook.split('\n').find((l) => l.startsWith('| P-01 |'))).toMatch(/M4/);
    });

    it('marks every precondition, step, hold point, smoke test, cache check and rollback step with who does it', () => {
      expect(rows.length).toBeGreaterThan(90);
      const unmarked = rows.filter((l) => !/needs Dzul|agent may prepare/.test(l));
      expect(unmarked).toEqual([]);
    });

    it('has unique ids and the sections a person needs on the day', () => {
      const ids = rows.map((l) => l.split('|')[1].trim());
      expect(new Set(ids).size).toBe(ids.length);
      for (const heading of ['## 3. Preconditions', '## 4. DNS inventory procedure', '## 5. TTL schedule', '## 6. Order of operations on the day', '## 7. Smoke tests', '### 7.3 Cache checklist', '### 7.4 Email delivery', '## 8. Monitoring plan', '## 9. Rollback', '### 9.1 Triggers', '### 9.4 Data written during the window', '## 10. What to keep of WordPress, and communication', '## 11. After the cutover', '## 13. Risk register', '## Open decisions for Dzul']) {
        expect(runbook, heading).toContain(heading);
      }
    });

    it('lists the rollback triggers as a numbered list and the DNS inventory template with no values', () => {
      const triggers = runbook.split('### 9.1 Triggers')[1].split('### 9.2')[0].split('\n').filter((l) => /^\d+\. /.test(l));
      expect(triggers.length).toBeGreaterThanOrEqual(8);
      const template = runbook.split('Blank template')[1].split('Where to look')[0];
      const dataRows = template.split('\n').filter((l) => l.startsWith('|') && !/^\| (Name|---)/.test(l));
      expect(dataRows.every((l) => /^\|( \|)+$/.test(l))).toBe(true);
    });

    it('every finding and decision that the risk register or the steps cite exists', () => {
      const defined = new Set([...runbook.matchAll(/^\| (F-\d+|D-\d+|R-\d+) \|/gm)].map((m) => m[1]));
      const cited = new Set([...runbook.matchAll(/\b(F-\d{2}|D-\d{2}|R-\d{2})\b/g)].map((m) => m[1]));
      expect([...cited].filter((id) => !defined.has(id))).toEqual([]);
    });

    it('holds no secret, token, account id, IP address (but the two public resolvers) or e-mail address', () => {
      for (const file of ['docs/cloudflare/cutover-runbook.md', 'docs/cloudflare/seo-audit.md']) {
        const text = readRoot(file);
        expect(text.replace(/\b(1\.1\.1\.1|8\.8\.8\.8)\b/g, ''), file).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
        expect(text, file).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
        expect(text, file).not.toMatch(/\b[0-9a-f]{32}\b/);
        expect(text, file).not.toMatch(/(api[_-]?key|token|secret)\s*[:=]\s*\S{8,}/i);
      }
    });
  });

  it('the script is read-only by construction: it holds no write method of HTTP and no cookie handling', () => {
    for (const file of ['scripts/seo-parity.mjs', 'scripts/lib/seo-parity-core.mjs', 'scripts/lib/seo-parity-sources.mjs']) {
      const text = readFileSync(path.join(webRoot, file), 'utf8');
      expect(text, file).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
      expect(text, file).not.toMatch(/\bcookie\b\s*:/i);
      expect(text, file).not.toMatch(/\bauthorization\b\s*:/i);
    }
  });
});
