// Asset pipeline: turns the legacy repo's public/ images and files into the
// static assets of this app. Run by `pnpm dev`, `pnpm test` and `pnpm build`
// (through `pnpm assets`); incremental, so a second run takes a second or two.
//
//   root public/images/**, public/blog/images/**   (never modified: the single source)
//     -> public/_img/<hash>-<w>.webp     WebP ladder, fingerprinted, immutable
//     -> public/<same path>              optimized file in the original format, so old
//                                        links and og:image URLs keep working
//     -> src/generated/image-manifest.json   typed through src/lib/images.ts
//   root public/files/**
//     -> public/files/**                 copied; a PDF above 20 MiB is recompressed
//                                        (scripts/lib/pdf-shrink.mjs), same URL
//
// Everything written here is gitignored. Why and how: docs/cloudflare/web-skeleton.md,
// "Images and other static assets". Settings and limits: assets.config.mjs.
//
//   node scripts/build-assets.mjs                 full run
//   node scripts/build-assets.mjs --manifest-only only the manifest (cheap; `pnpm check` uses it)

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  ENCODE,
  FILES_DIR,
  GENERATED_DIRS,
  IMAGE_DIRS,
  LIMITS,
  MAX_WIDTH,
  PIPELINE_VERSION,
  RASTER_RE,
  WIDTHS,
  rungHeight,
  rungsFor,
  variantUrl,
} from '../assets.config.mjs';
import { shrinkPdf } from './lib/pdf-shrink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const sourceDir = path.resolve(webRoot, '../../public'); // legacy repo root public/
const outDir = path.join(webRoot, 'public');
const manifestFile = path.join(webRoot, 'src/generated/image-manifest.json');
const stateFile = path.join(webRoot, '.asset-state.json');

const posix = (p) => p.split(path.sep).join('/');
const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};
const mib = (n) => `${(n / 1048576).toFixed(2)} MiB`;
const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;

/** Every file under `dir`, as paths relative to it, sorted. Dotfiles and READMEs are not assets. */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || /^readme\.md$/i.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(posix(path.relative(dir, p)));
    }
  };
  walk(dir);
  return out.sort();
}

async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/** Write atomically (temp file, then rename), so a killed run never leaves a half file that looks fresh. */
function writeAtomic(dest, data) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, dest);
}

// ---------------------------------------------------------------- sources

const settingsKey = JSON.stringify({ v: PIPELINE_VERSION, ENCODE, MAX_WIDTH, WIDTHS });

/** The rasters and the other files of the root public/ that this app serves. */
function collectSources() {
  const rasters = [];
  const copies = [];
  for (const dir of IMAGE_DIRS) {
    for (const rel of listFiles(path.join(sourceDir, dir))) {
      const url = `/${dir}/${rel}`;
      const abs = path.join(sourceDir, dir, rel);
      (RASTER_RE.test(rel) ? rasters : copies).push({ url, abs });
    }
  }
  for (const rel of listFiles(path.join(sourceDir, FILES_DIR))) {
    copies.push({ url: `/${FILES_DIR}/${rel}`, abs: path.join(sourceDir, FILES_DIR, rel) });
  }
  if (rasters.length === 0) throw new Error(`build-assets: no images found under ${sourceDir}`);
  return { rasters, copies };
}

/** Hash, size and ladder of one raster: everything the manifest needs, without encoding. */
async function describeRaster({ url, abs }) {
  const bytes = await readFile(abs);
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height || !['jpeg', 'png', 'webp'].includes(meta.format ?? '')) {
    throw new Error(`build-assets: ${url} is not a readable jpeg/png/webp`);
  }
  const swap = (meta.orientation ?? 1) >= 5; // EXIF rotation is applied, so width and height trade places
  const sourceWidth = swap ? meta.height : meta.width;
  const sourceHeight = swap ? meta.width : meta.height;
  const variants = rungsFor(sourceWidth).map((width) => ({ width, height: rungHeight(width, sourceWidth, sourceHeight) }));
  const top = variants[variants.length - 1];
  const entry = { width: top.width, height: top.height, hash: sha(settingsKey, '\0', bytes).slice(0, 12), variants };
  return { url, abs, bytes, meta, sourceWidth, entry };
}

// ---------------------------------------------------------------- encoders

const base = (item, { width, height }) => sharp(item.bytes).rotate().resize({ width, height, fit: 'fill' });

