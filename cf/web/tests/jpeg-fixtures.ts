import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';

// Synthetic images for the metadata tests (SAKEM-099): a real, decodable JPEG/PNG/WebP made by sharp, plus
// hand-built Exif, XMP, IPTC, MPF and PNG/WebP chunks that are put into it. The GPS position in them is an
// invented one (1 degree north, 2 degrees east); no real photo is involved.

// ---------------------------------------------------------------- base images

/** A JFIF APP0 header (version 1.1, no density, no thumbnail): sharp writes none, most files of the repository have one. */
const JFIF = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);

/** A decodable JPEG with a JFIF header and noise in it (so the scan data is not trivial). `icc` adds a colour profile (APP2). */
export async function baseJpeg(options: { width?: number; height?: number; icc?: 'p3' | 'srgb'; progressive?: boolean } = {}): Promise<Buffer> {
  const { width = 24, height = 16, icc, progressive = false } = options;
  let image = sharp({ create: { width, height, channels: 3, background: '#335577', noise: { type: 'gaussian', mean: 128, sigma: 40 } } });
  if (icc) image = image.withIccProfile(icc);
  const jpeg = await image.jpeg({ quality: 90, progressive }).toBuffer();
  return Buffer.concat([jpeg.subarray(0, 2), JFIF, jpeg.subarray(2)]);
}

export const basePng = (): Promise<Buffer> => sharp({ create: { width: 8, height: 8, channels: 3, background: '#aa3333' } }).png().toBuffer();
export const baseWebp = (): Promise<Buffer> => sharp({ create: { width: 8, height: 8, channels: 3, background: '#33aa33' } }).webp().toBuffer();

/** The decoded pixels (no rotation applied) and size: what "the same picture" means in these tests. */
export async function decoded(image: Buffer): Promise<{ pixels: string; size: string }> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  return { pixels: data.toString('base64'), size: `${info.width}x${info.height}x${info.channels}` };
}

// ---------------------------------------------------------------- Exif / TIFF

interface Entry {
  tag: number;
  /** 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL */
  type: 2 | 3 | 4 | 5;
  count: number;
  value: Buffer;
}

const ascii = (text: string): Entry['value'] => Buffer.from(`${text}\0`, 'latin1');
const rationals = (...pairs: [number, number][]): Buffer => {
  const out = Buffer.alloc(pairs.length * 8);
  pairs.forEach(([n, d], i) => {
    out.writeUInt32LE(n, i * 8);
    out.writeUInt32LE(d, i * 8 + 4);
  });
  return out;
};

/** A little-endian TIFF structure: IFD0 (optionally with a GPS IFD behind a 0x8825 pointer) and its data area. */
export function tiff(options: { orientation?: number; make?: string; gps?: boolean; thumbnailIfd?: boolean }): Buffer {
  const ifd0: Entry[] = [];
  if (options.make) ifd0.push({ tag: 0x010f, type: 2, count: options.make.length + 1, value: ascii(options.make) });
  if (options.orientation !== undefined) {
    const value = Buffer.alloc(2);
    value.writeUInt16LE(options.orientation);
    ifd0.push({ tag: 0x0112, type: 3, count: 1, value });
  }
  const gps: Entry[] = options.gps
    ? [
        { tag: 0x0001, type: 2, count: 2, value: ascii('N') },
        { tag: 0x0002, type: 5, count: 3, value: rationals([1, 1], [0, 1], [0, 1]) },
        { tag: 0x0003, type: 2, count: 2, value: ascii('E') },
        { tag: 0x0004, type: 5, count: 3, value: rationals([2, 1], [0, 1], [0, 1]) },
      ]
    : [];
  if (options.gps) ifd0.push({ tag: 0x8825, type: 4, count: 1, value: Buffer.alloc(4) }); // offset patched below

  const ifdSize = (entries: number) => 2 + entries * 12 + 4;
  const ifd0At = 8;
  const gpsAt = ifd0At + ifdSize(ifd0.length);
  const thumbAt = gpsAt + (options.gps ? ifdSize(gps.length) : 0);
  const dataAt = thumbAt + (options.thumbnailIfd ? ifdSize(0) : 0);
  const data: Buffer[] = [];
  let dataLength = 0;

  const writeIfd = (entries: Entry[], nextIfd: number): Buffer => {
    const out = Buffer.alloc(ifdSize(entries.length));
    out.writeUInt16LE(entries.length, 0);
    entries.forEach((entry, i) => {
      const at = 2 + i * 12;
      out.writeUInt16LE(entry.tag, at);
      out.writeUInt16LE(entry.type, at + 2);
      out.writeUInt32LE(entry.count, at + 4);
      if (entry.tag === 0x8825) entry.value.writeUInt32LE(gpsAt);
      if (entry.value.length <= 4) entry.value.copy(out, at + 8);
      else {
        out.writeUInt32LE(dataAt + dataLength, at + 8);
        data.push(entry.value);
        dataLength += entry.value.length;
      }
    });
    out.writeUInt32LE(nextIfd, 2 + entries.length * 12);
    return out;
  };

  const header = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  const parts = [header, writeIfd(ifd0, options.thumbnailIfd ? thumbAt : 0)];
  if (options.gps) parts.push(writeIfd(gps, 0));
  if (options.thumbnailIfd) parts.push(writeIfd([], 0));
  return Buffer.concat([...parts, ...data]);
}

