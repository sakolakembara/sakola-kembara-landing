import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Program photo galleries are read from disk instead of being listed in
 * `lib/data.ts`, so adding a photo means dropping a file in a folder — no code
 * change, no rebuild of any list.
 *
 *   public/images/program/galeri/<program-id>/1.jpg, 2.jpg, 3.jpg, ...
 *
 * The cost of going dynamic is that these can't be static imports, so they
 * don't get Next's content-hashed URL. Replacing `3.jpg` in place would
 * otherwise keep the same URL and be served stale from the image optimizer
 * for up to `images.minimumCacheTTL` (4h in Next 16). The `?v=` suffix below
 * restores that guarantee: it is derived from the file's size and mtime, so
 * any edit changes the URL and every cache is bypassed. Same effect as a
 * content hash, without reading each file's bytes on every request.
 */
const GALLERY_ROOT = "images/program/galeri";

/** Extensions Next's image optimizer handles well. */
const IMAGE_RE = /\.(jpe?g|png|webp|avif)$/i;

export interface GalleryPhoto {
  /** Public URL including the cache-busting version suffix. */
  src: string;
  /** Filename as it sits on disk, used for the alt text and React key. */
  name: string;
}

/**
 * List one program's gallery, ordered numerically (2.jpg before 10.jpg).
 * Non-numeric filenames still work and sort alphabetically after the numbered
 * ones. Returns [] when the folder does not exist yet, which is the normal
 * state for a program whose photos haven't been supplied — the page renders
 * its empty state instead.
 */
export async function getProgramGallery(
  programId: string,
): Promise<GalleryPhoto[]> {
  // Guard against a crafted id escaping the gallery root via ".." or a slash.
  if (!/^[a-z0-9-]+$/i.test(programId)) return [];

  const dir = join(process.cwd(), "public", GALLERY_ROOT, programId);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const photos = await Promise.all(
    entries
      .filter((name) => IMAGE_RE.test(name))
      .map(async (name) => {
        const { size, mtimeMs } = await stat(join(dir, name));
        const version = `${size.toString(36)}${Math.round(mtimeMs).toString(36)}`;
        return {
          name,
          src: `/${GALLERY_ROOT}/${programId}/${name}?v=${version}`,
          // Number("07") === 7, and NaN for non-numeric names so they sort last.
          order: Number(name.replace(IMAGE_RE, "")),
        };
      }),
  );

  return photos
    .sort((a, b) => {
      const aNum = Number.isFinite(a.order);
      const bNum = Number.isFinite(b.order);
      if (aNum && bNum) return a.order - b.order;
      if (aNum !== bNum) return aNum ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map(({ src, name }) => ({ src, name }));
}
