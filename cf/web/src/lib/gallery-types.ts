// Shape of one program photo, built from the image manifest (src/lib/gallery.ts).

export interface GalleryVariant {
  /** Public URL of a WebP derivative, content-hashed: /_img/<hash>-<width>.webp */
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
