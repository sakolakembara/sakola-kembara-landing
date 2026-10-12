// What a file REALLY is, from its first bytes, and the size of an image from
// its header. The client's Content-Type and the file name are never consulted:
// both are chosen by whoever uploads (an .exe renamed .png says image/png).
//
// No libraries and bounded work, because Workers Free allows 10 ms of CPU per
// request: the caller reads at most SNIFF_WINDOW bytes of the file and every
// loop below is capped. Nothing here decodes pixels or decompresses anything,
// so a "decompression bomb" costs the same to inspect as a small file; the
// dimension limits below are what keep one from reaching a visitor's browser.
//
// Accepted: PNG, JPEG, WebP, GIF (images) and PDF. SVG is refused on purpose, see
// docs/cloudflare/uploads.md ("What is not accepted, and why"). Which kind takes which
// type is src/uploads/kinds.ts: GIF is for the blog's images only.

export type FileType = "png" | "jpeg" | "webp" | "gif" | "pdf";

export const FILE_TYPES: Record<FileType, { contentType: string; ext: string; image: boolean }> = {
  png: { contentType: "image/png", ext: "png", image: true },
  jpeg: { contentType: "image/jpeg", ext: "jpg", image: true },
  webp: { contentType: "image/webp", ext: "webp", image: true },
  gif: { contentType: "image/gif", ext: "gif", image: true },
  pdf: { contentType: "application/pdf", ext: "pdf", image: false },
};

/** How many bytes from the start of the file the caller must hand over (or the whole file when shorter). */
export const SNIFF_WINDOW = 1024 * 1024;

/** Longest side of an accepted image, in pixels. */
export const MAX_IMAGE_SIDE = 10_000;
/** Width times height of an accepted image. A browser needs about 4 bytes per pixel to show it (50 MP = 200 MB). */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** A JPEG header is a chain of segments; real files have a handful. This bounds the walk. */
const MAX_JPEG_SEGMENTS = 512;

export type SniffFailure =
  /** None of the five formats: wrong magic bytes. */
  | "unknown_type"
  /** The magic bytes are right but the header is broken or cut short. */
  | "corrupt"
  /** A JPEG whose size segment is not within SNIFF_WINDOW (more than 1 MiB of metadata first). */
  | "unreadable_size"
  /** A side or the pixel count above the limits. */
  | "dimensions_too_large";

export type SniffResult = { ok: true; type: FileType; width: number | null; height: number | null } | { ok: false; reason: SniffFailure };

/**
 * `head` is the first min(totalSize, SNIFF_WINDOW) bytes of the file,
 * `totalSize` the full length (used to tell "the header is cut short" from
 * "the size segment is further than the window").
 */
export function sniff(head: Uint8Array, totalSize: number): SniffResult {
  const type = detectType(head);
  if (!type) return { ok: false, reason: "unknown_type" };
  if (type === "pdf") return { ok: true, type, width: null, height: null };

  const size = type === "png" ? pngSize(head) : type === "webp" ? webpSize(head, totalSize) : type === "gif" ? gifSize(head) : jpegSize(head, head.length < totalSize);
  if (size === "corrupt") return { ok: false, reason: "corrupt" };
  if (size === "unreadable") return { ok: false, reason: "unreadable_size" };
  const { width, height } = size;
  if (width < 1 || height < 1) return { ok: false, reason: "corrupt" };
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) return { ok: false, reason: "dimensions_too_large" };
  return { ok: true, type, width, height };
}

/** Magic bytes only; the dimension readers below validate the rest of the header. */
export function detectType(b: Uint8Array): FileType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (b.length >= 6 && ascii(b, 0, 3) === "GIF" && (ascii(b, 3, 3) === "87a" || ascii(b, 3, 3) === "89a")) return "gif";
  // "%PDF-1.x" or "%PDF-2.x". A header further into the file (the spec tolerates 1 KiB of junk before it) is refused: no real exporter writes one.
  if (b.length >= 8 && ascii(b, 0, 5) === "%PDF-" && (b[5] === 0x31 || b[5] === 0x32) && b[6] === 0x2e && b[7]! >= 0x30 && b[7]! <= 0x39) return "pdf";
  return null;
}

type Size = { width: number; height: number };

function ascii(b: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = offset; i < offset + length && i < b.length; i++) out += String.fromCharCode(b[i]!);
  return out;
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32le = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** PNG: signature, then the IHDR chunk (length 13, type IHDR, width and height as big-endian u32). */
function pngSize(b: Uint8Array): Size | "corrupt" {
  if (b.length < 24) return "corrupt";
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== "IHDR") return "corrupt";
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/**
 * GIF: the signature "GIF87a" or "GIF89a", then the logical screen descriptor, whose first two fields are the
 * canvas width and height as little-endian u16 (13 bytes in all). The canvas is what a browser shows; the frames
 * of an animation fit inside it.
 */
function gifSize(b: Uint8Array): Size | "corrupt" {
  if (b.length < 13) return "corrupt";
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

/**
 * WebP: a RIFF container whose first chunk says which flavour it is.
 *   "VP8 "  lossy       14-bit width and height after the frame tag and start code
 *   "VP8L"  lossless    14 bits each, minus one, packed after a 0x2f signature
 *   "VP8X"  extended    24 bits each, minus one (also animated files)
 * The RIFF size must fit the file: a download cut short is refused.
 */
function webpSize(b: Uint8Array, totalSize: number): Size | "corrupt" {
  if (b.length < 30) return "corrupt";
  if (u32le(b, 4) + 8 > totalSize) return "corrupt";
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return "corrupt";
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return "corrupt";
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return "corrupt";
}

/** The start-of-frame markers carry the size: C0..CF except DHT (C4), JPG (C8) and DAC (CC). */
const isStartOfFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * JPEG: walk the marker segments (each one says its own length) until the
 * start-of-frame segment, which holds height and width as big-endian u16.
 * `truncatedWindow` is true when the file is longer than what was read: then
 * running out of bytes means "not found in the window", not "corrupt".
 */
function jpegSize(b: Uint8Array, truncatedWindow: boolean): Size | "corrupt" | "unreadable" {
  const ranOut = truncatedWindow ? "unreadable" : "corrupt";
  let i = 2; // after FF D8
  for (let segments = 0; segments < MAX_JPEG_SEGMENTS; segments++) {
    if (i >= b.length) return ranOut;
    if (b[i] !== 0xff) return "corrupt"; // lost sync: every segment starts with FF
    while (i < b.length && b[i] === 0xff) i++; // fill bytes
    if (i >= b.length) return ranOut;
    const marker = b[i++]!;
    // Markers without a length: TEM, RSTn, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // End of image, or the start of the scan, before any frame header: there is no size to read.
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) return "corrupt";
    if (i + 2 > b.length) return ranOut;
    const length = u16be(b, i);
    if (length < 2) return "corrupt";
    if (isStartOfFrame(marker)) {
      // length(2) precision(1) height(2) width(2) components(1)
      if (length < 8) return "corrupt";
      if (i + 7 > b.length) return ranOut;
      return { height: u16be(b, i + 3), width: u16be(b, i + 5) };
    }
    i += length;
  }
  return "corrupt";
}
