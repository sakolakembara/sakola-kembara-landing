import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile, sanitizeImportedImage } from '../../../scripts/lib/blog-pipeline.mjs';
import { findGpsMetadata } from '../../../scripts/lib/image-gps.mjs';
import { JpegFormatError, isJpeg, stripJpegMetadata } from '../../../scripts/lib/strip-jpeg-metadata.mjs';
import {
  GPS_XMP,
  IPTC_NAME,
  baseJpeg,
  basePng,
  baseWebp,
  comSegment,
  decoded,
  exifChunkData,
  exifSegment,
  findSegment,
  iptcSegment,
  markerNames,
  multiPicture,
  pngWithChunk,
  readMpf,
  scanStart,
  unknownAppSegment,
  webpWithChunk,
  withSegmentBeforeEoi,
  withSegments,
  xmpSegment,
  xmpTextChunkData,
} from './jpeg-fixtures';

// The lossless JPEG metadata stripper, the GPS detector and the import step that uses them (SAKEM-099), on small
// synthetic files: a real JPEG made by sharp with hand-built Exif/XMP/IPTC put in. tests/repo-image-metadata.test.ts
// runs the detector over the real files of the repository.

const phoneExif = { make: 'TestPhone', gps: true, thumbnailIfd: true };

describe('stripJpegMetadata', () => {
  it('removes Exif with a GPS IFD, XMP and IPTC, and not one byte of the scan data or one pixel', async () => {
    const clean = await baseJpeg();
    const dirty = withSegments(clean, exifSegment(phoneExif), xmpSegment(GPS_XMP), iptcSegment());
    expect(findGpsMetadata(dirty).hits.length).toBeGreaterThan(0);
    expect(dirty.includes(IPTC_NAME)).toBe(true);

    const result = stripJpegMetadata(dirty);

    expect(result.changed).toBe(true);
    expect(findGpsMetadata(result.data).hits).toEqual([]);
    expect(result.data.includes(IPTC_NAME)).toBe(false);
    expect(result.data.includes('TestPhone')).toBe(false);
    expect(result.removed.map((r) => r.marker)).toEqual(['APP1', 'APP1', 'APP13']);
    expect(markerNames(result.data)).not.toContain('APP1');
    expect(markerNames(result.data)).not.toContain('APP13');
    // the scan data and everything after it, byte for byte
    expect(result.data.subarray(scanStart(result.data)).equals(dirty.subarray(scanStart(dirty)))).toBe(true);
    // and, as a decoder sees it, the same picture, the same size
    expect(await decoded(result.data)).toEqual(await decoded(dirty));
    expect(await decoded(result.data)).toEqual(await decoded(clean));
    // the outcome is exactly the file without the metadata
    expect(result.data.equals(clean)).toBe(true);
  });

  it('returns a JPEG that has no such metadata as it is: the same buffer, changed false', async () => {
    const clean = await baseJpeg();
    const result = stripJpegMetadata(clean);
    expect(result.changed).toBe(false);
    expect(result.data).toBe(clean);
    expect(result.removed).toEqual([]);
  });

  it('is idempotent', async () => {
    const dirty = withSegments(await baseJpeg(), exifSegment({ ...phoneExif, orientation: 6 }), xmpSegment(GPS_XMP));
    const once = stripJpegMetadata(dirty);
    const twice = stripJpegMetadata(once.data);
    expect(twice.changed).toBe(false);
    expect(twice.data.equals(once.data)).toBe(true);
  });

  it('keeps the colour profile (APP2 ICC) and the JFIF header as they were', async () => {
    const clean = await baseJpeg({ icc: 'p3' });
    const icc = findSegment(clean, 0xe2, 'ICC_PROFILE\0');
    expect(icc).not.toBeNull();
    const result = stripJpegMetadata(withSegments(clean, exifSegment(phoneExif), xmpSegment(GPS_XMP)));
    expect(findSegment(result.data, 0xe2, 'ICC_PROFILE\0')?.equals(icc!)).toBe(true);
    expect(findSegment(result.data, 0xe0, 'JFIF\0')).not.toBeNull();
    expect(result.data.equals(clean)).toBe(true);
    const meta = await sharp(result.data).metadata();
    expect(meta.icc?.length).toBeGreaterThan(0);
    expect(meta.icc?.equals((await sharp(clean).metadata()).icc!)).toBe(true);
  });

  it.each([2, 3, 4, 5, 6, 7, 8])('keeps the rotation of Orientation %i with a minimal Exif block that holds only that tag', async (orientation) => {
    const clean = await baseJpeg({ width: 24, height: 16 });
    const dirty = withSegments(clean, exifSegment({ ...phoneExif, orientation }));

    const result = stripJpegMetadata(dirty);

    expect(result.orientation).toBe(orientation);
    expect(findGpsMetadata(result.data).hits).toEqual([]);
    const exif = findSegment(result.data, 0xe1, 'Exif\0\0');
    expect(exif).not.toBeNull();
    expect(exif!.length).toBe(36); // marker 2 + length 2 + "Exif\0\0" 6 + TIFF header 8 + one IFD entry 18
    expect(result.data.includes('TestPhone')).toBe(false);
    expect((await sharp(result.data).metadata()).orientation).toBe(orientation);
    // what a viewer shows (rotation applied) is what it showed before
    const rotated = await sharp(result.data).rotate().raw().toBuffer({ resolveWithObject: true });
    const original = await sharp(dirty).rotate().raw().toBuffer({ resolveWithObject: true });
    expect(rotated.data.equals(original.data)).toBe(true);
    expect([rotated.info.width, rotated.info.height]).toEqual([original.info.width, original.info.height]);
    // and it is stable
    expect(stripJpegMetadata(result.data).changed).toBe(false);
  });

  it.each([
    ['orientation 1', { orientation: 1 }],
    ['no orientation tag', {}],
    ['an invalid orientation (0)', { orientation: 0 }],
    ['an invalid orientation (9)', { orientation: 9 }],
  ])('keeps no Exif at all when it carries %s: that is what the missing tag means', async (_name, tags) => {
    const clean = await baseJpeg();
    const result = stripJpegMetadata(withSegments(clean, exifSegment({ ...phoneExif, ...tags })));
    expect(result.orientation).toBeNull();
    expect(findSegment(result.data, 0xe1)).toBeNull();
    expect(result.data.equals(clean)).toBe(true);
  });

  it('removes a segment that sits between the scan and EOI, and one behind fill bytes', async () => {
    const clean = await baseJpeg();
    const late = withSegmentBeforeEoi(clean, xmpSegment(GPS_XMP));
    expect(findGpsMetadata(late).hits.length).toBeGreaterThan(0);
    const result = stripJpegMetadata(late);
    expect(result.data.equals(clean)).toBe(true);

    // 0xFF fill bytes may precede any marker
    const filled = Buffer.concat([clean.subarray(0, 2), Buffer.from([0xff, 0xff, 0xff]), exifSegment(phoneExif).subarray(1), clean.subarray(2)]);
    expect(findGpsMetadata(filled).hits.length).toBeGreaterThan(0);
    const stripped = stripJpegMetadata(filled);
    expect(findGpsMetadata(stripped.data).hits).toEqual([]);
    expect(await decoded(stripped.data)).toEqual(await decoded(clean));
  });

  it('handles a progressive file (several scans) and keeps its scan data', async () => {
    const clean = await baseJpeg({ width: 64, height: 48, progressive: true });
    expect(markerNames(clean)).toContain('0xc2'); // SOF2
    const dirty = withSegments(clean, exifSegment(phoneExif), xmpSegment(GPS_XMP));
    // a segment between two scans (right before the second SOS), one after the last scan
    const secondScan = dirty.indexOf(Buffer.from([0xff, 0xda]), scanStart(dirty) + 2);
    expect(secondScan).toBeGreaterThan(0);
    const between = Buffer.concat([dirty.subarray(0, secondScan), xmpSegment(GPS_XMP), dirty.subarray(secondScan)]);
    const result = stripJpegMetadata(withSegmentBeforeEoi(between, iptcSegment()));
    expect(findGpsMetadata(result.data).hits).toEqual([]);
    expect(result.data.equals(clean)).toBe(true);
  });

  it('reports what it does not recognise and keeps it: unknown APPn and comments with text', async () => {
    const clean = await baseJpeg();
    const dirty = withSegments(clean, unknownAppSegment(10, 'AROT'), comSegment('hello'), comSegment('\0'));
    const result = stripJpegMetadata(dirty);
    expect(result.changed).toBe(false);
    expect(result.keptUnknown.map((k) => `${k.marker} ${k.id}`)).toEqual(['APP10 AROT', 'COM hello']);
    expect(result.data).toBe(dirty);
  });

  it('refuses what it cannot walk instead of guessing', async () => {
    const clean = await baseJpeg();
    const png = await basePng();
    expect(isJpeg(clean)).toBe(true);
    expect(isJpeg(png)).toBe(false);
    expect(() => stripJpegMetadata(Buffer.from('not a picture'))).toThrow(JpegFormatError);
    expect(() => stripJpegMetadata(png)).toThrow(/not a JPEG/);
    const cut = Buffer.concat([clean.subarray(0, 2), exifSegment(phoneExif).subarray(0, 40)]);
    expect(() => stripJpegMetadata(cut)).toThrow(/runs past the end/);
    // SOI, a complete APP0, then a byte that is not 0xFF where a marker must be
    const junk = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01]);
    expect(() => stripJpegMetadata(junk)).toThrow(/expected a marker/);
  });

  describe('a multi-picture file (a second JPEG after the first, MPF index in the header)', () => {
    it('keeps the second image whole and points the MPF index at it again when the Exif came first', async () => {
      const primary = await baseJpeg({ width: 32, height: 24 });
      const secondary = await baseJpeg({ width: 8, height: 6 });
      const file = multiPicture(primary, secondary, { before: [exifSegment(phoneExif)] });
      expect(readMpf(file).secondaryStart).toBe(file.length - secondary.length);

      const result = stripJpegMetadata(file);

      expect(findGpsMetadata(result.data).hits).toEqual([]);
      expect(result.warnings).toEqual([]);
      const index = readMpf(result.data);
      expect(index.secondaryStart).toBe(result.data.length - secondary.length);
      expect(result.data.subarray(index.secondaryStart).equals(secondary)).toBe(true);
      expect(index.primarySize).toBe(result.data.length - secondary.length); // the first image ends where the second begins
      expect(index.secondarySize).toBe(secondary.length);
      expect(await decoded(result.data)).toEqual(await decoded(primary));
      expect(stripJpegMetadata(result.data).changed).toBe(false);
    });

    it('also follows a segment removed AFTER the MPF header', async () => {
      const primary = await baseJpeg({ width: 32, height: 24, icc: 'srgb' });
      const secondary = await baseJpeg({ width: 8, height: 6 });
      const file = multiPicture(primary, secondary, { before: [exifSegment(phoneExif)], after: [xmpSegment(GPS_XMP), iptcSegment()] });
      expect(readMpf(file).secondaryStart).toBe(file.length - secondary.length);

      const result = stripJpegMetadata(file);

      expect(findGpsMetadata(result.data).hits).toEqual([]);
      const index = readMpf(result.data);
      expect(index.secondaryStart).toBe(result.data.length - secondary.length);
      expect(result.data.subarray(index.secondaryStart, index.secondaryStart + index.secondarySize).equals(secondary)).toBe(true);
      expect(index.primarySize).toBe(result.data.length - secondary.length);
      expect(findSegment(result.data, 0xe2, 'ICC_PROFILE\0')).not.toBeNull();
      expect(await decoded(result.data)).toEqual(await decoded(primary));
    });

    it('leaves an unreadable MPF index alone and says so', async () => {
      const primary = await baseJpeg();
      const file = multiPicture(primary, await baseJpeg({ width: 8, height: 6 }), { before: [exifSegment(phoneExif)] });
      const broken = Buffer.from(file);
      const at = broken.indexOf(Buffer.from('MPF\0', 'latin1'));
      broken.write('XX', at + 4, 'latin1'); // no byte-order mark
      const result = stripJpegMetadata(broken);
      expect(result.warnings).toHaveLength(1);
      expect(findGpsMetadata(result.data).hits).toEqual([]);
    });
  });
});

