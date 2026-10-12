// The asset pipeline's numbers and naming rules, in one pure module (no Node
// imports) so the build script, the blog plugin, the typed helper in
// src/lib/images.ts and the guards all agree. See docs/cloudflare/web-skeleton.md,
// "Images and other static assets".

/** Bump when an encoder setting below changes: it is part of every image hash. */
export const PIPELINE_VERSION = 1;

/** Responsive width ladder (CSS px). The top rung is capped at MAX_WIDTH. */
export const WIDTHS = [480, 768, 1200, 1600];
export const MAX_WIDTH = 1600;

/** WebP and JPEG encoder settings. Metadata (EXIF, GPS, ICC, XMP) is always dropped. */
export const ENCODE = {
  webpQuality: 80,
  webpEffort: 5,
  jpegQuality: 82,
  /** PNG sources: a lossless WebP is chosen when it is at most this many times the lossy one. */
  losslessBias: 1.5,
  /** Legacy-path PNGs above this size are palette-quantized as a second attempt. */
  pngPaletteAboveBytes: 1024 * 1024,
  pngPaletteQuality: 90,
};

/** Workers Static Assets limits and our own budgets (docs/cloudflare/web-skeleton.md). */
export const LIMITS = {
  /** Per file, Workers Static Assets. */
  maxFileBytes: 25 * 1024 * 1024,
  /** Per version, Workers Static Assets. */
  maxFiles: 20_000,
  /** The build fails above this many files: half the limit, so growth is noticed long before it bites. */
  budgetFiles: 10_000,
  /** One image above this needs a reason; the guard reports it, it does not fail. */
  imageSoftBytes: 1024 * 1024,
  /** PDFs above this size are recompressed (build-assets), because 25 MiB is a hard wall. */
  pdfShrinkAboveBytes: 20 * 1024 * 1024,
};

/** Folders of the root public/ whose rasters go through the pipeline (URL = folder + path). */
export const IMAGE_DIRS = ['images', 'blog/images'];
/** Folder of the root public/ whose files are copied, PDFs above the limit recompressed. */
export const FILES_DIR = 'files';
/** Where the derivatives live (fingerprinted, immutable). */
export const DERIVATIVE_DIR = '_img';
/** Everything build-assets writes under cf/web/public/ (gitignored, wiped of stale files each run). */
export const GENERATED_DIRS = [...IMAGE_DIRS, FILES_DIR, DERIVATIVE_DIR];

/** Raster formats the pipeline re-encodes. Anything else in IMAGE_DIRS is copied as is. */
export const RASTER_RE = /\.(jpe?g|png|webp)$/i;
/** Raster formats the pipeline does not read: a file like this in IMAGE_DIRS fails the build instead of shipping unprocessed. */
export const UNSUPPORTED_RASTER_RE = /\.(avif|gif|tiff?|bmp|heic|heif)$/i;

/**
 * The URL path to write in markup for a file of the root public/. The Workers
 * assets layer answers a request with a literal `@` in the path by redirecting
 * (307) to the `%40` form, an extra hop for every such image (five files of the
 * blog have one), so the markup carries the `%40` form. Any other character in
 * the current file names is served as is (checked by tests/assets.test.ts and
 * scripts/e2e.mjs, which request every image URL).
 */
export const assetUrl = (urlPath) => urlPath.replace(/@/g, '%40');

/** URL of a derivative. The hash covers the source bytes, the encoder settings and PIPELINE_VERSION. */
export const variantUrl = (hash, width) => `/${DERIVATIVE_DIR}/${hash}-${width}.webp`;

/** Rungs for a source `width` px wide: the ladder below it, then the (capped) width itself. Never upscales. */
export function rungsFor(width) {
  const top = Math.min(width, MAX_WIDTH);
  // A ladder rung within 10% of the top one would be a near-duplicate file.
  return [...WIDTHS.filter((w) => w < top * 0.9), top];
}

/** Height of a rung, keeping the aspect ratio. */
export const rungHeight = (width, sourceWidth, sourceHeight) => Math.max(1, Math.round((sourceHeight * width) / sourceWidth));

/**
 * @typedef {{ width: number; height: number }} Variant
 * @typedef {{ width: number; height: number; hash: string; variants: Variant[] }} ImageEntry
 *   width/height: the intrinsic size of the file served at the original URL
 *   (capped at MAX_WIDTH); variants: the WebP ladder, smallest first, the last
 *   one the same size.
 */

/** `srcset` value of an entry, optionally limited to widths of at least `min` px. */
export function srcsetFor(/** @type {ImageEntry} */ entry, min = 0) {
  const list = entry.variants.filter((v) => v.width >= min);
  return (list.length > 0 ? list : entry.variants.slice(-1)).map((v) => `${variantUrl(entry.hash, v.width)} ${v.width}w`).join(', ');
}
