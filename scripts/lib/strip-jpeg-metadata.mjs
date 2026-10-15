// Lossless JPEG metadata stripper. No dependencies, no decoding, no re-encoding (SAKEM-099).
//
// It walks the marker segments of the primary image and writes the file back with the segments that can hold
// location or identity data left out. Everything else is copied byte for byte: the quantization and Huffman
// tables, the frame header, the entropy-coded scans (so not a single pixel changes), the colour profile, and
// whatever follows the end-of-image marker.
//
//   removed   APP1   Exif (camera, owner, time, GPS IFD, embedded thumbnail), XMP, extended XMP, any other APP1
//             APP13  Photoshop image resources, IPTC (by-line, credit, caption, copyright, keywords)
//   replaced  an Exif block whose Orientation is 2 to 8 becomes a 34-byte Exif block that carries only the
//             Orientation tag, so the image keeps the rotation every viewer (and sharp's .rotate()) applies.
//             Orientation 1, no tag, or an invalid value: nothing is kept (that is what a missing tag means).
//   kept      APP0 JFIF, APP2 ICC profile and MPF, APP14 Adobe (they change how the pixels decode or display),
//             every non-APP marker, and the rest: unrecognised APPn segments and comments (COM) with text in
//             them are listed in `keptUnknown`, so a caller can look at them instead of silently trusting or
//             dropping them. (Comments stay because nothing structured lives there; five files of the blog
//             carry a one-byte NUL comment, which is not worth a changed file.)
//
// A multi-picture file (iPhone gain map, Samsung) keeps its second image and its MPF index. The MPF index
// stores the size of the first image and the offset of the others, so both are patched by the number of bytes
// removed. The second images are copied untouched, with whatever metadata they carry: `findGpsMetadata`
// (image-gps.mjs) looks inside them, and the repository test fails if one ever holds GPS.
//
// stripJpegMetadata is idempotent: stripping its own output returns the same bytes with `changed: false`.

export class JpegFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JpegFormatError';
  }
}

const SOS = 0xda;
const EOI = 0xd9;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP13 = 0xed;
const COM = 0xfe;

/** @param {Uint8Array} bytes */
export const isJpeg = (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

const ascii = (buf, from, to) => buf.toString('latin1', from, Math.min(to, buf.length));
/** The identifier at the start of an APPn payload ("AROT", "Photoshop 3.0"): up to the first NUL, 12 bytes at most. */
const appId = (body) => ascii(body, 0, 12).split('\0')[0].replace(/[^\x20-\x7e]/g, '?');
const startsWith = (buf, text) => ascii(buf, 0, text.length) === text;

/** Position of the next marker after entropy-coded data: RSTn, stuffed zeros and fill bytes belong to the data. */
function nextMarker(buf, from) {
  let i = from;
  for (;;) {
    i = buf.indexOf(0xff, i);
    if (i === -1 || i + 1 >= buf.length) return buf.length;
    const next = buf[i + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) i += 2;
    else if (next === 0xff) i += 1;
    else return i;
  }
}

/** Orientation tag (1 to 8) of an Exif block's TIFF structure, or null when there is none or it is not valid. */
function exifOrientation(tiff) {
  if (tiff.length < 8) return null;
  const bom = ascii(tiff, 0, 2);
  const le = bom === 'II';
  if (!le && bom !== 'MM') return null;
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3 && u32(entry + 4) === 1) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** A complete APP1 segment (marker and length included) whose only tag is Orientation. */
function minimalExifSegment(orientation) {
  const seg = Buffer.alloc(36);
  seg.writeUInt16BE(0xffe1, 0);
  seg.writeUInt16BE(34, 2); // length field: counts itself and the payload, not the marker
  seg.write('Exif\0\0', 4, 'latin1');
  seg.write('II', 10, 'latin1'); // TIFF header, little endian
  seg.writeUInt16LE(42, 12);
  seg.writeUInt32LE(8, 14); // IFD0 follows the header
  seg.writeUInt16LE(1, 18); // one entry
  seg.writeUInt16LE(0x0112, 20); // Orientation
  seg.writeUInt16LE(3, 22); // SHORT
  seg.writeUInt32LE(1, 24); // count
  seg.writeUInt16LE(orientation, 28);
  // bytes 30..31: the value field's padding; 32..35: no next IFD
  return seg;
}

/**
 * Patch the MPF index of a copy of the segment: the primary image shrank by `shrinkage` bytes in total and the
 * other images moved `shrinkageAfter` bytes closer to the MPF header. Returns false when the index is not
 * readable (the segment is then left as it was).
 * @param {Buffer} seg the whole APP2 segment, marker and length included
 */
function patchMpf(seg, shrinkage, shrinkageAfter) {
  const base = 8; // marker 2, length 2, "MPF\0" 4: the TIFF-style header starts here
  if (seg.length < base + 8) return false;
  const bom = ascii(seg, base, base + 2);
  const le = bom === 'II';
  if (!le && bom !== 'MM') return false;
  const u16 = (o) => (le ? seg.readUInt16LE(o) : seg.readUInt16BE(o));
  const u32 = (o) => (le ? seg.readUInt32LE(o) : seg.readUInt32BE(o));
  const set32 = (o, v) => (le ? seg.writeUInt32LE(v, o) : seg.writeUInt32BE(v, o));
  if (u16(base + 2) !== 42) return false;
  const ifd = base + u32(base + 4);
  if (ifd + 2 > seg.length) return false;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > seg.length) return false;
    if (u16(entry) !== 0xb002) continue; // MP Entry: 16 bytes per image
    const images = Math.floor(u32(entry + 4) / 16);
    const table = base + u32(entry + 8);
    if (table + images * 16 > seg.length) return false;
    for (let k = 0; k < images; k++) {
      const at = table + k * 16;
      const size = u32(at + 4);
      const offset = u32(at + 8);
      if (k === 0) {
        if (size >= -shrinkage) set32(at + 4, size + shrinkage);
      } else if (offset !== 0 && offset >= -shrinkageAfter) {
        set32(at + 8, offset + shrinkageAfter);
      }
    }
    return true;
  }
  return false;
}