describe('findGpsMetadata', () => {
  it('finds the GPS IFD pointer of a JPEG, its XMP properties, and does not fire on a clean file or on Exif without GPS', async () => {
    const clean = await baseJpeg();
    expect(findGpsMetadata(clean)).toEqual({ format: 'jpeg', hits: [] });
    expect(findGpsMetadata(withSegments(clean, exifSegment({ make: 'TestPhone', orientation: 6, thumbnailIfd: true }))).hits).toEqual([]);
    expect(findGpsMetadata(withSegments(clean, exifSegment({ gps: true }))).hits).toEqual([expect.stringContaining('GPS IFD pointer')]);
    expect(findGpsMetadata(withSegments(clean, xmpSegment(GPS_XMP))).hits).toEqual(['GPS property names in XMP']);
    expect(findGpsMetadata(withSegments(clean, xmpSegment('<x:xmpmeta><rdf:Description dc:title="x"/></x:xmpmeta>'))).hits).toEqual([]);
  });

  it('looks inside the second image of a multi-picture file, too', async () => {
    const secondary = withSegments(await baseJpeg({ width: 8, height: 6 }), exifSegment({ gps: true }));
    const file = multiPicture(await baseJpeg(), secondary);
    expect(findGpsMetadata(file).hits).toHaveLength(1);
  });

  it('finds GPS in a PNG (eXIf chunk, plain and compressed XMP) and in a WebP (EXIF chunk), and not in clean ones', async () => {
    const png = await basePng();
    expect(findGpsMetadata(png)).toEqual({ format: 'png', hits: [] });
    expect(findGpsMetadata(pngWithChunk(png, 'eXIf', exifChunkData({ make: 'TestPhone' }))).hits).toEqual([]);
    expect(findGpsMetadata(pngWithChunk(png, 'eXIf', exifChunkData({ gps: true }))).hits).toEqual([expect.stringContaining('eXIf chunk')]);
    expect(findGpsMetadata(pngWithChunk(png, 'iTXt', xmpTextChunkData(GPS_XMP, false))).hits.length).toBeGreaterThan(0);
    expect(findGpsMetadata(pngWithChunk(png, 'iTXt', xmpTextChunkData(GPS_XMP, true))).hits).toEqual([expect.stringContaining('iTXt chunk')]);

    const webp = await baseWebp();
    expect(findGpsMetadata(webp)).toEqual({ format: 'webp', hits: [] });
    expect(findGpsMetadata(webpWithChunk(webp, 'EXIF', exifChunkData({ make: 'TestPhone' }))).hits).toEqual([]);
    expect(findGpsMetadata(webpWithChunk(webp, 'EXIF', exifChunkData({ gps: true }))).hits).toEqual([expect.stringContaining('EXIF chunk')]);
  });

  it('finds the pointer in a TIFF file and tolerates damaged structures', () => {
    expect(findGpsMetadata(exifChunkData({ gps: true }))).toEqual({ format: 'tiff', hits: ['GPS IFD pointer in the TIFF directory'] });
    const damaged = Buffer.from(exifChunkData({ gps: true }));
    damaged.writeUInt32LE(0x7fffffff, 4); // IFD offset far outside the file
    expect(findGpsMetadata(damaged).hits).toEqual([]);
    expect(findGpsMetadata(Buffer.alloc(0)).hits).toEqual([]);
    expect(findGpsMetadata(Buffer.from('Exif\0\0II*\0')).hits).toEqual([]);
  });
});

