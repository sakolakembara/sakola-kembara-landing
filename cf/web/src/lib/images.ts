// Typed access to the image manifest written by scripts/build-assets.mjs.
//
// Every raster under the root public/images and public/blog/images has an entry,
// keyed by its URL path ("/images/hero-team.png"). The URL itself keeps working
// (an optimized file in the original format, at most 1600 px wide); the entry
// adds the WebP ladder for `srcset`. Use <Img> in components; this module is for
// code that needs the attributes as data.

import { assetUrl, srcsetFor, type ImageEntry } from '../../assets.config.mjs';
import manifest from '../generated/image-manifest.json';

export type { ImageEntry };

const images = manifest.images as unknown as Record<string, ImageEntry>;

/** The entry of an image given by its URL path, or null when the pipeline has no such file. */
export const findImage = (src: string): ImageEntry | null => images[src] ?? null;

/** Like findImage, but a path that is not in the manifest fails the build instead of shipping a broken image. */
export function getImage(src: string): ImageEntry {
  const entry = findImage(src);
  if (!entry) {
    throw new Error(
      `No image "${src}" in the asset manifest. Put the file under public/images or public/blog/images of the repo root (URL path = path below public/), then re-run \`pnpm assets\`.`,
    );
  }
  return entry;
}

export interface ImgAttrs {
  src: string;
  srcset: string;
  sizes: string;
  width: number;
  height: number;
}

/**
 * Attributes for a plain <img>: the original URL as `src`, the WebP ladder as
 * `srcset`, and the intrinsic size of the largest variant (so the browser can
 * reserve the space). `sizes` is the layout width of the image, e.g.
 * "(min-width: 1024px) 380px, 100vw". `minWidth` drops ladder steps below it
 * (for an image that must stay sharp, such as a QR code).
 */
export function imgAttrs(src: string, sizes: string, { minWidth = 0 }: { minWidth?: number } = {}): ImgAttrs {
  const entry = getImage(src);
  return { src: assetUrl(src), srcset: srcsetFor(entry, minWidth), sizes, width: entry.width, height: entry.height };
}
