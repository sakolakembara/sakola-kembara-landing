import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAssets } from '../scripts/build-assets.mjs';
import { shrinkPdf } from '../scripts/lib/pdf-shrink.mjs';

// scripts/build-assets.mjs on throwaway folders: what the pipeline does with a
// source tree, not with the real photos (tests/assets.test.ts checks those).

const jpeg = (width: number, height: number, background = '#336699', orientation?: number) =>
  sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .withMetadata(orientation ? { orientation } : {})
    .toBuffer();
const png = (width: number, height: number, background: string | { r: number; g: number; b: number; alpha: number } = '#aa3333') =>
  sharp({ create: { width, height, channels: typeof background === 'string' ? 3 : 4, background } }).png().toBuffer();
const webp = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#33aa33' } }).webp().toBuffer();

type Manifest = { images: Record<string, { width: number; height: number; hash: string; variants: { width: number; height: number }[] }> };

describe('build-assets on throwaway folders', () => {
  let root: string;
  const dirs = (name: string) => ({
    sourceDir: path.join(root, name, 'source'),
    outDir: path.join(root, name, 'out'),
    manifestFile: path.join(root, name, 'manifest.json'),
    stateFile: path.join(root, name, 'state.json'),
    log: () => {},
  });
  const write = (file: string, data: Buffer | string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
  };
  const manifestOf = (p: ReturnType<typeof dirs>) => JSON.parse(readFileSync(p.manifestFile, 'utf8')) as Manifest;
  const ls = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : []);

  /** A small tree: a site photo, a transparent logo, a blog photo above the cap, a pdf and a README. */
  async function tree(name: string) {
    const p = dirs(name);
    write(path.join(p.sourceDir, 'images/a.jpg'), await jpeg(1000, 500));
    write(path.join(p.sourceDir, 'images/small.png'), await png(300, 200));
    write(path.join(p.sourceDir, 'blog/images/2026/05/big.jpg'), await jpeg(2000, 1000));
    write(path.join(p.sourceDir, 'files/doc.pdf'), '%PDF-1.4 not a real document');
    write(path.join(p.sourceDir, 'images/README.md'), 'not an asset');
    return p;
  }

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sakem-assets-'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes the manifest, a ladder that never upscales, a capped original URL, copies the files and skips READMEs', async () => {
    const p = await tree('basic');
    await buildAssets(p);
    const { images } = manifestOf(p);
    expect(Object.keys(images)).toEqual(['/blog/images/2026/05/big.jpg', '/images/a.jpg', '/images/small.png']);
    expect(images['/images/a.jpg'].variants).toEqual([{ width: 480, height: 240 }, { width: 768, height: 384 }, { width: 1000, height: 500 }]);
    expect(images['/images/small.png'].variants).toEqual([{ width: 300, height: 200 }]); // never enlarged
    expect(images['/blog/images/2026/05/big.jpg'].variants.map((v) => v.width)).toEqual([480, 768, 1200, 1600]); // capped at 1600
    const big = await sharp(path.join(p.outDir, 'blog/images/2026/05/big.jpg')).metadata();
    expect([big.format, big.width, big.height]).toEqual(['jpeg', 1600, 800]);
    expect(readFileSync(path.join(p.outDir, 'files/doc.pdf'), 'utf8')).toBe('%PDF-1.4 not a real document'); // small: copied as is
    expect(existsSync(path.join(p.outDir, 'images/README.md'))).toBe(false);
    for (const [url, entry] of Object.entries(images)) {
      for (const v of entry.variants) {
        const meta = await sharp(path.join(p.outDir, '_img', `${entry.hash}-${v.width}.webp`)).metadata();
        expect([meta.format, meta.width, meta.height], url).toEqual(['webp', v.width, v.height]);
      }
    }
  });

  it('applies EXIF rotation (a 400x200 file marked "rotate 90" is a 200x400 photo) and strips the metadata', async () => {
    const p = dirs('exif');
    write(path.join(p.sourceDir, 'images/r.jpg'), await jpeg(400, 200, '#336699', 6));
    await buildAssets(p);
    const entry = manifestOf(p).images['/images/r.jpg'];
    expect([entry.width, entry.height]).toEqual([200, 400]);
    const original = await sharp(path.join(p.outDir, 'images/r.jpg')).metadata();
    expect([original.width, original.height, original.orientation, original.exif]).toEqual([200, 400, undefined, undefined]);
    const derivative = await sharp(path.join(p.outDir, '_img', `${entry.hash}-200.webp`)).metadata();
    expect([derivative.width, derivative.height]).toEqual([200, 400]);
  });

  it('serves each original URL as the format its extension says, whatever the source data is', async () => {
    const p = dirs('formats');
    write(path.join(p.sourceDir, 'images/png-named.jpg'), await png(200, 100)); // PNG data named .jpg
    write(path.join(p.sourceDir, 'images/webp-named.png'), await webp(200, 100)); // WebP data named .png
    write(path.join(p.sourceDir, 'images/alpha-named.jpg'), await png(200, 100, { r: 0, g: 0, b: 0, alpha: 0 })); // transparent, named .jpg
    await buildAssets(p);
    for (const [file, format] of [['png-named.jpg', 'jpeg'], ['webp-named.png', 'png'], ['alpha-named.jpg', 'jpeg']] as const) {
      const meta = await sharp(path.join(p.outDir, 'images', file)).metadata();
      expect(meta.format, file).toBe(format);
    }
    const flat = await sharp(path.join(p.outDir, 'images/alpha-named.jpg')).raw().toBuffer({ resolveWithObject: true });
    expect([...flat.data.subarray(0, 3)]).toEqual([255, 255, 255]); // flattened onto white, not black
  });

  it('a second run writes nothing; a changed source gets a new hash and its old derivatives are removed', async () => {
    const p = await tree('rerun');
    await buildAssets(p);
    const file = path.join(p.outDir, 'blog/images/2026/05/big.jpg');
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(file, old, old);
    const before = manifestOf(p).images['/images/a.jpg'];
    const second = await buildAssets(p);
    expect(second!.stats.encoded).toBe(0);
    expect(statSync(file).mtime.getTime()).toBe(old.getTime());

    write(path.join(p.sourceDir, 'images/a.jpg'), await jpeg(1000, 500, '#00aa00')); // replaced in place
    await buildAssets(p);
    const after = manifestOf(p).images['/images/a.jpg'];
    expect(after.hash).not.toBe(before.hash);
    for (const v of before.variants) expect(existsSync(path.join(p.outDir, '_img', `${before.hash}-${v.width}.webp`)), `old ${v.width}`).toBe(false);
    for (const v of after.variants) expect(existsSync(path.join(p.outDir, '_img', `${after.hash}-${v.width}.webp`)), `new ${v.width}`).toBe(true);
    const served = await sharp(path.join(p.outDir, 'images/a.jpg')).stats();
    expect(served.channels[1].mean).toBeGreaterThan(150); // the green one, not the stale blue file
  });

  it('removes stale files in the generated folders and leaves everything else alone', async () => {
    const p = await tree('stale');
    write(path.join(p.outDir, 'images/gone.jpg'), 'x');
    write(path.join(p.outDir, '_img/deadbeef0000-480.webp'), 'x');
    write(path.join(p.outDir, 'files/old.pdf'), 'x');
    write(path.join(p.outDir, '_headers'), 'kept');
    write(path.join(p.outDir, 'favicon.ico'), 'kept');
    const report = await buildAssets(p);
    expect(report!.pruned).toBe(3);
    expect(existsSync(path.join(p.outDir, 'images/gone.jpg'))).toBe(false);
    expect(ls(p.outDir)).toContain('_headers');
    expect(ls(p.outDir)).toContain('favicon.ico');
  });

  it('identical sources share their derivatives but each keeps its own original URL', async () => {
    const p = dirs('dupes');
    const same = await jpeg(900, 600);
    write(path.join(p.sourceDir, 'blog/images/2024/12/x.jpg'), same);
    write(path.join(p.sourceDir, 'blog/images/2025/12/x.jpg'), same);
    await buildAssets(p);
    const { images } = manifestOf(p);
    expect(images['/blog/images/2024/12/x.jpg'].hash).toBe(images['/blog/images/2025/12/x.jpg'].hash);
    expect(ls(path.join(p.outDir, '_img')).length).toBe(images['/blog/images/2024/12/x.jpg'].variants.length);
    expect(existsSync(path.join(p.outDir, 'blog/images/2024/12/x.jpg'))).toBe(true);
    expect(existsSync(path.join(p.outDir, 'blog/images/2025/12/x.jpg'))).toBe(true);
  });

  it('--manifest-only writes the manifest and nothing else', async () => {
    const p = await tree('manifest-only');
    await buildAssets({ ...p, manifestOnly: true });
    expect(Object.keys(manifestOf(p).images)).toHaveLength(3);
    expect(existsSync(p.outDir)).toBe(false);
  });

  it('a file sharp cannot read fails the build and names the file', async () => {
    const p = dirs('bad');
    write(path.join(p.sourceDir, 'images/fine.jpg'), await jpeg(100, 100));
    write(path.join(p.sourceDir, 'images/bad.jpg'), 'this is text, not a jpeg');
    await expect(buildAssets(p)).rejects.toThrow(/\/images\/bad\.jpg/);
  });

  it.each(['anim.gif', 'photo.avif', 'scan.tiff', 'old.bmp'])('a %s among the images fails the build instead of shipping unprocessed', async (name) => {
    const p = dirs(`unsupported-${name}`);
    write(path.join(p.sourceDir, 'images/fine.jpg'), await jpeg(100, 100));
    write(path.join(p.sourceDir, 'images', name), 'x');
    await expect(buildAssets(p)).rejects.toThrow(new RegExp(`/images/${name.replace('.', '\\.')}.*Convert`));
  });

  it('no images at all fails the build', async () => {
    const p = dirs('empty');
    mkdirSync(path.join(p.sourceDir, 'images'), { recursive: true });
    await expect(buildAssets(p)).rejects.toThrow(/no images found/);
  });
});

