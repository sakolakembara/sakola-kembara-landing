import { CLEAN_JPEG_BASE64 } from "./uploads-real-jpeg";

// Fixtures for the metadata tests (SAKEM-101): JPEG, PNG and WebP files built byte by byte, with INVENTED location
// and device metadata put in (1 degree north, 2 degrees east, a camera called "TestPhone"; no real photo is
// involved). The JPEG is a real one from an ordinary encoder (test/uploads-real-jpeg.ts), so the tables, the
// restart markers and the scan data are what an encoder writes; the PNG and WebP are small but well formed.
//
// Every builder has its mirror: `photo({ ... })` is the dirty file and `photo({ icc, orientation })` is what the
// upload must store, built by writing the clean file again instead of by running any stripper.

const text = (value: string) => new TextEncoder().encode(value);

export function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const be16 = (n: number) => Uint8Array.of((n >> 8) & 0xff, n & 0xff);
const be32 = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const le16 = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
const le32 = (n: number) => Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);

/** Where `needle` first occurs in `haystack` (from `from`), or -1. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export const containsText = (haystack: Uint8Array, value: string) => indexOfBytes(haystack, text(value)) !== -1;

// ---------------------------------------------------------------- the invented metadata

export const MAKE = "TestPhone";
export const IPTC_NAME = "Pemotret Contoh";
export const GPS_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/"><exif:GPSLatitude>1,0.0000N</exif:GPSLatitude><exif:GPSLongitude>2,0.0000E</exif:GPSLongitude><xmp:CreatorTool>TestPhone Camera</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta>`;
export const ICC_MARK = "ICC-PROFILE-OF-THE-TEST";

interface Entry {
  tag: number;
  /** 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL */
  type: 2 | 3 | 4 | 5;
  count: number;
  value: Uint8Array;
}

/** A little-endian TIFF structure: IFD0 (Make, Orientation, a GPS IFD behind the 0x8825 pointer) and its data area. */
export function tiff(options: { orientation?: number; make?: string; gps?: boolean }): Uint8Array {
  const ifd0: Entry[] = [];
  if (options.make) ifd0.push({ tag: 0x010f, type: 2, count: options.make.length + 1, value: text(`${options.make}\0`) });
  if (options.orientation !== undefined) ifd0.push({ tag: 0x0112, type: 3, count: 1, value: le16(options.orientation) });
  const rational = (n: number) => cat(le32(n), le32(1));
  const gps: Entry[] = options.gps
    ? [
        { tag: 0x0001, type: 2, count: 2, value: text("N\0") },
        { tag: 0x0002, type: 5, count: 3, value: cat(rational(1), rational(0), rational(0)) },
        { tag: 0x0003, type: 2, count: 2, value: text("E\0") },
        { tag: 0x0004, type: 5, count: 3, value: cat(rational(2), rational(0), rational(0)) },
      ]
    : [];
  // The GPS pointer is an IFD0 entry whose value is the offset of the GPS IFD, so its size must be known first.
  const ifd0Count = ifd0.length + (options.gps ? 1 : 0);
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const gpsOffset = 8 + ifd0Size;
  const gpsSize = gps.length ? 2 + gps.length * 12 + 4 : 0;
  let dataAt = gpsOffset + gpsSize;
  const data: Uint8Array[] = [];

  const encode = (entries: Entry[]): Uint8Array => {
    const rows = entries.map((entry) => {
      let value: Uint8Array;
      if (entry.value.length <= 4) value = cat(entry.value, new Uint8Array(4 - entry.value.length));
      else {
        value = le32(dataAt);
        data.push(entry.value);
        dataAt += entry.value.length;
      }
      return cat(le16(entry.tag), le16(entry.type), le32(entry.count), value);
    });
    return cat(le16(entries.length), ...rows, le32(0));
  };

  const withPointer = options.gps ? [...ifd0, { tag: 0x8825, type: 4 as const, count: 1, value: le32(gpsOffset) }].sort((a, b) => a.tag - b.tag) : ifd0;
  const ifd0Bytes = encode(withPointer);
  const gpsBytes = gps.length ? encode(gps) : new Uint8Array(0);
  return cat(text("II"), le16(42), le32(8), ifd0Bytes, gpsBytes, ...data);
}