/** The file served at the original URL: same format, capped at MAX_WIDTH, metadata stripped. */
async function encodeLegacy(item) {
  const { meta, entry, bytes } = item;
  let out;
  if (meta.format === 'jpeg') {
    out = await base(item, entry).jpeg({ quality: ENCODE.jpegQuality, mozjpeg: true }).toBuffer();
  } else if (meta.format === 'png') {
    out = await base(item, entry).png({ compressionLevel: 9, effort: 10 }).toBuffer();
    if (out.length > ENCODE.pngPaletteAboveBytes) {
      const palette = await base(item, entry)
        .png({ palette: true, quality: ENCODE.pngPaletteQuality, effort: 10, compressionLevel: 9 })
        .toBuffer();
      if (palette.length < out.length) out = palette;
    }
  } else {
    out = await base(item, entry).webp({ quality: ENCODE.webpQuality, effort: ENCODE.webpEffort }).toBuffer();
  }
  // Re-encoding an already small file can grow it: keep the original bytes then, unless they carry metadata.
  const untouched = entry.width === item.sourceWidth && !meta.exif && !meta.xmp && !meta.iptc;
  return untouched && out.length >= bytes.length ? bytes : out;
}

async function encodeVariant(item, variant) {
  const lossy = await base(item, variant)
    .webp({ quality: ENCODE.webpQuality, effort: ENCODE.webpEffort, smartSubsample: true, alphaQuality: 90 })
    .toBuffer();
  if (item.meta.format !== 'png') return lossy; // logos, screenshots and infographics: lossless is often smaller and crisper
  const lossless = await base(item, variant).webp({ lossless: true, effort: ENCODE.webpEffort }).toBuffer();
  return lossless.length <= lossy.length * ENCODE.losslessBias ? lossless : lossy;
}

// ---------------------------------------------------------------- main

export async function buildAssets({ manifestOnly = false, log = console.log } = {}) {
  const started = performance.now();
  const { rasters, copies } = collectSources();

  // 1. The manifest: a pure function of the source bytes and the settings.
  const described = [];
  await pool(rasters, 8, async (r) => void described.push(await describeRaster(r)));
  described.sort((a, b) => (a.url < b.url ? -1 : 1));
  const manifest = { version: PIPELINE_VERSION, images: Object.fromEntries(described.map((d) => [d.url, d.entry])) };
  // One image per line: compact for the bundle, still diffable by eye.
  const manifestJson = `{"version":${manifest.version},"images":{\n${Object.entries(manifest.images)
    .map(([url, entry]) => `${JSON.stringify(url)}:${JSON.stringify(entry)}`)
    .join(',\n')}\n}}\n`;
  if (!existsSync(manifestFile) || readFileSync(manifestFile, 'utf8') !== manifestJson) writeAtomic(manifestFile, manifestJson);
  if (manifestOnly) {
    log(`build-assets: manifest only, ${described.length} images (${Math.round(performance.now() - started)} ms)`);
    return null;
  }

  // 2. Encode what is not on disk yet.
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const next = { settings: settingsKey, legacy: {}, files: {} };
  const fresh = state.settings === settingsKey;
  const stats = { encoded: 0, reused: 0 };
  const expected = new Set(); // paths relative to outDir
  const bytesOf = new Map(); // generated path -> size, for the report

  // Identical sources (the blog has copies of the same photo) share one set of derivatives.
  const byHash = new Map();
  for (const d of described) byHash.set(d.entry.hash, [...(byHash.get(d.entry.hash) ?? []), d]);

  const jobs = [];
  for (const group of byHash.values()) {
    jobs.push(async () => {
      const item = group[0];
      // Derivatives: the name holds the hash, so an existing file is current by definition.
      for (const v of item.entry.variants) {
        const rel = variantUrl(item.entry.hash, v.width).slice(1);
        const dest = path.join(outDir, rel);
        if (!existsSync(dest)) {
          const data = await encodeVariant(item, v);
          const info = await sharp(data).metadata();
          if (info.width !== v.width || info.height !== v.height) throw new Error(`build-assets: ${item.url} ${v.width}w came out ${info.width}x${info.height}, planned ${v.width}x${v.height}`);
          writeAtomic(dest, data);
          stats.encoded++;
        } else stats.reused++;
      }
      // The original URL: one file per path, even when the content is shared.
      let encoded = null;
      for (const d of group) {
        const dest = path.join(outDir, d.url.slice(1));
        const current = fresh && state.legacy?.[d.url] === d.entry.hash && existsSync(dest);
        if (!current) {
          encoded ??= await encodeLegacy(item);
          writeAtomic(dest, encoded);
          stats.encoded++;
        } else stats.reused++;
        next.legacy[d.url] = d.entry.hash;
      }
    });
  }
  await pool(jobs, 4, (job) => job());

  // 3. Everything else (PDFs, svg, ...): copied; a PDF above the shrink threshold is recompressed.
  const pdfNotes = [];
  for (const c of copies) {
    const bytes = readFileSync(c.abs);
    const key = sha(settingsKey, '\0', bytes);
    const dest = path.join(outDir, c.url.slice(1));
    next.files[c.url] = key;
    if (fresh && state.files?.[c.url] === key && existsSync(dest)) {
      stats.reused++;
      continue;
    }
    if (/\.pdf$/i.test(c.url) && bytes.length > LIMITS.pdfShrinkAboveBytes) {
      const shrunk = await shrinkPdf(bytes);
      if (shrunk.bytes.length > LIMITS.maxFileBytes) {
        throw new Error(`build-assets: ${c.url} is still ${mib(shrunk.bytes.length)} after recompression; the limit is ${mib(LIMITS.maxFileBytes)} per asset. Host it on R2 instead (docs/cloudflare/web-skeleton.md, "Large PDFs").`);
      }
      pdfNotes.push(`${c.url}: ${mib(bytes.length)} -> ${mib(shrunk.bytes.length)} (${shrunk.replaced} images re-encoded, ${shrunk.pages} pages)`);
      writeAtomic(dest, shrunk.bytes);
    } else {
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(c.abs, `${dest}.tmp`);
      renameSync(`${dest}.tmp`, dest);
    }
    stats.encoded++;
  }

  // 4. Expected files, stale files removed, sizes measured.
  for (const d of described) {
    expected.add(d.url.slice(1));
    for (const v of d.entry.variants) expected.add(variantUrl(d.entry.hash, v.width).slice(1));
  }
  for (const c of copies) expected.add(c.url.slice(1));
  let pruned = 0;
  for (const dir of GENERATED_DIRS) {
    const root = path.join(outDir, dir);
    for (const rel of listFiles(root)) {
      const full = posix(path.join(dir, rel));
      if (!expected.has(full)) {
        rmSync(path.join(outDir, full));
        pruned++;
      }
    }
    pruneEmptyDirs(root);
  }
  writeAtomic(stateFile, `${JSON.stringify(next)}\n`);
  for (const rel of expected) bytesOf.set(rel, statSync(path.join(outDir, rel)).size);

  const report = makeReport({ described, copies, bytesOf, stats, pruned, pdfNotes, ms: performance.now() - started });
  log(formatReport(report));
  return report;
}

