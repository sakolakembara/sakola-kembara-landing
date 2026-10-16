#!/usr/bin/env node
// SEO parity: compares the LIVE site with a CANDIDATE (staging, or the local Worker) URL by URL and says
// what would hurt search ranking if the candidate replaced the live site. Read-only: it only issues GET
// requests to the two bases you name, sends no cookie and no credential, waits one second between requests
// to one host, honours robots.txt, never retries, and writes only into --out (and --record).
//
//   node scripts/seo-parity.mjs --live-base https://live.example --candidate-base https://staging.example --allow-network
//   node scripts/seo-parity.mjs --live-dir rec/live --candidate-dir rec/candidate        (offline: no network at all)
//   node scripts/seo-parity.mjs --dry-run --live-base ... --candidate-base ...            (print the plan, no request)
//
// What each finding means, the severities and how to read the report: docs/cloudflare/seo-audit.md.
// Running it against the real site needs Dzul's approval (the flag --allow-network is the reminder).

import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  TOOL_NAME, TOOL_VERSION, USER_AGENT, buildUrlSet, compareUrls, isLoopbackUrl, parseRobotsTxt, parseSitemap, parseUrlList, pathKey,
  renderMarkdown, siteChecks, siteHosts, summarize, toJson,
} from './lib/seo-parity-core.mjs';
import { createNetworkSource, createRecordedSource, createRecorder } from './lib/seo-parity-sources.mjs';
import { REDIRECTS } from '../redirects.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ARTICLES_FILE = path.resolve(here, '../../../lib/blog-posts.json');

export class UsageError extends Error {}

export const HELP = `${TOOL_NAME} ${TOOL_VERSION}: SEO parity between a live site and a candidate.

Each side is either a network base (--live-base / --candidate-base) or a recorded directory (--live-dir / --candidate-dir).
Both sides are required; the run refuses to start otherwise.

  --live-base URL          origin of the live site (needs --allow-network unless it is localhost)
  --candidate-base URL     origin of staging or of the local Worker (same rule)
  --live-dir DIR           recorded answers of the live site (written by --record)
  --candidate-dir DIR      recorded answers of the candidate
  --allow-network          you have approval to send requests to a non-local host
  --sitemap PATH|URL       live sitemap to read (repeatable). Default: the Sitemap lines of robots.txt, then
                           /sitemap_index.xml, /wp-sitemap.xml, /sitemap.xml (the first that works)
  --candidate-sitemap PATH candidate sitemap (default /sitemap.xml)
  --extra FILE             more paths or URLs, one per line, # comments allowed
  --no-main                leave out the built-in list of main pages and legacy entry points
  --no-articles            leave out the 80 WordPress article URLs of lib/blog-posts.json
  --no-wp-ids              leave out the 80 WordPress shortlinks /?p=<id> (they are checked by default: old links use them)
  --include-images         also check the image URLs listed in the live sitemaps (status and type only)
  --max N                  compare at most N URLs (default 500)
  --delay-ms N             pause between requests to one host (default 1000; not below 1000 for a remote host)
  --timeout-ms N           per request (default 15000)
  --canonical-host HOST    host the candidate canonicals must use (default: the live canonical host)
  --site-name NAME         site name used to recognise a title suffix (default "Sakola Kembara")
  --allow-host HOST        another host a redirect may stay on (repeatable)
  --out DIR                where report.md and report.json go (default ./.seo-parity)
  --record DIR             save every answer under DIR/live and DIR/candidate, for an offline rerun
  --fail-on blocker|warn   exit 1 on blockers (default) or on warnings too
  --dry-run                print the plan and exit; no request is sent
  --quiet                  no progress lines
  -h, --help
`;

/**
 * Paths of the new site and the legacy entry points: the main pages every run checks, in WordPress spelling (trailing slash).
 * `/laporan/` is not written out here any more (SAKEM-105): it is a page that moved, so it is a static source of the redirect
 * table (a 308 to `/donasi#laporan`) and comes in with the other redirects below, compared as a redirect to a page that exists.
 */