describe('shrinkPdf', () => {
  const pdfWith = async (...images: { width: number; height: number; quality: number }[]) => {
    const doc = await PDFDocument.create();
    for (const { width, height, quality } of images) {
      const noise = await sharp({ create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg({ quality }).toBuffer();
      const page = doc.addPage([400, 300]);
      page.drawImage(await doc.embedJpg(noise), { x: 0, y: 0, width: 400, height: 300 });
    }
    return doc.save();
  };
  const widths = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const out: number[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') out.push(obj.dict.get(PDFName.of('Width'))!.toString() as unknown as number);
    }
    return out.map(Number);
  };

  it('re-encodes a big RGB JPEG at the same pixel size, keeps every page, and leaves small images alone', async () => {
    const source = await pdfWith({ width: 1600, height: 1200, quality: 99 }, { width: 64, height: 48, quality: 99 });
    const result = await shrinkPdf(source);
    expect(source.length).toBeGreaterThan(500 * 1024);
    expect(result.replaced).toBe(1);
    expect(result.pages).toBe(2);
    expect(result.bytes.length).toBeLessThan(source.length * 0.85);
    expect((await widths(result.bytes)).sort((a, b) => a - b)).toEqual([64, 1600]); // sizes unchanged
    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(doc.getPage(0).getSize()).toEqual({ width: 400, height: 300 });
  });

  it('a PDF without a big JPEG is rewritten with every page and nothing replaced', async () => {
    const source = await pdfWith({ width: 64, height: 48, quality: 90 });
    const result = await shrinkPdf(source);
    expect(result.replaced).toBe(0);
    expect(result.pages).toBe(1);
  });
});
