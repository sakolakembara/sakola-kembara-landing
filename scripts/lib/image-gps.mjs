// Finds location (GPS) metadata in image files without decoding them. No dependencies.
//
// "GPS metadata" here means either of:
//   - an Exif/TIFF directory that carries the GPS IFD pointer (tag 0x8825), the same check the SAKEM-099
//     measurement used (iPhone photos have it in the APP1/Exif segment of a JPEG);
//   - XMP text that names the exif GPS properties (GPSLatitude, GPSLongitude).
//
// Where it looks:
//   - every format: the whole file, byte by byte, for an "Exif\0\0" prefix followed by a TIFF header (a JPEG
//     APP1 segment, a HEIC/AVIF Exif item, but also a second image of a multi-picture JPEG or any trailing
//     data), and for the XMP property names;
//   - PNG: the eXIf chunk and the text chunks (tEXt, zTXt, iTXt, inflated when compressed; ImageMagick's
//     "Raw profile type exif" too);
//   - WebP: the EXIF and XMP chunks of the RIFF container;
//   - TIFF: the file itself is the Exif directory.
//
// Not covered: HEIC/AVIF Exif items that carry no "Exif\0\0" prefix, XMP stored as UTF-16, and formats that
// are not listed (a GIF, an SVG). None of those exists in this repository; the check is a guard against a
// careless photo import, not a forensic tool. It never returns coordinates, only where a tag was found.

import { inflateSync } from 'node:zlib';

const GPS_IFD_POINTER = 0x8825;
const EXIF_PREFIX = Buffer.from('Exif\0\0', 'latin1');
const XMP_GPS_NEEDLES = [Buffer.from('GPSLatitude', 'latin1'), Buffer.from('GPSLongitude', 'latin1')];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @param {Buffer} buf @returns {'jpeg' | 'png' | 'webp' | 'tiff' | 'isobmff' | 'gif' | 'unknown'} */
export function sniffImageFormat(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 8 && isTiffHeader(buf, 0)) return 'tiff';
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'isobmff';
  if (buf.length >= 6 && buf.toString('latin1', 0, 3) === 'GIF') return 'gif';
  return 'unknown';
}

/** A TIFF header: byte order mark, 42, then an offset. */
function isTiffHeader(buf, at) {
  if (at + 8 > buf.length) return false;
  const bom = buf.toString('latin1', at, at + 2);
  if (bom === 'II') return buf.readUInt16LE(at + 2) === 42;
  if (bom === 'MM') return buf.readUInt16BE(at + 2) === 42;
  return false;
}

/**
 * Whether the TIFF structure starting at `start` has the GPS IFD pointer in IFD0 (or in IFD1, the thumbnail's).
 * Reads are bounds-checked: a damaged structure gives false, never a throw.
 */
