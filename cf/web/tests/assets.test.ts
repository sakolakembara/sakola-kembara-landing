import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { matchRedirect } from '../redirects.config.mjs';
import { FILES_DIR, IMAGE_DIRS, LIMITS, MAX_WIDTH, RASTER_RE, WIDTHS, assetUrl, rungsFor, srcsetFor, variantUrl } from '../assets.config.mjs';
import { auditDist, checkImgTag, localUrls, parseAttrs, walkFiles } from '../scripts/lib/dist-audit.mjs';
import { getImage, imgAttrs } from '~/lib/images';
import { readWeb, repoRoot, webRoot } from './helpers';

// The asset pipeline (scripts/build-assets.mjs) and its guards. `pnpm test` runs
// the pipeline first, so cf/web/public/ and the manifest are current here; the
// checks on dist/ need `pnpm build` and are skipped without it.

const out = path.join(webRoot, 'public');
const manifest = JSON.parse(readWeb('src/generated/image-manifest.json')) as {
  images: Record<string, { width: number; height: number; hash: string; variants: { width: number; height: number }[] }>;
};
const entries = Object.entries(manifest.images);
const walk = (dir: string): string[] => (existsSync(dir) ? walkFiles(dir).map((f: { path: string }) => f.path) : []);
const formatOf = (file: string) => (/\.jpe?g$/i.test(file) ? 'jpeg' : /\.png$/i.test(file) ? 'png' : 'webp');

describe('width ladder', () => {
  it('never upscales, stays ascending, ends at the capped source width and skips near-duplicates', () => {
    for (let w = 1; w <= 6000; w += 7) {
      const rungs = rungsFor(w) as number[];
      expect(rungs.at(-1), `w=${w}`).toBe(Math.min(w, MAX_WIDTH));
      expect([...rungs].sort((a, b) => a - b), `w=${w}`).toEqual(rungs);
      expect(new Set(rungs).size, `w=${w}`).toBe(rungs.length);
      for (const r of rungs.slice(0, -1)) {
        expect(WIDTHS, `w=${w}`).toContain(r);
        expect(r, `w=${w}`).toBeLessThan(rungs.at(-1)! * 0.9);
      }
    }
  });

  it('gives the expected ladders for typical sources', () => {
    expect(rungsFor(4592)).toEqual([480, 768, 1200, 1600]);
    expect(rungsFor(1304)).toEqual([480, 768, 1304]);
    expect(rungsFor(1024)).toEqual([480, 768, 1024]);
    expect(rungsFor(500)).toEqual([500]);
    expect(rungsFor(300)).toEqual([300]);
  });

  it('builds srcset from an entry, optionally from a minimum width', () => {
    const entry = { width: 1200, height: 800, hash: 'abc123abc123', variants: [{ width: 480, height: 320 }, { width: 768, height: 512 }, { width: 1200, height: 800 }] };
    expect(srcsetFor(entry)).toBe('/_img/abc123abc123-480.webp 480w, /_img/abc123abc123-768.webp 768w, /_img/abc123abc123-1200.webp 1200w');
    expect(srcsetFor(entry, 700)).toBe('/_img/abc123abc123-768.webp 768w, /_img/abc123abc123-1200.webp 1200w');
    expect(srcsetFor(entry, 5000)).toBe('/_img/abc123abc123-1200.webp 1200w');
  });
});