export const MAIN_PATHS = [
  '/', '/blog/', '/tim/', '/kontak/', '/donasi/', '/gabung-siswa/', '/gabung-siswa/docs/',
  '/program/prapembinaan/', '/program/pembinaan/', '/program/pasca-pembinaan/',
  ...Object.keys(REDIRECTS).filter((p) => !p.includes('[') && !['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/gabung-siswa/form'].includes(p)).map((p) => (/\.[a-z]+$/i.test(p) ? p : `${p}/`)),
  '/blog/page/2/', '/feed/atom/',
  // The registration link (SAKEM-103, Phase A): not a rule of the redirect table any more (it is an admin shortlink: a 308 for the slash, then
  // a 307 to the form), so it is listed here, in WordPress's spelling, to keep comparing it with the live 301 to the same form.
  '/daftar/',
];

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        'live-base': { type: 'string' }, 'candidate-base': { type: 'string' }, 'live-dir': { type: 'string' }, 'candidate-dir': { type: 'string' },
        'allow-network': { type: 'boolean' }, sitemap: { type: 'string', multiple: true }, 'candidate-sitemap': { type: 'string' },
        extra: { type: 'string' }, 'no-main': { type: 'boolean' }, 'no-articles': { type: 'boolean' }, 'no-wp-ids': { type: 'boolean' }, 'include-images': { type: 'boolean' },
        max: { type: 'string' }, 'delay-ms': { type: 'string' }, 'timeout-ms': { type: 'string' }, 'canonical-host': { type: 'string' },
        'site-name': { type: 'string' }, 'allow-host': { type: 'string', multiple: true }, out: { type: 'string' }, record: { type: 'string' },
        'fail-on': { type: 'string' }, 'dry-run': { type: 'boolean' }, quiet: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const v = parsed.values;
  if (v.help) return { help: true };

  const int = (name, def, min, max) => {
    if (v[name] === undefined) return def;
    if (!/^\d+$/.test(v[name]) || Number(v[name]) < min || Number(v[name]) > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
    return Number(v[name]);
  };
  const origin = (name) => {
    if (v[name] === undefined) return null;
    let u;
    try {
      u = new URL(v[name]);
    } catch {
      throw new UsageError(`--${name} is not a URL: ${v[name]}`);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UsageError(`--${name} must be http or https`);
    if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) throw new UsageError(`--${name} must be an origin without a path, query or fragment (https://host)`);
    return u.origin;
  };

  const live = { base: origin('live-base'), dir: v['live-dir'] ?? null };
  const candidate = { base: origin('candidate-base'), dir: v['candidate-dir'] ?? null };
  if ((!live.base && !live.dir) || (!candidate.base && !candidate.dir)) {
    throw new UsageError('both sides are required: --live-base and --candidate-base (network), or --live-dir / --candidate-dir (recorded). Nothing was requested.');
  }
  const failOn = v['fail-on'] ?? 'blocker';
  if (failOn !== 'blocker' && failOn !== 'warn') throw new UsageError('--fail-on must be blocker or warn');

  const networkSides = [['live', live], ['candidate', candidate]].filter(([, s]) => !s.dir);
  const remote = networkSides.filter(([, s]) => !isLoopbackUrl(s.base));
  if (remote.length && !v['allow-network']) {
    throw new UsageError(`${remote.map(([n]) => n).join(' and ')} base would send requests to a public host (${remote.map(([, s]) => new URL(s.base).host).join(', ')}). Add --allow-network once Dzul has approved the run.`);
  }
  if (live.base && candidate.base && !live.dir && !candidate.dir && new URL(live.base).origin === new URL(candidate.base).origin) {
    throw new UsageError('the live base and the candidate base are the same origin: nothing to compare');
  }
  const delayMs = int('delay-ms', 1000, 0, 60_000);
  if (remote.length && delayMs < 1000) throw new UsageError('--delay-ms below 1000 is only allowed for localhost: one request per second to a remote host at most');
  if (v.record && !networkSides.length) throw new UsageError('--record needs at least one network side (both sides are recorded already)');

  return {
    live, candidate,
    allowNetwork: Boolean(v['allow-network']),
    sitemaps: v.sitemap ?? [],
    candidateSitemap: v['candidate-sitemap'] ?? '/sitemap.xml',
    extra: v.extra ?? null,
    main: !v['no-main'], articles: !v['no-articles'], wpIds: !v['no-wp-ids'], images: Boolean(v['include-images']),
    max: int('max', 500, 1, 5000),
    delayMs,
    timeoutMs: int('timeout-ms', 15_000, 1000, 120_000),
    canonicalHost: v['canonical-host'] ?? null,
    siteName: v['site-name'] ?? 'Sakola Kembara',
    extraHosts: v['allow-host'] ?? [],
    out: v.out ?? '.seo-parity',
    record: v.record ?? null,
    failOn, dryRun: Boolean(v['dry-run']), quiet: Boolean(v.quiet),
  };
}

function articlesFromFile(file = ARTICLES_FILE) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return {
    articlePaths: data.articles.map((a) => new URL(a.sourceUrl).pathname),
    wpIdPaths: data.articles.filter((a) => a.wpId).map((a) => `/?p=${a.wpId}`),
  };
}

