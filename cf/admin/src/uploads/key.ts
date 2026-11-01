// The R2 object key and the public path of an upload.
//
//   key   uploads/<kind>/<yyyy>/<media id>-<slug>.<ext>
//   path  "/" + key             (what the API returns and content rows store)
//
// Nothing in a key is chosen by the client except the slug, and the slug is
// rebuilt from the file name with a whitelist ([a-z0-9-]), so a name such as
// "../../etc/passwd", "a\\b", a null byte, an emoji or a right-to-left
// override cannot put anything else into the key. The extension comes from the
// type found in the bytes, never from the file name. The media id is a fresh
// UUID per upload, so a key never collides and an object is never overwritten
// (the put is also conditional, see store.ts).

import { isUploadKind, uploadKinds, type UploadKind } from "./kinds";

/** Longest slug kept from a file name. */
export const MAX_SLUG_LENGTH = 60;

/** Lowercase ASCII words joined by "-". Accents are folded ("Foto Ibu Rahmá.JPG" gives "foto-ibu-rahma"). */
export function slugFromFilename(name: string): string {
  // Only the last path piece, and without its extension: browsers send the bare name, other clients may not.
  const base = name.split(/[\\/]/).pop() ?? "";
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const slug = stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "file";
}

export function buildKey(input: { kind: UploadKind; now: Date; id: string; slug: string; ext: string }): string {
  return `uploads/${input.kind}/${input.now.getUTCFullYear()}/${input.id}-${input.slug}.${input.ext}`;
}

const KINDS = uploadKinds.join("|");
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The only shape a key built by buildKey can have. Anything else is not ours: never looked up, never served. */
export const KEY_PATTERN = new RegExp(`^uploads/(${KINDS})/\\d{4}/(${UUID})-[a-z0-9][a-z0-9-]{0,${MAX_SLUG_LENGTH - 1}}\\.(png|jpg|webp|gif|pdf)$`);

export const UPLOAD_PATH_PREFIX = "/uploads/";

export function pathForKey(key: string): string {
  return `/${key}`;
}

/** The key of a public path, or null when the path is not an upload path of exactly the shape we produce. */
export function keyForPath(path: string): string | null {
  if (!path.startsWith(UPLOAD_PATH_PREFIX)) return null;
  const key = path.slice(1);
  return KEY_PATTERN.test(key) ? key : null;
}

/** The kind folder of a valid key. */
export function kindOfKey(key: string): UploadKind | null {
  const match = KEY_PATTERN.exec(key);
  const kind = match?.[1];
  return isUploadKind(kind) ? kind : null;
}

/** The name a person knows a file by, from its key: the slug and the extension, without the media id in front ("hero-kelas.webp"). */
export function nameOfKey(key: string): string {
  const last = key.split("/").pop() ?? key;
  return last.replace(new RegExp(`^${UUID}-`), "");
}

/** The media id inside a valid key. */
export function idOfKey(key: string): string | null {
  return KEY_PATTERN.exec(key)?.[2] ?? null;
}

/** The half-open key range of one kind, for a prefix scan on the unique key index (no LIKE: no wildcards, and it uses the index). */
export function keyRange(kind: UploadKind): { from: string; to: string } {
  // "0" is the character after "/" in ASCII, so [from, to) holds exactly the keys under "uploads/<kind>/".
  return { from: `uploads/${kind}/`, to: `uploads/${kind}0` };
}