describe('manifest and generated output', () => {
  it('has an entry for every raster of the root public/images and public/blog/images, and no other', () => {
    const sources: string[] = [];
    for (const dir of IMAGE_DIRS) for (const rel of walk(path.join(repoRoot, 'public', dir))) if (RASTER_RE.test(rel)) sources.push(`/${dir}/${rel}`);
    expect(sources.length).toBeGreaterThan(250);
    expect(entries.map(([url]) => url).sort()).toEqual(sources.sort());
  });

  it('serves every original URL as a real image of the same format, at most 1600 px wide, without metadata', async () => {
    for (const [url, entry] of entries) {
      const file = path.join(out, url);
      expect(existsSync(file), url).toBe(true);
      const meta = await sharp(file).metadata();
      expect(meta.format, url).toBe(formatOf(url));
      expect(meta.width, url).toBe(entry.width);
      expect(meta.height, url).toBe(entry.height);
      expect(entry.width, url).toBeLessThanOrEqual(MAX_WIDTH);
      expect(meta.exif, `${url} keeps EXIF`).toBeUndefined();
      expect(meta.xmp, `${url} keeps XMP`).toBeUndefined();
    }
  });

  it('has every WebP variant at exactly the planned size, and every image file under 1 MiB', async () => {
    const seen = new Set<string>();
    for (const [url, entry] of entries) {
      expect(statSync(path.join(out, url)).size, url).toBeLessThanOrEqual(LIMITS.imageSoftBytes);
      expect(entry.variants.at(-1), url).toEqual({ width: entry.width, height: entry.height });
      for (const v of entry.variants) {
        const rel = variantUrl(entry.hash, v.width);
        if (seen.has(rel)) continue;
        seen.add(rel);
        const file = path.join(out, rel);
        expect(existsSync(file), rel).toBe(true);
        expect(statSync(file).size, rel).toBeLessThanOrEqual(LIMITS.imageSoftBytes);
        const meta = await sharp(file).metadata();
        expect(meta.format, rel).toBe('webp');
        expect({ w: meta.width, h: meta.height }, rel).toEqual({ w: v.width, h: v.height });
      }
    }
    // Identical sources share their derivatives; nothing else is in /_img.
    expect(readdirSync(path.join(out, '_img')).sort()).toEqual([...seen].map((u) => u.split('/').pop()!).sort());
  });

  it('keeps the aspect ratio of the source on every rung', () => {
    for (const [url, entry] of entries) {
      const ratio = entry.width / entry.height;
      for (const v of entry.variants) expect(Math.abs(v.width / v.height - ratio) / ratio, `${url} ${v.width}`).toBeLessThan(0.02);
    }
  });

  it('keeps the output small: files well under the Workers limit, nothing above 25 MiB', () => {
    const files = walkFiles(out) as { path: string; bytes: number }[];
    expect(files.length).toBeLessThan(LIMITS.budgetFiles);
    for (const f of files) expect(f.bytes, f.path).toBeLessThan(LIMITS.maxFileBytes);
  });

  it('has no stale generated file: everything under the generated folders is in the manifest or a source file', () => {
    const expected = new Set<string>();
    for (const [url, entry] of entries) {
      expected.add(url);
      for (const v of entry.variants) expected.add(variantUrl(entry.hash, v.width));
    }
    for (const rel of walk(path.join(repoRoot, 'public', FILES_DIR))) expected.add(`/${FILES_DIR}/${rel}`);
    for (const dir of [...IMAGE_DIRS, FILES_DIR, '_img']) {
      for (const rel of walk(path.join(out, dir))) {
        const url = `/${dir}/${rel}`;
        if (!expected.has(url) && !existsSync(path.join(repoRoot, 'public', url))) expect.fail(`stale file ${url}`);
      }
    }
  });
});

describe('images referenced by the site', () => {
  const articles = readdirSync(`${repoRoot}content/blog`).filter((f) => f.endsWith('.md') && f !== 'README.md');
  const refs = new Map<string, string>(); // url -> first article that uses it
  for (const file of articles) {
    const text = readFileSync(`${repoRoot}content/blog/${file}`, 'utf8');
    const cover = text.match(/^image:\s*"?([^"\n]*)"?/m)?.[1];
    if (cover) refs.set(cover, file);
    for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) refs.set(m[1], file);
  }
  const local = [...refs].filter(([url]) => url.startsWith('/'));

  it('every cover and inline image of the 80 articles is in the manifest and in the output', () => {
    expect(articles).toHaveLength(80);
    expect(local.length).toBeGreaterThan(90);
    for (const [url, file] of local) {
      expect(manifest.images[url], `${url} (${file}) is not in the manifest`).toBeDefined();
      expect(existsSync(path.join(out, url)), `${url} (${file}) is not in the output`).toBe(true);
    }
  });

  it('every blog image is reachable through the old WordPress path too (/wp-content/uploads/... -> /blog/images/...)', () => {
    const blog = entries.filter(([url]) => url.startsWith('/blog/images/'));
    expect(blog.length).toBeGreaterThan(200);
    for (const [url] of blog) {
      const hit = matchRedirect(url.replace('/blog/images/', '/wp-content/uploads/'));
      expect(hit, url).toEqual({ status: 308, location: url });
    }
  });

  it('no image path has a character other than letters, digits, / . _ - and @ (the assets layer answers @ with a redirect, so markup uses %40)', () => {
    for (const [url] of entries) expect(url, url).toMatch(/^[A-Za-z0-9/._@-]+$/);
    expect(assetUrl('/blog/images/2026/04/a@-1.jpg')).toBe('/blog/images/2026/04/a%40-1.jpg');
    const cover = '/blog/images/2026/04/IMG_9167@-1353469099-Azkiya-Najwah-3-scaled.jpg';
    expect(manifest.images[cover]).toBeDefined();
    expect(imgAttrs(cover, '100vw').src).toBe(assetUrl(cover));
    expect(imgAttrs(cover, '100vw').src).not.toContain('@');
  });

  it('getImage fails on an unknown path and imgAttrs points at files that exist', () => {
    expect(() => getImage('/images/does-not-exist.png')).toThrow(/asset manifest/);
    const attrs = imgAttrs('/images/hero-team.png', '100vw');
    expect(attrs.src).toBe('/images/hero-team.png');
    expect(attrs.sizes).toBe('100vw');
    expect(attrs.width).toBe(manifest.images['/images/hero-team.png'].width);
    for (const u of localUrls(attrs.srcset) as string[]) expect(existsSync(path.join(out, u)), u).toBe(true);
    expect(imgAttrs('/images/hero-team.png', '100vw', { minWidth: 1000 }).srcset.split(',')).toHaveLength(1);
  });
});