// ---------------------------------------------------------------- JPEG segments

const segment = (marker: number, payload: Buffer): Buffer => {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 | marker, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};

export const exifSegment = (options: Parameters<typeof tiff>[0]): Buffer => segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff(options)]));
export const xmpSegment = (xml: string): Buffer => segment(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xml, 'utf8')]));
export const GPS_XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="1,0.0N" exif:GPSLongitude="2,0.0E"/></rdf:RDF></x:xmpmeta>';
export const IPTC_NAME = 'Nama Fotografer';
/** Photoshop image resources with one IPTC dataset (2:80, By-line). */
export const iptcSegment = (): Buffer => {
  const dataset = Buffer.concat([Buffer.from([0x1c, 0x02, 0x50, 0x00, IPTC_NAME.length]), Buffer.from(IPTC_NAME, 'latin1')]);
  const resource = Buffer.alloc(12);
  resource.write('8BIM', 0, 'latin1');
  resource.writeUInt16BE(0x0404, 4);
  resource.writeUInt16BE(0, 6); // empty name, padded
  resource.writeUInt32BE(dataset.length, 8);
  return segment(0xed, Buffer.concat([Buffer.from('Photoshop 3.0\0', 'latin1'), resource, dataset, dataset.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]));
};
export const comSegment = (text: string): Buffer => segment(0xfe, Buffer.from(text, 'latin1'));
export const unknownAppSegment = (n: number, id: string): Buffer => segment(0xe0 + n, Buffer.concat([Buffer.from(`${id}\0`, 'latin1'), Buffer.alloc(8, 7)]));

/** Where the segments of a JPEG are put: right after SOI and its JFIF APP0 (when it has one). */
function afterJfif(jpeg: Buffer): number {
  return jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2;
}

/** `segments` inserted behind the JFIF header, in order. */
export const withSegments = (jpeg: Buffer, ...segments: Buffer[]): Buffer => {
  const at = afterJfif(jpeg);
  return Buffer.concat([jpeg.subarray(0, at), ...segments, jpeg.subarray(at)]);
};

/** A segment placed between the entropy-coded data and EOI, where an encoder may legally put one after the scan. */
export const withSegmentBeforeEoi = (jpeg: Buffer, seg: Buffer): Buffer => Buffer.concat([jpeg.subarray(0, jpeg.length - 2), seg, jpeg.subarray(jpeg.length - 2)]);