function tiffHasGpsPointer(buf, start) {
  if (!isTiffHeader(buf, start)) return false;
  const le = buf.toString('latin1', start, start + 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  let ifd = u32(start + 4);
  for (let depth = 0; depth < 2 && ifd !== 0; depth++) {
    const at = start + ifd;
    if (at + 2 > buf.length) return false;
    const count = u16(at);
    if (at + 2 + count * 12 + 4 > buf.length) return false;
    for (let i = 0; i < count; i++) if (u16(at + 2 + i * 12) === GPS_IFD_POINTER) return true;
    ifd = u32(at + 2 + count * 12);
  }
  return false;
}

/** Offsets (of the TIFF header) of every "Exif\0\0" + TIFF header in the buffer. */
function* prefixedExifBlobs(buf) {
  let i = buf.indexOf(EXIF_PREFIX);
  while (i !== -1) {
    if (isTiffHeader(buf, i + 6)) yield i + 6;
    i = buf.indexOf(EXIF_PREFIX, i + 1);
  }
}

const hasXmpGps = (buf) => XMP_GPS_NEEDLES.some((needle) => buf.includes(needle));

/** The text of a PNG text chunk, inflated when it is compressed. Returns { keyword, text } or null. */
function pngText(type, data) {
  try {
    const nul = data.indexOf(0);
    if (nul < 0) return null;
    const keyword = data.toString('latin1', 0, nul);
    if (type === 'tEXt') return { keyword, text: data.subarray(nul + 1) };
    if (type === 'zTXt') return { keyword, text: inflateSync(data.subarray(nul + 2)) };
    // iTXt: keyword NUL, compression flag, compression method, language tag NUL, translated keyword NUL, text
    const compressed = data[nul + 1] === 1;
    const langEnd = data.indexOf(0, nul + 3);
    const translatedEnd = langEnd < 0 ? -1 : data.indexOf(0, langEnd + 1);
    if (translatedEnd < 0) return null;
    const body = data.subarray(translatedEnd + 1);
    return { keyword, text: compressed ? inflateSync(body) : body };
  } catch {
    return null;
  }
}

/** @param {Buffer} buf @returns {string[]} what was found in a PNG's chunks */
function pngHits(buf) {
  const hits = [];
  let o = 8;
  while (o + 12 <= buf.length) {
    const length = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, Math.min(o + 8 + length, buf.length));
    if (type === 'eXIf' && (tiffHasGpsPointer(data, 0) || [...prefixedExifBlobs(data)].some((t) => tiffHasGpsPointer(data, t)))) {
      hits.push(`GPS IFD pointer in the eXIf chunk at byte ${o}`);
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const entry = pngText(type, data);
      if (entry && hasXmpGps(entry.text)) hits.push(`GPS property in the ${type} chunk at byte ${o}`);
      else if (entry && /^Raw profile type (exif|APP1)$/i.test(entry.keyword)) {
        // ImageMagick's text form of an Exif block: a name line, a length line, then hex digits
        const hex = entry.text.toString('latin1').split('\n').slice(3).join('').replace(/[^0-9a-f]/gi, '');
        const raw = Buffer.from(hex.length % 2 ? hex.slice(0, -1) : hex, 'hex');
        if ([...prefixedExifBlobs(raw)].some((t) => tiffHasGpsPointer(raw, t)) || tiffHasGpsPointer(raw, 0)) {
          hits.push(`GPS IFD pointer in the raw Exif profile of the ${type} chunk at byte ${o}`);
        }
      }
    }
    if (type === 'IEND') break;
    o += 12 + length;
  }
  return hits;
}

/** @param {Buffer} buf @returns {string[]} what was found in the chunks of a WebP's RIFF container */
function webpHits(buf) {
  const hits = [];
  let o = 12;
  while (o + 8 <= buf.length) {
    const type = buf.toString('latin1', o, o + 4);
    const length = buf.readUInt32LE(o + 4);
    const data = buf.subarray(o + 8, Math.min(o + 8 + length, buf.length));
    if (type === 'EXIF' && (tiffHasGpsPointer(data, 0) || [...prefixedExifBlobs(data)].some((t) => tiffHasGpsPointer(data, t)))) {
      hits.push(`GPS IFD pointer in the EXIF chunk at byte ${o}`);
    }
    o += 8 + length + (length & 1);
  }
  return hits;
}

/**
 * @param {Buffer | Uint8Array} input the whole file
 * @returns {{ format: string, hits: string[] }} `hits` is empty when no GPS metadata was found; each entry says what and where, never the values
 */
export function findGpsMetadata(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const format = sniffImageFormat(buf);
  const hits = [];
  for (const t of prefixedExifBlobs(buf)) if (tiffHasGpsPointer(buf, t)) hits.push(`GPS IFD pointer in an Exif block at byte ${t - 6}`);
  if (hasXmpGps(buf)) hits.push('GPS property names in XMP');
  if (format === 'tiff' && tiffHasGpsPointer(buf, 0)) hits.push('GPS IFD pointer in the TIFF directory');
  if (format === 'png') hits.push(...pngHits(buf));
  if (format === 'webp') hits.push(...webpHits(buf));
  return { format, hits };
}