/**
 * @typedef {{ marker: string, kind: string, bytes: number }} RemovedSegment
 * @typedef {{ marker: string, id: string, bytes: number }} KeptSegment
 * @param {Uint8Array} input the whole file
 * @returns {{ data: Buffer, changed: boolean, removed: RemovedSegment[], orientation: number | null, keptUnknown: KeptSegment[], warnings: string[] }}
 *   `data` is `input` itself (same buffer) when nothing had to change; `orientation` is the value kept in the minimal Exif block, if any
 * @throws {JpegFormatError} when the file is not a JPEG or its segments cannot be walked
 */
export function stripJpegMetadata(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!isJpeg(buf)) throw new JpegFormatError('not a JPEG: no SOI marker at the start');

  /** @type {{ start: number, end: number, replacement: Buffer | null }[]} */
  const edits = [];
  /** @type {RemovedSegment[]} */
  const removed = [];
  /** @type {KeptSegment[]} */
  const keptUnknown = [];
  const warnings = [];
  /** @type {{ start: number, end: number } | null} */
  let mpf = null;
  let orientation = null;

  let pos = 2; // after SOI
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) throw new JpegFormatError(`expected a marker at byte ${pos}`);
    let at = pos + 1;
    while (at < buf.length && buf[at] === 0xff) at++; // fill bytes may precede any marker; they stay where they are
    if (at >= buf.length) break;
    const marker = buf[at++];
    const start = at - 2; // the 0xFF directly before the marker byte
    if (marker === EOI) break; // end of the primary image: whatever follows is copied untouched
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos = at; // markers without a length
      continue;
    }
    if (at + 2 > buf.length) throw new JpegFormatError(`truncated segment header at byte ${start}`);
    const length = buf.readUInt16BE(at);
    const end = at + length;
    if (length < 2 || end > buf.length) throw new JpegFormatError(`segment at byte ${start} runs past the end of the file`);
    const body = buf.subarray(at + 2, end);
    const name = `APP${marker - 0xe0}`;

    if (marker === APP1) {
      const isExif = startsWith(body, 'Exif\0\0');
      const kind = isExif ? 'Exif' : startsWith(body, 'http://ns.adobe.com/xap/1.0/') ? 'XMP' : startsWith(body, 'http://ns.adobe.com/xmp/extension/') ? 'extended XMP' : 'other APP1';
      const value = isExif && orientation === null ? exifOrientation(body.subarray(6)) : null;
      if (value !== null && value >= 2) {
        // keep the rotation: this block becomes the minimal one (unless it already is)
        orientation = value;
        const replacement = minimalExifSegment(value);
        if (!replacement.equals(buf.subarray(start, end))) {
          edits.push({ start, end, replacement });
          removed.push({ marker: name, kind: 'Exif (reduced to Orientation)', bytes: end - start - replacement.length });
        }
      } else {
        edits.push({ start, end, replacement: null });
        removed.push({ marker: name, kind, bytes: end - start });
      }
    } else if (marker === APP13) {
      edits.push({ start, end, replacement: null });
      removed.push({ marker: name, kind: 'Photoshop/IPTC', bytes: end - start });
    } else if (marker === COM) {
      if (body.some((byte) => byte !== 0)) keptUnknown.push({ marker: 'COM', id: appId(body), bytes: end - start });
    } else if (marker === APP2 && startsWith(body, 'MPF\0')) {
      mpf = { start, end };
    } else if (marker >= 0xe0 && marker <= 0xef) {
      const known = (marker === 0xe0 && (startsWith(body, 'JFIF\0') || startsWith(body, 'JFXX\0'))) || (marker === APP2 && startsWith(body, 'ICC_PROFILE\0')) || (marker === 0xee && startsWith(body, 'Adobe'));
      if (!known) keptUnknown.push({ marker: name, id: appId(body), bytes: end - start });
    }

    pos = end;
    if (marker === SOS) {
      pos = nextMarker(buf, end);
      if (pos >= buf.length) break;
    }
  }

  if (edits.length === 0) return { data: buf, changed: false, removed, orientation, keptUnknown, warnings };

  // The MPF index (when there is one) follows the removal: the first image got smaller by everything removed,
  // the others moved closer by what was removed after the MPF header.
  if (mpf) {
    const mpfStart = mpf.start;
    const delta = (e) => (e.replacement?.length ?? 0) - (e.end - e.start);
    const shrinkage = edits.reduce((sum, e) => sum + delta(e), 0);
    const shrinkageAfter = edits.filter((e) => e.start >= mpfStart).reduce((sum, e) => sum + delta(e), 0);
    const patched = Buffer.from(buf.subarray(mpf.start, mpf.end));
    if (patchMpf(patched, shrinkage, shrinkageAfter)) {
      edits.push({ start: mpf.start, end: mpf.end, replacement: patched });
      edits.sort((a, b) => a.start - b.start);
    } else {
      warnings.push('the MPF index could not be read, so its sizes and offsets were left as they were');
    }
  }

  const parts = [];
  let cursor = 0;
  for (const edit of edits) {
    parts.push(buf.subarray(cursor, edit.start));
    if (edit.replacement) parts.push(edit.replacement);
    cursor = edit.end;
  }
  parts.push(buf.subarray(cursor));
  return { data: Buffer.concat(parts), changed: true, removed, orientation, keptUnknown, warnings };
}
