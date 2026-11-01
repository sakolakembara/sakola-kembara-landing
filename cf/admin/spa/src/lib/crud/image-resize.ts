// A picture is made smaller in the browser before it is sent (SAKEM-117, docs/cloudflare/uploads.md): at most 1920 px on
// its longer side, written again as WebP. A phone's 4000 x 3000 JPEG of 6 MB becomes a file of a few hundred KB, which
// is what the site's pages load, and it is no longer over the 5 MB the Worker takes.
//
// It is a courtesy, never a gate. Whatever goes wrong (a browser that cannot decode the file or cannot write WebP, a
// file too big to decode safely) the picture is sent as it is, and the Worker, which reads the bytes of what it
// receives and has its own limits, has the last word. Drawing into a canvas also drops what the camera wrote into the
// file (the place it was taken, EXIF), so a picture that went through here carries none; one sent as it is (a GIF, a
// WebP that already fits, a file the browser could not read) carries what it came with. SAKEM-101 is the Worker's side.
//
// Pure of React. The browser's own pieces are behind `ImageCodec`, so the tests run the logic without a canvas.

/** The longer side of a picture, in pixels. */
export const MAX_SIDE = 1920;

/** WebP quality (0 to 1): photos stay clean at 0.85 and come out at about a tenth of a camera's JPEG. */
export const WEBP_QUALITY = 0.85;

/** The largest file the browser is asked to decode: the biggest limit of any kind. A bigger one is left to the size check, which refuses it. */
export const MAX_DECODE_BYTES = 25_000_000;

/** What the logic needs of a decoded picture; an `ImageBitmap` is one. */
export interface Bitmap {
  width: number;
  height: number;
  close(): void;
}

export interface ImageCodec {
  /** Decodes the file, turned upright by its orientation. Rejects when the browser cannot read it. */
  decode(file: Blob): Promise<Bitmap>;
  /** The bitmap drawn at width x height and written as WebP, or null when the browser cannot write WebP (some give a PNG). */
  encode(bitmap: Bitmap, width: number, height: number): Promise<Blob | null>;
}

/** The real thing, or null where the browser has no `createImageBitmap` (an old one, a test). */
function browserCodec(): ImageCodec | null {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  return {
    decode: (file) => createImageBitmap(file),
    async encode(bitmap, width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap as ImageBitmap, 0, 0, width, height);
      return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
    },
  };
}

let codec: ImageCodec | null | undefined;

/** Replaces the codec (the tests); `undefined` goes back to the browser's. */
export function setImageCodec(next: ImageCodec | null | undefined): void {
  codec = next;
}

const active = (): ImageCodec | null => (codec === undefined ? browserCodec() : codec);

/** A picture the browser can decode and WebP can hold: not a GIF (it would lose its motion) and not a PDF. */
const RESIZABLE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function isResizable(file: { name: string; type: string }): boolean {
  const claimed = file.type.trim().toLowerCase();
  // No guess from the browser: the extension is left to look at, as the type check does.
  return claimed !== "" ? RESIZABLE_TYPES.includes(claimed) : /\.(png|jpe?g|webp)$/i.test(file.name);
}

/** The size that fits `max` on its longer side, with the same proportions; never larger than the original. */
export function fit(width: number, height: number, max: number = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "foto-ibu.jpg" becomes "foto-ibu.webp". */
export function webpName(name: string): string {
  const stem = name.replace(/\.[^./\\]*$/, "");
  return `${stem === "" ? "gambar" : stem}.webp`;
}

/**
 * The file to send for `file`: a smaller WebP when that is a gain, otherwise `file` itself. It is a gain when the picture
 * had to shrink, or when the WebP is the smaller file (a WebP that already fits is never written again: that only
 * costs quality).
 */
export async function shrinkImage(file: File): Promise<File> {
  const browser = active();
  if (!browser || !isResizable(file) || file.size === 0 || file.size > MAX_DECODE_BYTES) return file;

  let bitmap: Bitmap;
  try {
    bitmap = await browser.decode(file);
  } catch {
    return file;
  }
  try {
    if (!(bitmap.width > 0 && bitmap.height > 0)) return file;
    const target = fit(bitmap.width, bitmap.height);
    const shrinks = target.width !== bitmap.width || target.height !== bitmap.height;
    const alreadyWebp = file.type.trim().toLowerCase() === "image/webp" || (file.type.trim() === "" && /\.webp$/i.test(file.name));
    if (alreadyWebp && !shrinks) return file;

    const blob = await browser.encode(bitmap, target.width, target.height).catch(() => null);
    if (!blob || blob.type !== "image/webp" || blob.size === 0) return file;
    if (!shrinks && blob.size >= file.size) return file;
    return new File([blob], webpName(file.name), { type: "image/webp", lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
