// What may NOT reach the public bucket: the metadata a camera or an editor wrote into an image. SAKEM-101.
//
// A phone photo carries the position it was taken at (an Exif GPS block), the device, the time and often the
// owner's name, and everything in the bucket is public to anyone who knows the address. So an image is rewritten
// BEFORE it is stored, without decoding or re-encoding a pixel (the old doc said stripping "needs a re-encode":
// it does not, SAKEM-099 proved it on every JPEG of the repository). Only whole segments or chunks that are
// metadata are left out; every other byte is copied as it was, so the picture, its size and its colours are
// exactly the same.
//
//   JPEG  scripts/lib/strip-jpeg-metadata.mjs, THE tool of SAKEM-099, imported (not copied): one source of truth
//         for what leaves a JPEG. APP1 (Exif, XMP) and APP13 (IPTC) go; an Exif block with an Orientation of 2 to
//         8 is replaced by a 34-byte block that keeps only that tag, so a rotated photo stays upright; the ICC
//         profile, JFIF and everything else stay. It uses Node's `Buffer`, which the Worker has (`nodejs_compat`).
//   PNG   kept: the critical chunks and the ancillary ones that change how pixels are shown (colour space, gamma,
//         ICC profile, palette transparency, background, resolution, animation). Everything else goes: eXIf, the
//         text chunks (tEXt, zTXt, iTXt: where XMP and "raw profile" Exif live), tIME and unknown vendor chunks.
//   WebP  kept: the image chunks (VP8, VP8L, VP8X, ALPH, ANIM, ANMF) and the ICC profile. EXIF, XMP and unknown
//         chunks go; the VP8X flags that announced them are cleared and the RIFF size is rewritten.
//   GIF, PDF  untouched (a GIF has no Exif; a PDF's own metadata is out of scope of this ticket).
//
// A file with nothing to strip is stored as the Blob it came in, byte for byte. A file that cannot be walked to
// its end is refused (UnreadableUploadError, answered like any other broken image, 422 invalid_file): when the
// structure cannot be read there is no way to know it carries no location.
//
// Cost and memory, because Workers Free allows 10 ms of CPU and 128 MB: the file is read once (a native copy, for
// the walk) and the stripped file is never copied. A strip is a list of PARTS, small new byte arrays (a rewritten
// JPEG header, a patched RIFF size) and ranges of the received file, and the body stored is a Blob made of those:
// the picture data is not read through JavaScript a second time. The PNG and WebP walks jump from chunk to chunk by
// their length fields (no scan of the data at all); the JPEG path avoids walking the picture data, see stripJpeg().
// docs/cloudflare/uploads.md ("Metadata stripping") has the measurements and says what was not measured (the real
// CPU of Cloudflare).

import { JpegFormatError, stripJpegMetadata } from "../../../../scripts/lib/strip-jpeg-metadata.mjs";
import type { FileType } from "./sniff";

/** The picture cannot be walked to its end, so nothing can be said about what it carries. */
export class UnreadableUploadError extends Error {
  constructor() {
    super("image cannot be read to its end");
    this.name = "UnreadableUploadError";
  }
}

export interface UploadBody {
  /** What goes to R2: the Blob that came in when nothing had to go, a metadata-free Blob otherwise. */
  body: Blob;
  /** The size of `body`: what `media.size`, the audit row and the answer to the editor say. */
  size: number;
  /** False when `body` is the file as it was received. */
  changed: boolean;
}

/**
 * The bytes to store for a file whose type was found by the sniffer. Throws UnreadableUploadError for an image
 * that cannot be walked. PDFs and GIFs are returned as they are, without being read.
 */
export async function prepareUploadBody(file: File, type: FileType): Promise<UploadBody> {
  if (type !== "jpeg" && type !== "png" && type !== "webp") return { body: file, size: file.size, changed: false };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = type === "jpeg" ? stripJpeg(bytes) : type === "png" ? stripPng(bytes) : stripWebp(bytes);
  if (result.kind === "unreadable") throw new UnreadableUploadError();
  if (result.kind === "unchanged") return { body: file, size: file.size, changed: false };

  let size = 0;
  const pieces = result.parts.map((part) => {
    if (part instanceof Uint8Array) {
      size += part.byteLength;
      return part;
    }
    size += part.to - part.from;
    return file.slice(part.from, part.to);
  });
  return { body: new Blob(pieces), size, changed: true };
}

/** What the stripped file is made of, in order: new bytes, or a range `[from, to)` of the received file. */
export type Part = Uint8Array | { from: number; to: number };

export type Stripped = { kind: "unchanged" } | { kind: "stripped"; parts: Part[] } | { kind: "unreadable" };
const UNCHANGED: Stripped = { kind: "unchanged" };
const UNREADABLE: Stripped = { kind: "unreadable" };

// ---------------------------------------------------------------- JPEG