function pruneEmptyDirs(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) pruneEmptyDirs(path.join(dir, e.name));
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}

// ---------------------------------------------------------------- report

function makeReport({ described, copies, bytesOf, stats, pruned, pdfNotes, ms }) {
  const classes = new Map();
  const add = (name, patch) => {
    const c = classes.get(name) ?? { count: 0, source: 0, legacy: 0, webp: 0, largest: { path: '', bytes: 0 } };
    for (const [k, v] of Object.entries(patch)) if (typeof v === 'number') c[k] += v;
    if (patch.largest && patch.largest.bytes > c.largest.bytes) c.largest = patch.largest;
    classes.set(name, c);
  };
  const seenVariant = new Set();
  const overSoft = [];
  for (const d of described) {
    const name = d.url.startsWith('/blog/images/') ? 'blog images' : 'site images';
    const legacy = bytesOf.get(d.url.slice(1)) ?? 0;
    let webp = 0;
    let largest = { path: d.url, bytes: legacy };
    for (const v of d.entry.variants) {
      const rel = variantUrl(d.entry.hash, v.width).slice(1);
      const size = bytesOf.get(rel) ?? 0;
      if (!seenVariant.has(rel)) {
        seenVariant.add(rel);
        webp += size;
      }
      if (size > largest.bytes) largest = { path: `/${rel}`, bytes: size };
    }
    if (legacy > LIMITS.imageSoftBytes) overSoft.push(`${d.url} ${kib(legacy)} (${d.entry.width}x${d.entry.height})`);
    add(name, { count: 1, source: d.bytes.length, legacy, webp, largest });
  }
  for (const c of copies) {
    const out = bytesOf.get(c.url.slice(1)) ?? 0;
    add('files', { count: 1, source: statSync(c.abs).size, legacy: out, largest: { path: c.url, bytes: out } });
  }
  let totalBytes = 0;
  for (const size of bytesOf.values()) totalBytes += size;
  return { classes: Object.fromEntries(classes), files: bytesOf.size, totalBytes, uniqueVariants: seenVariant.size, stats, pruned, pdfNotes, overSoft, ms };
}

function formatReport(r) {
  const lines = [`build-assets: ${r.files} files, ${mib(r.totalBytes)} generated (${r.stats.encoded} written, ${r.stats.reused} reused, ${r.pruned} stale removed) in ${(r.ms / 1000).toFixed(1)} s`];
  for (const [name, c] of Object.entries(r.classes)) {
    lines.push(
      `  ${name.padEnd(12)} ${String(c.count).padStart(4)} sources ${mib(c.source).padStart(10)} -> original URLs ${mib(c.legacy).padStart(10)}` +
        (c.webp ? `, webp ladder ${mib(c.webp)}` : '') +
        `; largest ${c.largest.path} ${kib(c.largest.bytes)}`,
    );
  }
  for (const note of r.pdfNotes) lines.push(`  pdf ${note}`);
  if (r.overSoft.length > 0) lines.push(`  above ${kib(LIMITS.imageSoftBytes)} (original URL): ${r.overSoft.join('; ')}`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildAssets({ manifestOnly: process.argv.includes('--manifest-only') });
}