describe('PDFs', () => {
  const big = ['pitchdeck-sakola-kembara.pdf', 'kurikulum-khusus-sakola-kembara.pdf'];

  it('keeps every file URL of root public/files and serves each under the 25 MiB asset limit', () => {
    for (const rel of walk(path.join(repoRoot, 'public', FILES_DIR))) {
      const file = path.join(out, FILES_DIR, rel);
      expect(existsSync(file), rel).toBe(true);
      expect(statSync(file).size, rel).toBeLessThan(LIMITS.maxFileBytes);
    }
  });

  it('recompressed the two big decks without changing pages, text, or dimensions', async () => {
    for (const name of big) {
      const original = readFileSync(path.join(repoRoot, 'public', FILES_DIR, name));
      const served = readFileSync(path.join(out, FILES_DIR, name));
      expect(original.length, `${name} was not over the limit any more: drop the recompression`).toBeGreaterThan(LIMITS.maxFileBytes);
      expect(served.subarray(0, 5).toString()).toBe('%PDF-');
      expect(served.length).toBeLessThan(original.length);
      const [a, b] = await Promise.all([PDFDocument.load(original, { updateMetadata: false }), PDFDocument.load(served, { updateMetadata: false })]);
      expect(b.getPageCount()).toBe(a.getPageCount());
      expect(b.getPage(0).getSize()).toEqual(a.getPage(0).getSize());
      expect(b.getTitle()).toBe(a.getTitle());
    }
  });
});