/** The shared stripper over `bytes` as a whole, with its one failure (a segment chain it cannot walk) turned into "unreadable". */
function stripWholeJpeg(bytes: Uint8Array): Stripped {
  try {
    const result = stripJpegMetadata(bytes);
    return result.changed ? { kind: "stripped", parts: [result.data] } : UNCHANGED;
  } catch (error) {
    if (error instanceof JpegFormatError) return UNREADABLE;
    throw error;
  }
}

/**
 * Strips a JPEG. The shared stripper walks the whole file, and its walk through the scan (the entropy-coded
 * picture data, nearly all of the file) hops from one 0xFF byte to the next with `Buffer.indexOf(number)`, which
 * in workerd costs about as much as the whole 10 ms of CPU a Free request has, for a 5 MB photo (measured, see
 * docs/cloudflare/uploads.md). Metadata lives in the header, so the common case is done on the header alone:
 *
 *   1. find the end of the first scan's header (a walk of segment lengths: no scan of any data);
 *   2. check that nothing the stripper would touch (APP1, APP2 for the MPF index, APP13) follows it before the
 *      end of the image. Entropy-coded data cannot contain 0xFF followed by those bytes (a 0xFF in the data is
 *      always stuffed with 0x00 or is a restart marker), so native searches for a two-byte pattern settle it;
 *   3. run the shared stripper on the header alone and put the received file behind it, uncopied.
 *
 * The result is byte for byte what the shared stripper makes of the whole file (a test compares them on every
 * shape of file it knows). Anything unusual (no scan found, a segment after the scan that the stripper would act
 * on) takes the whole-file walk, which is slow but exact.
 */
export function stripJpeg(bytes: Uint8Array): Stripped {
  const scanAt = endOfFirstScanHeader(bytes);
  if (scanAt === null || hasMetadataAfterFirstScan(bytes, scanAt)) return stripWholeJpeg(bytes);
  const header = stripWholeJpeg(bytes.subarray(0, scanAt));
  if (header.kind !== "stripped") return header;
  return { kind: "stripped", parts: [...header.parts, { from: scanAt, to: bytes.byteLength }] };
}

/** A header has a handful of segments; the sniffer bounds the walk before the frame the same way. A longer chain takes the whole-file walk. */
const MAX_HEADER_SEGMENTS = 512;

/**
 * The offset right after the first SOS segment (its marker, length and component list), or null when it cannot be
 * found. Walks by the segments' own lengths with the same rules as the stripper (fill bytes before a marker, a few
 * markers without a length), so the stripper reaches the same place.
 */
function endOfFirstScanHeader(b: Uint8Array): number | null {
  let i = 2; // after SOI
  for (let segments = 0; segments < MAX_HEADER_SEGMENTS; segments++) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff) i++;
    const marker = b[i++];
    if (marker === undefined) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // no length: TEM, RSTn, SOI
    if (marker === 0xd9) return null; // the image ended before any scan
    if (i + 2 > b.length) return null;
    const length = (b[i]! << 8) | b[i + 1]!;
    if (length < 2 || i + length > b.length) return null;
    if (marker === 0xda) return i + length; // SOS: what follows is entropy-coded data
    i += length;
  }
  return null;
}

/** The segments the stripper acts on, as the second byte of the marker that starts them: APP1 (Exif, XMP), APP2 (the MPF index it patches), APP13 (IPTC). */
const ACTED_ON_MARKERS = [0xe1, 0xe2, 0xed];

/** True when one of those segments starts between the end of the first scan's header and the end of the image. */
function hasMetadataAfterFirstScan(bytes: Uint8Array, from: number): boolean {
  const rest = Buffer.from(bytes.buffer, bytes.byteOffset + from, bytes.byteLength - from);
  const hits = ACTED_ON_MARKERS.map((marker) => rest.indexOf(Buffer.from([0xff, marker]))).filter((at) => at !== -1);
  if (hits.length === 0) return false;
  // Something follows. A second image of a multi-picture file or a trailer starts with such a segment too, and is
  // copied as it is: only a hit before the end of this picture counts. The first 0xFFD9 is that end (it cannot occur in the data).
  const end = rest.indexOf(Buffer.from([0xff, 0xd9]));
  return end === -1 || Math.min(...hits) < end;
}

// ---------------------------------------------------------------- PNG

/**
 * Ancillary chunks (first letter lowercase) kept because they change how the pixels are shown. Critical chunks
 * (IHDR, PLTE, IDAT, IEND, first letter uppercase) are always kept. Every other ancillary chunk is dropped: by
 * definition a decoder may ignore it, so the picture is the same, and this is where text, XMP, Exif, the time and
 * vendor data live.
 */
const PNG_KEPT_ANCILLARY = new Set(["gAMA", "cHRM", "sRGB", "iCCP", "cICP", "mDCV", "cLLI", "sBIT", "bKGD", "hIST", "pHYs", "sPLT", "tRNS", "acTL", "fcTL", "fdAT"]);

