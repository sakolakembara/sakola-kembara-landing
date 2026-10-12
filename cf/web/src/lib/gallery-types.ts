// Shape of the generated gallery manifest (src/lib/gallery.generated.ts, written
// by scripts/build-gallery.mjs). Types only, so the script and the page agree.

export interface GalleryVariant {
  /** Public URL of a WebP derivative, content-hashed: /images/program/galeri/<id>/<stem>.<hash>-<width>.webp */
  src: string;
  /** Pixel width and height of that file. */
  width: number;
  height: number;
}

export interface GalleryPhoto {
  /** File name in public/images/program/galeri/<program-id>/ at the repo root, e.g. "3.jpg". */
  name: string;
  /** Size of the largest variant (EXIF orientation applied): the <img> width and height attributes. */
  width: number;
  height: number;
  /** Ascending by width; the last one is the largest and the <img src> fallback. */
  variants: GalleryVariant[];
}

/** Program id -> its photos in display order. A folder without images is []; an id with no folder is absent. */
export type GalleryManifest = Record<string, GalleryPhoto[]>;