describe('dist audit (the build guard)', () => {
  const fixture = (files: Record<string, string | number>) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sakem-audit-'));
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(dir, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, typeof content === 'string' ? content : '');
      if (typeof content === 'number') truncateSync(file, content); // sparse: a 26 MiB file that costs nothing
    }
    return dir;
  };
  const page = (img: string, head = '') => `<!doctype html><html><head>${head}</head><body>${img}</body></html>`;

  it('passes a page whose images are sized and present', () => {
    const dir = fixture({
      'index.html': page('<img src="/images/a.png" srcset="/_img/x-480.webp 480w, /_img/x-768.webp 768w" width="768" height="512" alt="">', '<meta property="og:image" content="https://sakolakembara.org/og.jpg">'),
      'images/a.png': 'x',
      '_img/x-480.webp': 'x',
      '_img/x-768.webp': 'x',
      'og.jpg': 'x',
    });
    try {
      expect(auditDist(dir).problems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('fails on a file above 25 MiB', () => {
    const dir = fixture({ 'files/big.pdf': LIMITS.maxFileBytes + 1 });
    try {
      expect(auditDist(dir).problems.join('\n')).toMatch(/big\.pdf is 25\.0 MiB/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('fails on an <img> without width or height, with a missing src file or srcset file, and a missing og:image', () => {
    const dir = fixture({
      'index.html': page(
        '<img src="/images/a.png" alt="a"><img src="/images/missing.png" width="1" height="1" alt=""><img src="/images/a.png" srcset="/_img/gone-480.webp 480w" width="1" height="1" alt="">',
        '<meta property="og:image" content="https://sakolakembara.org/images/nope.jpg">',
      ),
      'images/a.png': 'x',
    });
    try {
      const problems = auditDist(dir).problems.join('\n');
      expect(problems).toContain('no numeric width');
      expect(problems).toContain('no numeric height');
      expect(problems).toContain('missing file /images/missing.png');
      expect(problems).toContain('missing file /_img/gone-480.webp');
      expect(problems).toContain('og/twitter image /images/nope.jpg');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('fails when the file count passes the budget', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= LIMITS.budgetFiles; i++) files[`f/${i}.txt`] = '';
    const dir = fixture(files);
    try {
      expect(auditDist(dir).problems.join('\n')).toMatch(/files in dist\/client; the budget is/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('flags a literal @ in an image URL, accepts %40, and maps %40 back to the file', () => {
    expect(checkImgTag('<img src="/blog/images/a@b.jpg" width="1" height="1" alt="">', () => true).join()).toContain('literal @');
    expect(checkImgTag('<img src="/blog/images/a%40b.jpg" width="1" height="1" alt="">', (p: string) => p === '/blog/images/a@b.jpg')).toEqual([]);
  });

  it('parses attributes and local URLs', () => {
    expect(parseAttrs('<img src="/a.png" alt="" width="3" loading="lazy">')).toEqual({ src: '/a.png', alt: '', width: '3', loading: 'lazy' });
    expect(localUrls('/a.webp 480w, https://x/b.webp 2x, //cdn/c.webp 1x, /d.webp 768w')).toEqual(['/a.webp', '/d.webp']);
    expect(checkImgTag('<img src="/a.png" width="1" height="1" alt="">', () => true)).toEqual([]);
  });

  const dist = path.join(webRoot, 'dist/client');
  it.skipIf(!existsSync(path.join(dist, 'index.html')))('the built dist/client has no problems and lists its images', () => {
    const audit = auditDist(dist);
    expect(audit.problems).toEqual([]);
    expect(audit.imgs.length).toBeGreaterThan(300);
    expect(audit.files).toBeLessThan(LIMITS.budgetFiles);
  });
});

describe('_headers', () => {
  // Rules that match one path are merged by the assets layer, so two Cache-Control lines would be joined into one invalid value.
  type Rule = { pattern: string; headers: Record<string, string> };
  const parse = (text: string): Rule[] => {
    const rules: Rule[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: {} });
      else {
        const [name, ...rest] = line.trim().split(':');
        rules.at(-1)!.headers[name.toLowerCase()] = rest.join(':').trim();
      }
    }
    return rules;
  };
  const matches = (pattern: string, url: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(url);
  const files = [['public/_headers', readWeb('public/_headers')], ...(existsSync(path.join(webRoot, 'dist/client/_headers')) ? [['dist/client/_headers', readWeb('dist/client/_headers')]] : [])];

  it.each(files)('%s: fingerprinted images are immutable for a year, original URLs are not', (_name, text) => {
    const rules = parse(text);
    const cache = (url: string) => rules.filter((r) => matches(r.pattern, url) && r.headers['cache-control']).map((r) => r.headers['cache-control']);
    expect(cache('/_img/0123456789ab-480.webp')).toEqual(['public, max-age=31536000, immutable']);
    for (const url of ['/images/hero-team.png', '/blog/images/2025/10/1.png', '/files/pitchdeck-sakola-kembara.pdf']) {
      const [value, ...extra] = cache(url);
      expect(extra, url).toEqual([]);
      expect(value, url).toBeDefined();
      expect(value, url).not.toContain('immutable');
    }
  });

  it.each(files)('%s: at most one Cache-Control rule matches any path', (_name, text) => {
    const rules = parse(text);
    for (const url of ['/', '/blog', '/blog/sejarah-sakola-kembara', '/_astro/a.css', '/_img/x-480.webp', '/images/a.png', '/blog/images/2025/a.png', '/files/a.pdf', '/favicon.ico', '/robots.txt']) {
      expect(rules.filter((r) => matches(r.pattern, url) && r.headers['cache-control']).length, url).toBeLessThanOrEqual(1);
    }
  });
});
