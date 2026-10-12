// Audit of the built static assets (dist/client), shared by the build step
// (scripts/check-dist.mjs) and the tests. It fails on what would break a
// Workers Static Assets deploy or ship a broken image:
//
//   - a file above 25 MiB, or a file count above the budget (the limit is 20,000)
//   - an <img> without width/height/alt
//   - an <img src>, an <img srcset> candidate or an og:image/twitter:image that
//     points at a local file that is not in the output
//
// It reads the prerendered HTML only; pages rendered by the Worker (/blog, /tim,
// the 404) are covered by scripts/e2e.mjs, which applies `checkImgTag` to them.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { LIMITS } from '../../assets.config.mjs';

const SITE = 'https://sakolakembara.org';

/** Every file under `dir`, as { path (relative, posix), bytes }. */
export function walkFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ path: path.relative(dir, p).split(path.sep).join('/'), bytes: statSync(p).size });
    }
  };
  walk(dir);
  return out;
}

/** The attributes of one HTML start tag, as a lowercase-name map ("" for a bare attribute). */
export function parseAttrs(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/\s([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g)) attrs[m[1].toLowerCase()] = m[2] ?? '';
  return attrs;
}

/** Local URL paths named by an `src`/`srcset` value ("/a.webp 480w, /b.webp 768w" -> ["/a.webp", "/b.webp"]). */
export const localUrls = (value) =>
  value
    .split(',')
    .map((c) => c.trim().split(/\s+/)[0])
    .filter((u) => u.startsWith('/') && !u.startsWith('//'));

/**
 * Problems with one <img> tag, as strings (empty when it is fine). `exists`
 * answers whether a local URL path is served; it is skipped when omitted.
 */
export function checkImgTag(tag, exists) {
  const a = parseAttrs(tag);
  const problems = [];
  if (!/^\d+$/.test(a.width ?? '')) problems.push('no numeric width');
  if (!/^\d+$/.test(a.height ?? '')) problems.push('no numeric height');
  if (a.alt === undefined) problems.push('no alt');
  if (!a.src) problems.push('no src');
  if (exists) {
    for (const u of [...localUrls(a.src ?? ''), ...localUrls(a.srcset ?? '')]) {
      if (!exists(decodeURI(u.split(/[?#]/)[0]))) problems.push(`missing file ${u}`);
    }
  }
  return problems;
}

/** Audit `<dist>/client`. Returns the numbers for the report and the list of problems. */
export function auditDist(clientDir) {
  const files = walkFiles(clientDir);
  const served = new Set(files.map((f) => `/${f.path}`));
  const exists = (urlPath) => served.has(urlPath);
  const problems = [];

  if (files.length > LIMITS.budgetFiles) {
    problems.push(`${files.length} files in dist/client; the budget is ${LIMITS.budgetFiles} (Workers limit ${LIMITS.maxFiles})`);
  }
  for (const f of files) {
    if (f.bytes > LIMITS.maxFileBytes) problems.push(`/${f.path} is ${(f.bytes / 1048576).toFixed(1)} MiB; Workers Static Assets allows ${LIMITS.maxFileBytes / 1048576} MiB per file`);
  }

  const imgs = [];
  for (const f of files.filter((f) => f.path.endsWith('.html'))) {
    const html = readFileSync(path.join(clientDir, f.path), 'utf8');
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      const a = parseAttrs(m[0]);
      const found = checkImgTag(m[0], exists);
      imgs.push({ page: `/${f.path}`, src: a.src ?? '', width: a.width, height: a.height, srcset: a.srcset ? a.srcset.split(',').length : 0, loading: a.loading ?? '', problems: found });
      for (const p of found) problems.push(`${f.path}: <img src="${a.src}"> ${p}`);
    }
    for (const m of html.matchAll(/<meta\s+(?:property|name)="(?:og|twitter):image"\s+content="([^"]*)"/g)) {
      const url = m[1].startsWith(SITE) ? m[1].slice(SITE.length) : m[1];
      if (url.startsWith('/') && !exists(decodeURI(url.split(/[?#]/)[0]))) problems.push(`${f.path}: og/twitter image ${url} is not in the output`);
    }
  }

  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
  return { files: files.length, bytes, largest, imgs, problems };
}