/** The marker names of the segments before the first scan, e.g. ["APP0", "APP1", "DQT", ..., "SOS"]. */
export function markerNames(jpeg: Buffer): string[] {
  const names: string[] = [];
  let at = 2;
  while (at < jpeg.length) {
    const marker = jpeg[at + 1]!;
    names.push(marker >= 0xe0 && marker <= 0xef ? `APP${marker - 0xe0}` : marker === 0xfe ? 'COM' : marker === 0xda ? 'SOS' : `0x${marker.toString(16)}`);
    if (marker === 0xda) break;
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return names;
}

/** Offset of the first SOS marker: everything from here on is the entropy-coded data (and what follows it). */
export function scanStart(jpeg: Buffer): number {
  let at = 2;
  while (jpeg[at + 1] !== 0xda) at += 2 + jpeg.readUInt16BE(at + 2);
  return at;
}

/** The bytes of the segment of this marker (and, for APP1/APP2, this payload prefix), or null. */
export function findSegment(jpeg: Buffer, marker: number, prefix = ''): Buffer | null {
  let at = 2;
  while (at < jpeg.length && jpeg[at] === 0xff) {
    const m = jpeg[at + 1]!;
    if (m === 0xda) return null;
    const length = jpeg.readUInt16BE(at + 2);
    if (m === marker && jpeg.toString('latin1', at + 4, at + 4 + prefix.length) === prefix) return jpeg.subarray(at, at + 2 + length);
    at += 2 + length;
  }
  return null;
}

// ---------------------------------------------------------------- multi-picture JPEG

const MPF_SEGMENT_LENGTH = 90;

/** A big-endian MPF segment for two images. The sizes and the offset of the second are filled in by `multiPicture`. */
function mpfSegment(primarySize: number, secondarySize: number, secondaryOffset: number): Buffer {
  const out = Buffer.alloc(MPF_SEGMENT_LENGTH);
  out.writeUInt16BE(0xffe2, 0);
  out.writeUInt16BE(MPF_SEGMENT_LENGTH - 2, 2);
  out.write('MPF\0', 4, 'latin1');
  const base = 8;
  out.write('MM', base, 'latin1');
  out.writeUInt16BE(42, base + 2);
  out.writeUInt32BE(8, base + 4); // first IFD
  out.writeUInt16BE(3, base + 8); // three entries
  const entry = (i: number, tag: number, type: number, count: number, value: number) => {
    const at = base + 10 + i * 12;
    out.writeUInt16BE(tag, at);
    out.writeUInt16BE(type, at + 2);
    out.writeUInt32BE(count, at + 4);
    out.writeUInt32BE(value, at + 8);
  };
  entry(0, 0xb000, 7, 4, 0x30313030); // version "0100"
  entry(1, 0xb001, 4, 1, 2); // number of images
  entry(2, 0xb002, 7, 32, 50); // MP entries at base + 50
  const table = base + 50;
  out.writeUInt32BE(0x00030000, table); // image 0: primary
  out.writeUInt32BE(primarySize, table + 4);
  out.writeUInt32BE(0, table + 8);
  out.writeUInt32BE(0, table + 16); // image 1
  out.writeUInt32BE(secondarySize, table + 20);
  out.writeUInt32BE(secondaryOffset, table + 24);
  return out;
}

/**
 * A multi-picture file: `primary` (a JPEG) with `before` segments, then the MPF segment, then `after` segments
 * behind its JFIF header, followed by the `secondary` JPEG appended after the primary's EOI. The MPF index is
 * consistent: the primary's size, and the secondary's size and offset from the MPF header.
 */
export function multiPicture(primary: Buffer, secondary: Buffer, parts: { before?: Buffer[]; after?: Buffer[] } = {}): Buffer {
  const before = Buffer.concat(parts.before ?? []);
  const after = Buffer.concat(parts.after ?? []);
  const assemble = (mpf: Buffer) => withSegments(primary, before, mpf, after);
  const primaryLength = assemble(mpfSegment(0, 0, 0)).length;
  const headerAt = afterJfif(primary) + before.length + 8; // the byte-order mark of the MPF header
  const file = assemble(mpfSegment(primaryLength, secondary.length, primaryLength - headerAt));
  return Buffer.concat([file, secondary]);
}

/** The MPF index of a file: the size of image 0 and, for image 1, size and offset, plus the absolute start of image 1. */
export function readMpf(file: Buffer): { primarySize: number; secondarySize: number; secondaryStart: number } {
  const seg = findSegment(file, 0xe2, 'MPF\0');
  if (!seg) throw new Error('no MPF segment');
  const segAt = file.indexOf(seg);
  const base = segAt + 8;
  const table = base + file.readUInt32BE(base + 10 + 2 * 12 + 8); // the value of entry 2, the MP Entry table
  return {
    primarySize: file.readUInt32BE(table + 4),
    secondarySize: file.readUInt32BE(table + 20),
    secondaryStart: base + file.readUInt32BE(table + 24),
  };
}

// ---------------------------------------------------------------- PNG and WebP chunks

const pngChunk = (type: string, data: Buffer): Buffer => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** `png` with an extra chunk in front of its first IDAT. */
export function pngWithChunk(png: Buffer, type: string, data: Buffer): Buffer {
  const at = png.indexOf(Buffer.from('IDAT', 'latin1')) - 4;
  return Buffer.concat([png.subarray(0, at), pngChunk(type, data), png.subarray(at)]);
}

/** The data of an eXIf chunk: a bare TIFF structure. */
export const exifChunkData = (options: Parameters<typeof tiff>[0]): Buffer => tiff(options);
/** The data of an iTXt chunk holding XMP, compressed or not. */
export function xmpTextChunkData(xml: string, compressed: boolean): Buffer {
  const body = compressed ? deflateSync(Buffer.from(xml, 'utf8')) : Buffer.from(xml, 'utf8');
  return Buffer.concat([Buffer.from('XML:com.adobe.xmp\0', 'latin1'), Buffer.from([compressed ? 1 : 0, 0]), Buffer.from('\0\0', 'latin1'), body]);
}

/** `webp` with an extra RIFF chunk appended (the RIFF size is updated). */
export function webpWithChunk(webp: Buffer, type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  const out = Buffer.concat([webp, head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}
