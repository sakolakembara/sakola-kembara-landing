import { gallery } from './gallery.generated';
import type { GalleryPhoto } from './gallery-types';

/**
 * A program's photos in display order, from the manifest scripts/build-gallery.mjs
 * wrote at build time (the legacy lib/gallery.ts read the folder at request time).
 * [] when the program has no folder or the folder holds no images: the page then
 * leaves the whole "Galeri Foto" section out.
 */
export function getProgramGallery(programId: string): GalleryPhoto[] {
  return gallery[programId] ?? [];
}

/**
 * Alt text rule, same as the legacy page: "Dokumentasi <program title> <position>",
 * where position counts from 1 in display order (not the number in the file name).
 */
export function galleryAlt(programTitle: string, index: number): string {
  return `Dokumentasi ${programTitle} ${index + 1}`;
}

/** `srcset` value of a photo: "<url> <width>w, ...". */
export function gallerySrcset(photo: GalleryPhoto): string {
  return photo.variants.map((v) => `${v.src} ${v.width}w`).join(', ');
}