// ---------------------------------------------------------------- JPEG

const segment = (marker: number, payload: Uint8Array) => cat(Uint8Array.of(0xff, marker), be16(payload.length + 2), payload);

/** APP1 Exif. */
export const exifSegment = (options: Parameters<typeof tiff>[0]) => segment(0xe1, cat(text("Exif\0\0"), tiff(options)));
/** APP1 XMP. */
export const xmpSegment = (xml: string) => segment(0xe1, cat(text("http://ns.adobe.com/xap/1.0/\0"), text(xml)));
/** APP13 Photoshop image resources with one IPTC record naming the photographer. */
export const iptcSegment = () => {
  const record = cat(Uint8Array.of(0x1c, 0x02, 0x50), be16(IPTC_NAME.length), text(IPTC_NAME));
  return segment(0xed, cat(text("Photoshop 3.0\0"), text("8BIM"), be16(0x0404), Uint8Array.of(0, 0), be32(record.length), record));
};
/** APP2 ICC_PROFILE, chunk 1 of 1: a profile only in name (nothing here decodes it). */
export const iccSegment = () => segment(0xe2, cat(text("ICC_PROFILE\0"), Uint8Array.of(1, 1), new Uint8Array(36), text("acsp"), text(ICC_MARK), new Uint8Array(120)));
/** What the stripper writes for an Orientation of 2 to 8: an Exif block that holds only that tag (36 bytes with the marker). */
export const minimalExifSegment = (orientation: number) => segment(0xe1, cat(text("Exif\0\0"), text("II"), le16(42), le32(8), le16(1), le16(0x0112), le16(3), le32(1), le16(orientation), new Uint8Array(2), le32(0)));

export const cleanJpeg = (): Uint8Array => Uint8Array.from(atob(CLEAN_JPEG_BASE64), (char) => char.charCodeAt(0));

/** The length of the segment that starts at `at` (marker included). */
const segmentEnd = (jpeg: Uint8Array, at: number) => at + 2 + ((jpeg[at + 2]! << 8) | jpeg[at + 3]!);

/** Where the first SOS segment starts. The real JPEG has the tables, the frame header and a restart interval before it. */
export function scanStart(jpeg: Uint8Array): number {
  let at = 2;
  while (jpeg[at + 1] !== 0xda) at = segmentEnd(jpeg, at);
  return at;
}

export interface PhotoOptions {
  /** Metadata a phone writes. */
  exif?: Parameters<typeof tiff>[0];
  xmp?: boolean;
  iptc?: boolean;
  /** A colour profile: kept by the stripper. */
  icc?: boolean;
  /** What a stripped file holds instead of the whole Exif block (Orientation 2 to 8). */
  minimalOrientation?: number;
}

/** The real JPEG with its JFIF header first, then the requested segments, then everything else as it was. */
export function photo(options: PhotoOptions = {}): Uint8Array {
  const clean = cleanJpeg();
  const afterJfif = segmentEnd(clean, 2); // SOI, then APP0 JFIF
  const segments: Uint8Array[] = [];
  if (options.exif) segments.push(exifSegment(options.exif));
  if (options.minimalOrientation !== undefined) segments.push(minimalExifSegment(options.minimalOrientation));
  if (options.xmp) segments.push(xmpSegment(GPS_XMP));
  if (options.iptc) segments.push(iptcSegment());
  if (options.icc) segments.push(iccSegment());
  return cat(clean.subarray(0, afterJfif), ...segments, clean.subarray(afterJfif));
}

/** A segment right before the EOI of the primary image (after the scan): non-conformant, but a decoder shows the picture. */
export function withSegmentBeforeEoi(jpeg: Uint8Array, extra: Uint8Array): Uint8Array {
  const eoi = jpeg.length - 2;
  return cat(jpeg.subarray(0, eoi), extra, jpeg.subarray(eoi));
}

/**
 * A multi-scan (progressive-like) file: the frame header says SOF2, and the picture is two scans with a DHT between
 * them. Nothing decodes it; it has the SHAPE the stripper and the fast path must walk. `between` goes right before
 * the second scan.
 */