/** Path (and query) of a sitemap <loc>: the host is ignored on purpose, a sitemap lists the site's own URLs. */
function locPath(loc) {
  try {
    const u = new URL(loc);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

const asPath = (value) => (value.startsWith('/') ? value : (locPath(value) ?? value));

/** Reads a sitemap (index or urlset) through a source, following at most 50 child files, two levels deep. */
export async function readSitemaps(source, starts, { maxFiles = 50 } = {}) {
  const files = [];
  const urls = [];
  const images = [];
  let firstStatus = null;
  const queue = starts.map((s) => ({ path: asPath(s), depth: 0 }));
  const seen = new Set();
  while (queue.length && files.length < maxFiles) {
    const { path: p, depth } = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    const answer = await source.get(`${source.base}${p}`);
    const final = answer.final;
    if (firstStatus === null) firstStatus = final ? final.status : null;
    if (!final || final.status !== 200) continue;
    const sitemap = parseSitemap(final.body);
    if (sitemap.kind === 'unknown') continue;
    files.push(p);
    for (const entry of sitemap.entries) {
      const lp = locPath(entry.loc);
      if (!lp) continue;
      if (sitemap.kind === 'index') {
        if (depth < 2) queue.push({ path: lp, depth: depth + 1 });
      } else {
        urls.push(lp);
        for (const img of entry.images ?? []) {
          try {
            if (new URL(img).host === new URL(entry.loc).host) images.push(locPath(img));
          } catch {
            // not a URL
          }
        }
      }
    }
  }
  return { files, urls, images, status: firstStatus };
}

function makeSource(side, options, label, deps) {
  if (side.dir) return createRecordedSource({ dir: side.dir, base: side.base ?? undefined, extraHosts: options.extraHosts });
  const recorder = options.record ? createRecorder({ dir: path.join(options.record, label), base: side.base, extraHosts: options.extraHosts }) : null;
  const source = createNetworkSource({
    base: side.base, delayMs: options.delayMs, timeoutMs: options.timeoutMs, extraHosts: options.extraHosts,
    fetchImpl: deps.fetchImpl, sleep: deps.sleep, now: deps.now, recorder,
  });
  source.recorder = recorder;
  return source;
}

/** Builds the URL set from the local sources only (no request). */
export function localUrlSources(options, deps = {}) {
  const hosts = siteHosts(options.live.base ?? 'https://example.invalid', options.extraHosts);
  let extraPaths = [];
  let ignored = [];
  if (options.extra) {
    const parsed = parseUrlList((deps.readText ?? ((f) => readFileSync(f, 'utf8')))(options.extra), hosts);
    extraPaths = parsed.paths;
    ignored = parsed.ignored;
  }
  const wanted = options.articles || options.wpIds ? (deps.articles ?? articlesFromFile)() : { articlePaths: [], wpIdPaths: [] };
  return {
    mainPaths: options.main ? MAIN_PATHS : [],
    articlePaths: options.articles ? wanted.articlePaths : [],
    wpIdPaths: options.wpIds ? wanted.wpIdPaths : [],
    extraPaths,
    ignored,
  };
}

/** Prints what a run would do and returns it. No request is sent. */
export function planRun(options, deps = {}) {
  const local = localUrlSources(options, deps);
  const set = buildUrlSet({ ...local, max: options.max });
  const perHost = Math.max(1, options.delayMs) / 1000;
  const estimate = set.urls.length * 2 + 12;
  return {
    live: options.live, candidate: options.candidate,
    sources: { main: local.mainPaths.length, articles: local.articlePaths.length, wpIds: local.wpIdPaths.length, extra: local.extraPaths.length, ignoredExtra: local.ignored.length, sitemap: 'read at run time from the live site' },
    urlsBeforeSitemap: set.total,
    maxRequestsEstimate: estimate,
    minutesEstimate: Math.ceil((estimate * perHost) / 60 / 2),
    first: set.urls.slice(0, 10).map((u) => u.path),
  };
}

/**
 * The whole run. Returns { exitCode, summary, markdown, json, files }.
 * @param {ReturnType<typeof parseCli>} options
 */
export async function runFromOptions(options, deps = {}) {
  const log = deps.log ?? ((line) => process.stderr.write(`${line}\n`));
  const now = deps.now ?? Date.now;
  const live = makeSource(options.live, options, 'live', deps);
  const candidate = makeSource(options.candidate, options, 'candidate', deps);

  // robots.txt of both sides
  const fetchText = async (source, p) => {
    const answer = await source.get(`${source.base}${p}`);
    return answer.final && answer.final.status === 200 ? answer.final.body : null;
  };
  const liveRobotsRaw = await fetchText(live, '/robots.txt');
  const candidateRobotsRaw = await fetchText(candidate, '/robots.txt');
  const liveRobots = liveRobotsRaw == null ? null : parseRobotsTxt(liveRobotsRaw);
  const candidateRobots = candidateRobotsRaw == null ? null : parseRobotsTxt(candidateRobotsRaw);

  // live sitemaps
  const robotsSitemaps = (liveRobots?.sitemaps ?? []).map(asPath);
  const sitemapStarts = options.sitemaps.length ? options.sitemaps : [...robotsSitemaps, '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap.xml'];
  let liveMaps = { files: [], urls: [], images: [] };
  if (options.sitemaps.length) liveMaps = await readSitemaps(live, sitemapStarts);
  else {
    // the first default that yields a sitemap
    for (const start of sitemapStarts) {
      const attempt = await readSitemaps(live, [start]);
      if (attempt.files.length) {
        liveMaps = attempt;
        break;
      }
    }
  }
  const candidateMaps = await readSitemaps(candidate, [options.candidateSitemap]);
  const candidateSitemap = new Set(candidateMaps.urls.map(pathKey));

  const local = localUrlSources(options, deps);
  const urlSet = buildUrlSet({ ...local, sitemapPaths: liveMaps.urls, imagePaths: options.images ? liveMaps.images : [], max: options.max });

  if (!options.quiet) log(`${urlSet.urls.length} URL(s) to compare (${urlSet.total} found${urlSet.truncated ? `, ${urlSet.truncated} cut by --max` : ''}); live sitemap files: ${liveMaps.files.length}`);
  const results = await compareUrls({
    live, candidate, urls: urlSet.urls, liveRobots, candidateRobots, candidateSitemap: candidateMaps.files.length ? candidateSitemap : null,
    siteName: options.siteName, canonicalHost: options.canonicalHost, extraHosts: options.extraHosts,
    onProgress: (i, n, p) => {
      if (!options.quiet && (i % 10 === 0 || i === n)) log(`  ${i}/${n} ${p}`);
    },
  });

  const site = {
    ...siteChecks({ liveRobotsRaw, candidateRobotsRaw, candidateSitemapStatus: candidateMaps.status, candidateSitemapUrls: candidateSitemap }),
    liveSitemapFiles: liveMaps.files,
    candidateSitemapUrlCount: candidateSitemap.size,
  };
  const summary = summarize(results, site);
  const pass = options.failOn === 'warn' ? summary.pass && summary.warn === 0 : summary.pass;
  const meta = {
    generatedAt: new Date(now()).toISOString(),
    userAgent: USER_AGENT,
    liveBase: live.base, candidateBase: candidate.base, liveMode: live.mode, candidateMode: candidate.mode,
    canonicalHost: options.canonicalHost ?? 'the live canonical host',
    max: options.max, delayMs: options.delayMs, timeoutMs: options.timeoutMs, failOn: options.failOn,
    requests: { live: live.stats.requests, candidate: candidate.stats.requests },
  };
  const report = { meta, results, site, summary: { ...summary, pass }, urlSet: { total: urlSet.total, truncated: urlSet.truncated } };
  const markdown = renderMarkdown(report);
  const json = toJson(report);

  const files = [];
  if (options.out) {
    mkdirSync(options.out, { recursive: true });
    const md = path.join(options.out, 'report.md');
    const js = path.join(options.out, 'report.json');
    writeFileSync(md, markdown);
    writeFileSync(js, `${JSON.stringify(json, null, 2)}\n`);
    files.push(md, js);
  }
  for (const source of [live, candidate]) if (source.recorder) files.push(`${source.recorder.dir} (${source.recorder.flush()} answers)`);
  return { exitCode: pass ? 0 : 1, summary: report.summary, markdown, json, files };
}

export async function main(argv, deps = {}) {
  const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
  let options;
  try {
    options = parseCli(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      err(`seo-parity: ${error.message}`);
      err('Run with --help for the options.');
      return 2;
    }
    throw error;
  }
  if (options.help) {
    out(HELP);
    return 0;
  }
  if (options.dryRun) {
    out(JSON.stringify(planRun(options, deps), null, 2));
    out('dry run: no request was sent.');
    return 0;
  }
  try {
    const result = await runFromOptions(options, { ...deps, log: deps.log ?? err });
    const s = result.summary;
    out(`${s.pass ? 'PASS' : 'FAIL'}: ${s.compared} URL(s): ${s.blocker} blocker(s), ${s.warn} warning(s), ${s.info} info only, ${s.ok} identical, ${s.skipped} skipped; ${s.siteBlockers} site-level blocker(s).`);
    for (const f of result.files) out(`wrote ${f}`);
    return result.exitCode;
  } catch (error) {
    err(`seo-parity: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));
