import { variantUrl } from '../../assets.config.mjs';
import type { GalleryPhoto } from './gallery-types';
import { getImage, listImages } from './images';

const GALLERY_ROOT = '/images/program/galeri';

/**
 * A program's photos in display order, from the image manifest the asset pipeline
 * wrote at build time (the legacy lib/gallery.ts read the folder at request time).
 * Adding a photo is still "drop `4.jpg` in public/images/program/galeri/<id>/ at
 * the repo root and rebuild". [] when the program has no folder or the folder holds
 * no images: the page then leaves the whole "Galeri Foto" section out.
 */
export function getProgramGallery(programId: string): GalleryPhoto[] {
  // Same guard as the legacy code: an id that is not a plain folder name matches nothing.
  if (!/^[a-z0-9-]+$/i.test(programId)) return [];
  return listImages(`${GALLERY_ROOT}/${programId}`).map(({ src, name }) => {
    const image = getImage(src);
    return {
      name,
      width: image.width,
      height: image.height,
      variants: image.variants.map((v) => ({ src: variantUrl(image.hash, v.width), width: v.width, height: v.height })),
    };
  });
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