export function multiScan(extraHeader: Uint8Array[] = [], between: Uint8Array[] = []): Uint8Array {
  const clean = photo();
  const at = scanStart(clean);
  const header = Uint8Array.from(clean.subarray(0, at));
  // The SOF0 segment becomes SOF2 (progressive): find FF C0 on a segment boundary.
  let seg = 2;
  while (header[seg + 1] !== 0xc0) seg = segmentEnd(header, seg);
  header[seg + 1] = 0xc2;
  const afterJfif = segmentEnd(header, 2);
  const sos = (parts: number) => segment(0xda, Uint8Array.of(3, 1, 0, 2, 0x11, 3, 0x11, 0, parts, 0));
  const data = (seed: number) => Uint8Array.from({ length: 300 }, (_, i) => (i % 40 === 7 ? 0xff : i % 40 === 8 ? 0x00 : (i * 31 + seed) % 0xf0));
  const dht = segment(0xc4, cat(Uint8Array.of(0x10), Uint8Array.of(0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), Uint8Array.of(0x05)));
  return cat(header.subarray(0, afterJfif), ...extraHeader, header.subarray(afterJfif), sos(0), data(1), dht, ...between, sos(1), data(2), Uint8Array.of(0xff, 0xd9));
}

/**
 * A multi-picture file the way an Ultra HDR phone photo has it: the primary image with an MPF index in its header,
 * then a second JPEG (the gain map) that has its own Exif behind its SOI, indexed by offset. `primary` must hold no MPF yet.
 */
export function multiPicture(primary: Uint8Array, secondary: Uint8Array, after: Uint8Array[] = []): Uint8Array {
  // After the last APPn segment (JFIF, Exif, XMP, the colour profile ...), before the first table: where cameras put it.
  // `after` goes right behind the index, still inside the primary image (counted in its size and in the offsets).
  let insertAt = 2;
  while (primary[insertAt + 1]! >= 0xe0 && primary[insertAt + 1]! <= 0xef) insertAt = segmentEnd(primary, insertAt);
  const mpf = (primarySize: number, secondarySize: number, secondaryOffset: number) =>
    segment(
      0xe2,
      cat(
        text("MPF\0"),
        text("II"),
        le16(42),
        le32(8),
        // IFD: count 3 (version, number of images, MP entries), then the next-IFD offset, then the 2 x 16 byte table
        le16(3),
        cat(le16(0xb000), le16(7), le32(4), text("0100")),
        cat(le16(0xb001), le16(4), le32(1), le32(2)),
        cat(le16(0xb002), le16(7), le32(32), le32(8 + 2 + 3 * 12 + 4)),
        le32(0),
        cat(le32(0x20030000), le32(primarySize), le32(0), le16(0), le16(0)),
        cat(le32(0), le32(secondarySize), le32(secondaryOffset), le16(0), le16(0)),
      ),
    );
  const placeholder = mpf(0, 0, 0);
  const total = primary.length + placeholder.length + after.reduce((sum, segment) => sum + segment.length, 0);
  // The offsets of an MPF index count from the byte-order mark: marker 2 + length 2 + "MPF\0" 4 after the segment's start.
  const base = insertAt + 8;
  const real = mpf(total, secondary.length, total - base);
  return cat(primary.subarray(0, insertAt), real, ...after, primary.subarray(insertAt), secondary);
}

/** What an MPF index says, read back: where the second image starts and the sizes of both. */
export function readMpf(file: Uint8Array): { primarySize: number; secondarySize: number; secondaryStart: number } {
  const at = indexOfBytes(file, text("MPF\0"));
  const base = at + 4;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const table = base + view.getUint32(base + 8 + 2 + 2 * 12 + 8, true);
  return { primarySize: view.getUint32(table + 4, true), secondarySize: view.getUint32(table + 16 + 4, true), secondaryStart: base + view.getUint32(table + 16 + 8, true) };
}

