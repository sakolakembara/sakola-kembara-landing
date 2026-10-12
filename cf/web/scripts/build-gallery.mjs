// Build-time photo galleries for the program pages.
//
// The legacy app lists public/images/program/galeri/<program-id>/ with readdir()
// at request time (lib/gallery.ts). A Worker has no file system, so the listing
// happens here instead, once per build:
//
//   public/images/program/galeri/<program-id>/1.jpg, 2.jpg, ...   (repo root, the source of truth)
//        |  this script (sharp)
//        v
//   cf/web/public/images/program/galeri/<program-id>/<stem>.<hash>-<width>.webp   (served by the assets layer)
//   cf/web/src/lib/gallery.generated.ts                                           (the typed manifest)
//
// Adding a photo is still "drop a file in the folder": run the build. Both outputs
// are gitignored. The manifest type is GalleryManifest in src/lib/gallery-types.ts.
//
// Rules, kept from lib/gallery.ts: only jpg/jpeg/png/webp/avif files count; numbered
// files come first in numeric order (2.jpg before 10.jpg), other names follow in
// alphabetical order; a folder name must be [a-z0-9-]+ (nothing escapes the root).
// New: EXIF orientation is applied, nothing is enlarged, and the file name carries a
// hash of the source bytes, so replacing a photo in place changes its URL (what the
// `?v=` suffix did on the Next app) and the files can be cached as immutable.
//
// Usage: node scripts/build-gallery.mjs [--source <dir>] [--out <dir>] [--manifest <file>]

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');

export const DEFAULTS = {
  source: path.join(repoRoot, 'public/images/program/galeri'),
  out: path.join(webRoot, 'public/images/program/galeri'),
  manifest: path.join(webRoot, 'src/lib/gallery.generated.ts'),
  /** Public URL of `out`; the files are served from the assets layer at this path. */
  urlBase: '/images/program/galeri',
};

/** Same extension list as the legacy lib/gallery.ts. */
export const IMAGE_RE = /\.(jpe?g|png|webp|avif)$/i;
const FOLDER_RE = /^[a-z0-9-]+$/i;

/**
 * Derivative widths, in CSS pixels x device pixel ratio. The grid shows a photo at
 * about 170 px (two columns on a phone) to 380 px (three columns in a 1200 px
 * container), so 480 and 960 cover 1x to 2.5x. A source narrower than a width is
 * never enlarged: its own width is used instead.
 */
export const WIDTHS = [480, 960];
export const WEBP_QUALITY = 78;
/** Bump when the encoding changes: it is part of every file hash, so URLs change too. */
const PIPELINE_VERSION = 1;

/** Legacy order: "2.jpg" < "10.jpg", names that are not numbers come after, alphabetically. */
export function compareNames(a, b) {
  const an = Number(a.replace(IMAGE_RE, ''));
  const bn = Number(b.replace(IMAGE_RE, ''));
  const aNum = Number.isFinite(an);
  const bNum = Number.isFinite(bn);
  if (aNum && bNum && an !== bn) return an - bn;
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a.localeCompare(b);
}

const slug = (stem) => stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'foto';

/** Size of the image as displayed, i.e. after EXIF orientation 5-8 swapped the axes. */
function orientedSize({ width, height, orientation }) {
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

async function encode(bytes, outFile, width) {
  // rotate() with no argument applies the EXIF orientation and strips the tag.
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  await mkdir(path.dirname(outFile), { recursive: true });
  // Written under a temporary name and renamed: a file that exists under its final name is complete.
  await writeFile(`${outFile}.tmp`, data);
  await rename(`${outFile}.tmp`, outFile);
  return { width: info.width, height: info.height };
}

async function processPhoto({ file, name, id, out, urlBase }) {
  const bytes = await readFile(file);
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new Error(`${file}: not a readable image`);
  const source = orientedSize(meta);

  const hash = createHash('sha1')
    .update(JSON.stringify([PIPELINE_VERSION, WEBP_QUALITY, WIDTHS, name]))
    .update(bytes)
    .digest('hex')
    .slice(0, 8);
  const stem = slug(name.replace(IMAGE_RE, ''));

  const widths = [...new Set(WIDTHS.map((w) => Math.min(w, source.width)))].sort((a, b) => a - b);
  const variants = [];
  const files = [];
  for (const w of widths) {
    const fileName = `${stem}.${hash}-${w}.webp`;
    const outFile = path.join(out, id, fileName);
    files.push(outFile);
    // The hash is in the name: an existing file is already the right one.
    const size = existsSync(outFile) ? await sharp(outFile).metadata() : await encode(bytes, outFile, w);
    variants.push({ src: `${urlBase}/${id}/${fileName}`, width: size.width, height: size.height });
  }
  const largest = variants[variants.length - 1];
  return { photo: { name, width: largest.width, height: largest.height, variants }, files };
}

/** Remove derivatives nothing refers to (a replaced or deleted photo), then empty folders. */
async function prune(out, keep) {
  if (!existsSync(out)) return;
  for (const dir of await readdir(out, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(out, dir.name);
    for (const f of await readdir(dirPath)) {
      const filePath = path.join(dirPath, f);
      if (/\.(webp|tmp)$/.test(f) && !keep.has(filePath)) await rm(filePath);
    }
    if ((await readdir(dirPath)).length === 0) await rmdir(dirPath);
  }
}

/**
 * Read every program folder under `source`, write the derivatives under `out`,
 * and return the manifest ({ [programId]: GalleryPhoto[] }). A folder without
 * images gives []. A missing `source` gives {}.
 *
 * @param {{ source?: string, out?: string, urlBase?: string }} [options]
 * @returns {Promise<import('../src/lib/gallery-types').GalleryManifest>}
 */
export async function buildGallery({ source = DEFAULTS.source, out = DEFAULTS.out, urlBase = DEFAULTS.urlBase } = {}) {
  /** @type {import('../src/lib/gallery-types').GalleryManifest} */
  const manifest = {};
  const keep = new Set();
  const folders = existsSync(source) ? await readdir(source, { withFileTypes: true }) : [];

  for (const folder of folders.filter((e) => e.isDirectory() && FOLDER_RE.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const id = folder.name;
    const names = (await readdir(path.join(source, id))).filter((n) => IMAGE_RE.test(n)).sort(compareNames);
    manifest[id] = [];
    for (const name of names) {
      const file = path.join(source, id, name);
      const { photo, files } = await processPhoto({ file, name, id, out, urlBase }).catch((error) => {
        // A photo sharp cannot read fails the build: better than a page with a broken image.
        throw new Error(`build-gallery: ${file}: ${error.message}`, { cause: error });
      });
      manifest[id].push(photo);
      for (const f of files) keep.add(f);
    }
  }

  await prune(out, keep);
  return manifest;
}

/** @param {import('../src/lib/gallery-types').GalleryManifest} manifest */
export function manifestModule(manifest) {
  return `// Generated by scripts/build-gallery.mjs. Do not edit; not committed.
import type { GalleryManifest } from './gallery-types';

export const gallery: GalleryManifest = ${JSON.stringify(manifest, null, 2)};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string' }, manifest: { type: 'string' } } });
  const manifest = await buildGallery({
    source: values.source ? path.resolve(values.source) : DEFAULTS.source,
    out: values.out ? path.resolve(values.out) : DEFAULTS.out,
  });
  const file = values.manifest ? path.resolve(values.manifest) : DEFAULTS.manifest;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, manifestModule(manifest));
  const counts = Object.entries(manifest).map(([id, photos]) => `${id}: ${photos.length}`);
  console.log(`build-gallery: ${counts.join(', ') || 'no program folders'}`);
}