describe('the import step (blog-pipeline.mjs)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sakem-strip-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const respondWith = (body: Buffer) => vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(body), { status: 200 })));

  it('writes a downloaded JPEG without its GPS, with the pixels it came with', async () => {
    const clean = await baseJpeg({ width: 40, height: 30, icc: 'p3' });
    respondWith(withSegments(clean, exifSegment(phoneExif), xmpSegment(GPS_XMP), iptcSegment()));
    const dest = path.join(dir, 'blog/images/2026/10/photo.jpg');

    expect(await downloadFile('https://example.org/wp-content/uploads/2026/10/photo.jpg', dest)).toBe(true);

    const written = readFileSync(dest);
    expect(findGpsMetadata(written).hits).toEqual([]);
    expect(written.equals(clean)).toBe(true);
    expect(await decoded(written)).toEqual(await decoded(clean));
  });

  it('strips by content, not by extension: a JPEG named .png is cleaned, a PNG named .jpg is left alone', async () => {
    const jpegNamedPng = withSegments(await baseJpeg(), exifSegment(phoneExif));
    expect(findGpsMetadata(sanitizeImportedImage(jpegNamedPng, 'a.png')).hits).toEqual([]);
    const png = await basePng();
    expect(sanitizeImportedImage(png, 'a.jpg')).toBe(png);
  });

  it('refuses a PNG or WebP that carries GPS, and writes nothing', async () => {
    const png = pngWithChunk(await basePng(), 'eXIf', exifChunkData({ gps: true }));
    expect(() => sanitizeImportedImage(png, 'https://example.org/a.png')).toThrow(/carries GPS metadata that the importer cannot strip/);
    const webp = webpWithChunk(await baseWebp(), 'EXIF', exifChunkData({ gps: true }));
    expect(() => sanitizeImportedImage(webp, 'https://example.org/a.webp')).toThrow(/GPS/);

    respondWith(png);
    const dest = path.join(dir, 'a.png');
    await expect(downloadFile('https://example.org/wp-content/uploads/a.png', dest)).rejects.toThrow(/GPS/);
    expect(existsSync(dest)).toBe(false);
  });

  it('passes clean PNG and WebP through untouched', async () => {
    const png = await basePng();
    const webp = await baseWebp();
    expect(sanitizeImportedImage(png)).toBe(png);
    expect(sanitizeImportedImage(webp)).toBe(webp);
  });

  it('refuses a JPEG it cannot walk (nothing is written)', async () => {
    respondWith(Buffer.concat([(await baseJpeg()).subarray(0, 2), Buffer.from([0xff, 0xe1, 0xff, 0xff, 0x00])]));
    const dest = path.join(dir, 'broken.jpg');
    await expect(downloadFile('https://example.org/wp-content/uploads/broken.jpg', dest)).rejects.toThrow(JpegFormatError);
    expect(existsSync(dest)).toBe(false);
  });
});