/** The Orientation (1 to 8) an Exif segment of this file carries, or null. */
export function orientationOf(jpeg: Uint8Array): number | null {
  const at = indexOfBytes(jpeg, text("Exif\0\0"));
  if (at === -1) return null;
  const base = at + 6;
  const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  const ifd = base + view.getUint32(base + 4, true);
  for (let i = 0; i < view.getUint16(ifd, true); i++) {
    const entry = ifd + 2 + i * 12;
    if (view.getUint16(entry, true) === 0x0112) return view.getUint16(entry + 8, true);
  }
  return null;
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream of one stored (uncompressed) block: valid, and needs no compressor. */
export const zlibStored = (data: Uint8Array) => cat(Uint8Array.of(0x78, 0x01, 0x01), le16(data.length), le16(~data.length & 0xffff), data, be32(adler32(data)));

export const pngChunk = (type: string, data: Uint8Array = new Uint8Array(0)) => cat(be32(data.length), text(type), data, be32(crc32(cat(text(type), data))));

export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
export const pngHeader = (width: number, height: number) => pngChunk("IHDR", cat(be32(width), be32(height), Uint8Array.of(8, 2, 0, 0, 0)));
/** The picture data of a width x 1 RGB image: one filter byte and the pixels, in one stored zlib block. */
export const pngData = (width = 2) => pngChunk("IDAT", zlibStored(cat(Uint8Array.of(0), Uint8Array.from({ length: width * 3 }, (_, i) => (i * 40) & 0xff))));

/** A PNG made of these chunks in this order: signature, IHDR, the middle chunks, IEND. */
export const pngFile = (width: number, height: number, ...middle: Uint8Array[]) => cat(PNG_SIGNATURE, pngHeader(width, height), ...middle, pngChunk("IEND"));

export const textChunk = (keyword: string, value: string) => pngChunk("tEXt", text(`${keyword}\0${value}`));
export const zTextChunk = (keyword: string, value: string) => pngChunk("zTXt", cat(text(`${keyword}\0`), Uint8Array.of(0), zlibStored(text(value))));
export const xmpChunk = (xml: string) => pngChunk("iTXt", cat(text("XML:com.adobe.xmp\0"), Uint8Array.of(0, 0), text("\0\0"), text(xml)));
export const timeChunk = () => pngChunk("tIME", cat(be16(2026), Uint8Array.of(10, 15, 9, 30, 0)));

// ---------------------------------------------------------------- WebP

/** Chunk payloads are padded to an even length, and the RIFF size counts everything after its own 8 bytes. */
export function riffWebp(...chunks: [string, Uint8Array][]): Uint8Array {
  const body = cat(text("WEBP"), ...chunks.map(([type, payload]) => cat(text(type), le32(payload.length), payload, payload.length % 2 ? Uint8Array.of(0) : new Uint8Array(0))));
  return cat(text("RIFF"), le32(body.length), body);
}

export const VP8X_ICC = 0x20;
export const VP8X_EXIF = 0x08;
export const VP8X_XMP = 0x04;
/** The VP8X header chunk: flags, 3 reserved bytes, canvas width - 1 and height - 1 as 24-bit little-endian numbers. */
export const vp8x = (flags: number, width: number, height: number): [string, Uint8Array] => [
  "VP8X",
  cat(Uint8Array.of(flags, 0, 0, 0), Uint8Array.of((width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff), Uint8Array.of((height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff)),
];
/** A lossless image chunk of a given size: the 0x2f signature, 14-bit width - 1 and height - 1, then picture bytes. */
export const vp8l = (width: number, height: number, extra = 21): [string, Uint8Array] => ["VP8L", cat(Uint8Array.of(0x2f), le32(((height - 1) << 14) | (width - 1)), Uint8Array.from({ length: extra }, (_, i) => (i * 13 + 5) & 0xff))];
export const exifChunk = (options: Parameters<typeof tiff>[0]): [string, Uint8Array] => ["EXIF", tiff(options)];
export const xmpWebpChunk = (xml: string): [string, Uint8Array] => ["XMP ", text(xml)];
export const iccWebpChunk = (): [string, Uint8Array] => ["ICCP", cat(new Uint8Array(36), text("acsp"), text(ICC_MARK), new Uint8Array(30))];