/** Realistic files have a few hundred chunks (an IDAT every 8 to 64 kB); this bounds the walk of a hostile one. */
const MAX_CHUNKS = 20_000;

/** The signature (8 bytes) was checked by the sniffer; then chunks of length(4) type(4) data(length) crc(4) up to IEND. */
export function stripPng(b: Uint8Array): Stripped {
  const keep: Range[] = [];
  let copyFrom = 0;
  let pos = 8;
  let sawEnd = false;
  for (let chunks = 0; chunks < MAX_CHUNKS && pos + 12 <= b.length; chunks++) {
    const end = pos + 12 + u32be(b, pos);
    if (end > b.length) return UNREADABLE;
    const type = fourcc(b, pos + 4);
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
    const critical = (b[pos + 4]! & 0x20) === 0;
    if (!critical && !PNG_KEPT_ANCILLARY.has(type)) {
      keep.push({ from: copyFrom, to: pos });
      copyFrom = end;
    }
    pos = end;
  }
  if (!sawEnd) return UNREADABLE;
  if (keep.length === 0) return UNCHANGED;
  keep.push({ from: copyFrom, to: b.length });
  return { kind: "stripped", parts: nonEmpty(keep) };
}

// ---------------------------------------------------------------- WebP

/** Image data and the colour profile. EXIF, XMP and anything unknown are not here, so they go. */
const WEBP_KEPT = new Set(["VP8 ", "VP8L", "ALPH", "ANIM", "ANMF", "ICCP"]);

/** VP8X flags: bit 3 says an EXIF chunk follows, bit 2 an XMP chunk. */
const WEBP_VP8X_METADATA_FLAGS = 0x08 | 0x04;

/** RIFF, size, "WEBP", then chunks of fourcc(4) size(4, little endian) payload (padded to an even length). */
export function stripWebp(b: Uint8Array): Stripped {
  if (b.length < 12) return UNREADABLE;
  const riffEnd = u32le(b, 4) + 8;
  if (riffEnd < 12 || riffEnd > b.length) return UNREADABLE;

  const keep: Range[] = [];
  let copyFrom = 0;
  let removed = 0;
  let flagsAt = -1;
  let pos = 12;
  for (let chunks = 0; pos + 8 <= riffEnd; chunks++) {
    if (chunks >= MAX_CHUNKS) return UNREADABLE;
    const size = u32le(b, pos + 4);
    const payloadEnd = pos + 8 + size;
    if (payloadEnd > riffEnd) return UNREADABLE;
    // The pad byte of an odd-sized last chunk may be missing in a sloppy file; never read past the RIFF payload.
    const end = Math.min(payloadEnd + (size & 1), riffEnd);
    const type = fourcc(b, pos);
    if (type === "VP8X") {
      if (size < 10) return UNREADABLE;
      flagsAt = pos + 8;
    } else if (!WEBP_KEPT.has(type)) {
      keep.push({ from: copyFrom, to: pos });
      copyFrom = end;
      removed += end - pos;
    }
    pos = end;
  }
  if (removed === 0) return UNCHANGED;
  keep.push({ from: copyFrom, to: b.length });

  // The new RIFF size and, when a VP8X header announced metadata, its flags without the EXIF and XMP bits.
  const riffSize = riffEnd - removed - 8;
  const replace = new Map<number, number>([
    [4, riffSize & 0xff],
    [5, (riffSize >>> 8) & 0xff],
    [6, (riffSize >>> 16) & 0xff],
    [7, (riffSize >>> 24) & 0xff],
  ]);
  if (flagsAt >= 0) replace.set(flagsAt, b[flagsAt]! & ~WEBP_VP8X_METADATA_FLAGS);
  return { kind: "stripped", parts: withReplacedBytes(keep, replace) };
}

// ---------------------------------------------------------------- bytes

interface Range {
  from: number;
  to: number;
}

const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u32le = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
const fourcc = (b: Uint8Array, i: number) => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);

const nonEmpty = (ranges: Range[]): Range[] => ranges.filter((range) => range.to > range.from);

/** The ranges as parts, with single bytes of the source (position to new value) swapped for new ones: each is a one-byte part. */
function withReplacedBytes(ranges: Range[], replace: Map<number, number>): Part[] {
  const parts: Part[] = [];
  for (const { from, to } of ranges) {
    let cursor = from;
    for (const at of [...replace.keys()].filter((at) => at >= from && at < to).sort((a, z) => a - z)) {
      if (at > cursor) parts.push({ from: cursor, to: at });
      parts.push(Uint8Array.of(replace.get(at)!));
      cursor = at + 1;
    }
    if (to > cursor) parts.push({ from: cursor, to });
  }
  return parts;
}
