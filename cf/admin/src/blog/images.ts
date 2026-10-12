import legacy from "./legacy-images.json";

// What the renderer knows about an inline image, by the path written in the markdown.
//
//   legacy blog images   /blog/images/...   the 234 files of the asset pipeline of cf/web (scripts/build-assets.mjs):
//                                           size, the WebP ladder for `srcset`, and the URL form with `@` as `%40`.
//                                           The table is `legacy-images.json`, generated from cf/web's image
//                                           manifest (`pnpm blog:legacy-images`); a test fails when it differs.
//   uploads              /uploads/...       the size recorded in `media` when the file was uploaded (the route
//                                           reads it from D1 and passes it in as `sizes`).
//
// Without a size an image is still shown; it only loses `width`/`height` (layout shift) and, for a legacy
// file, the responsive `srcset`. Re-saving an imported article therefore keeps its pictures exactly as the
// build rendered them.

export interface ImageInfo {
  width: number;
  height: number;
  /** The WebP ladder, for a file the asset pipeline made. */
  srcset?: string;
  /** The path to write in `src` when it is not the one in the markdown (`@` becomes `%40`: the Workers assets layer redirects a literal `@`). */
  src?: string;
}

/** `info` for the path an author wrote, or null when nothing is known about it. */
export type ImageLookup = (path: string) => ImageInfo | null;

// The pipeline's ladder (cf/web/assets.config.mjs): the widths below the image, then the image itself, capped.
const WIDTHS = [480, 768, 1200, 1600];
const MAX_WIDTH = 1600;

/** Rungs for a source `width` px wide: the ladder below it, then the (capped) width itself. Never upscales. */
export function rungsFor(width: number): number[] {
  const top = Math.min(width, MAX_WIDTH);
  // A rung within 10% of the top one would be a near-duplicate file.
  return [...WIDTHS.filter((w) => w < top * 0.9), top];
}

export const variantUrl = (hash: string, width: number) => `/_img/${hash}-${width}.webp`;

/** The `srcset` of an image of `width` px with this content hash. */
export function srcsetOf(hash: string, width: number): string {
  return rungsFor(width)
    .map((rung) => `${variantUrl(hash, rung)} ${rung}w`)
    .join(", ");
}

type LegacyEntry = readonly [width: number, height: number, hash: string];
const LEGACY = legacy.images as unknown as Record<string, LegacyEntry>;

/** The same rule the build plugin applies (`assetUrl` of cf/web/assets.config.mjs). */
export const assetUrl = (path: string) => path.replace(/@/g, "%40");

/** A path of the legacy blog (`/blog/images/...`), with a query or fragment ignored as the build plugin does. */
export const legacyImage: ImageLookup = (path) => {
  if (!path.startsWith("/")) return null;
  const entry = Object.hasOwn(LEGACY, path.split(/[?#]/)[0]!) ? LEGACY[path.split(/[?#]/)[0]!] : undefined;
  if (!entry) return null;
  const [width, height, hash] = entry;
  return { width, height, srcset: srcsetOf(hash, width), src: assetUrl(path) };
};

/** The entry of a legacy path as the table holds it (the tests compare it with the build's manifest). */
export function legacyEntry(path: string): LegacyEntry | null {
  return Object.hasOwn(LEGACY, path) ? LEGACY[path]! : null;
}

export function legacyPaths(): string[] {
  return Object.keys(LEGACY);
}

/** The sizes of uploads, by path: `{ "/uploads/blog-image/2026/<id>-x.png": { width, height } }`. */
export type UploadSizes = ReadonlyMap<string, { width: number; height: number }>;

/** Legacy files first, then the recorded size of an upload. */
export function imageLookup(sizes?: UploadSizes): ImageLookup {
  return (path) => {
    const old = legacyImage(path);
    if (old) return old;
    const recorded = sizes?.get(path);
    return recorded ? { width: recorded.width, height: recorded.height } : null;
  };
}
