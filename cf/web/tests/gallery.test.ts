import { existsSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IMAGE_RE, WIDTHS, buildGallery, compareNames, manifestModule } from '../scripts/build-gallery.mjs';
import { galleryAlt, getProgramGallery, gallerySrcset } from '~/lib/gallery';
import type { GalleryManifest } from '~/lib/gallery-types';
import { programs } from '~/lib/programs';
import { importRoot, readRoot, repoRoot, webRoot } from './helpers';

// scripts/build-gallery.mjs replaces the legacy request-time readdir (lib/gallery.ts).
// Part 1 runs it on throwaway folders; part 2 checks the manifest it wrote for the real photos.

const jpeg = (width: number, height: number, colour = '#336699', orientation?: number) =>
  sharp({ create: { width, height, channels: 3, background: colour } })
    .jpeg()
    .withMetadata(orientation ? { orientation } : {})
    .toBuffer();
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#aa3333' } }).png().toBuffer();

describe('build-gallery: listing rules (same as the legacy lib/gallery.ts)', () => {
  it.each(['1.jpg', '1.JPG', 'a.jpeg', 'a.png', 'a.webp', 'a.avif'])('%s is an image', (name) => {
    expect(IMAGE_RE.test(name)).toBe(true);
  });
  it.each(['README.md', 'a.gif', 'a.jpg.txt', 'jpg', '.DS_Store'])('%s is not', (name) => {
    expect(IMAGE_RE.test(name)).toBe(false);
  });

  it('numbered files first in numeric order, other names after, alphabetically', () => {
    const names = ['10.jpg', 'b.jpg', '2.jpg', 'a.png', '1.jpg', '07.jpeg'];
    expect([...names].sort(compareNames)).toEqual(['1.jpg', '2.jpg', '07.jpeg', '10.jpg', 'a.png', 'b.jpg']);
  });
});

describe('build-gallery: manifest and derivatives on throwaway folders', () => {
  let root: string;
  let source: string;
  let out: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sakem-gallery-'));
    source = path.join(root, 'source');
    out = path.join(root, 'out');
    await mkdir(path.join(source, 'alpha'), { recursive: true });
    await mkdir(path.join(source, 'empty'), { recursive: true });
    await mkdir(path.join(source, 'Not A Folder Name'), { recursive: true });
    await writeFile(path.join(source, 'alpha', '10.png'), await png(300, 200));
    await writeFile(path.join(source, 'alpha', '2.jpg'), await jpeg(1000, 500));
    await writeFile(path.join(source, 'alpha', 'Foto Cover!.jpg'), await jpeg(640, 480));
    await writeFile(path.join(source, 'alpha', 'README.md'), 'not a photo');
    await writeFile(path.join(source, 'empty', 'README.md'), 'a folder without photos');
    await writeFile(path.join(source, 'Not A Folder Name', '1.jpg'), await jpeg(100, 100));
    await writeFile(path.join(source, 'stray.jpg'), await jpeg(100, 100));
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('lists folders that are valid ids; a folder without images is []; strays and bad folder names are ignored', async () => {
    const manifest = await buildGallery({ source, out });
    expect(Object.keys(manifest)).toEqual(['alpha', 'empty']);
    expect(manifest.empty).toEqual([]);
  });

  it('photos come in display order and carry name, width, height and variants', async () => {
    const { alpha } = await buildGallery({ source, out });
    expect(alpha.map((p: { name: string }) => p.name)).toEqual(['2.jpg', '10.png', 'Foto Cover!.jpg']);
    for (const photo of alpha) {
      expect(Object.keys(photo).sort()).toEqual(['height', 'name', 'variants', 'width']);
      expect(Number.isInteger(photo.width) && photo.width > 0).toBe(true);
      expect(Number.isInteger(photo.height) && photo.height > 0).toBe(true);
    }
  });

  it('variants: the widths of WIDTHS, ascending; a smaller source is never enlarged and gets one', async () => {
    const { alpha } = await buildGallery({ source, out });
    const [wide, small, cover] = alpha;
    expect(wide.variants.map((v: { width: number }) => v.width)).toEqual(WIDTHS); // 1000 px wide source
    expect(wide.variants.map((v: { height: number }) => v.height)).toEqual([240, 480]);
    expect([wide.width, wide.height]).toEqual([960, 480]);
    expect(small.variants.map((v: { width: number }) => v.width)).toEqual([300]); // 300 px source
    expect([small.width, small.height]).toEqual([300, 200]);
    expect(cover.variants.map((v: { width: number }) => v.width)).toEqual([480, 640]); // between the two widths
  });

  it('file names are <slug>.<8 hex hash>-<width>.webp under /images/program/galeri/<id>/, and the files are real WebP of that size', async () => {
    const { alpha } = await buildGallery({ source, out });
    const cover = alpha[2];
    expect(cover.variants[0].src).toMatch(/^\/images\/program\/galeri\/alpha\/foto-cover\.[0-9a-f]{8}-480\.webp$/);
    for (const photo of alpha) {
      for (const v of photo.variants) {
        const file = path.join(out, v.src.replace('/images/program/galeri/', ''));
        const meta = await sharp(file).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(['webp', v.width, v.height]);
      }
    }
  });

  it('a second run changes nothing: same manifest, files untouched', async () => {
    const first = await buildGallery({ source, out });
    const file = path.join(out, first.alpha[0].variants[0].src.replace('/images/program/galeri/', ''));
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(file, old, old);
    const second = await buildGallery({ source, out });
    expect(second).toEqual(first);
    expect(statSync(file).mtime.getTime()).toBe(old.getTime());
  });

  it('replacing a photo in place changes its URL and removes the old derivatives', async () => {
    const before = (await buildGallery({ source, out })).alpha[0];
    await writeFile(path.join(source, 'alpha', '2.jpg'), await jpeg(1000, 500, '#00aa00'));
    const after = (await buildGallery({ source, out })).alpha[0];
    expect(after.variants[0].src).not.toBe(before.variants[0].src);
    expect(after.name).toBe(before.name);
    for (const v of before.variants) expect(existsSync(path.join(out, v.src.replace('/images/program/galeri/', '')))).toBe(false);
    for (const v of after.variants) expect(existsSync(path.join(out, v.src.replace('/images/program/galeri/', '')))).toBe(true);
  });

  it('EXIF orientation is applied: a 400x200 file marked "rotate 90" is a 200x400 photo', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sakem-gallery-exif-'));
    try {
      await mkdir(path.join(dir, 'src', 'beta'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'beta', '1.jpg'), await jpeg(400, 200, '#336699', 6));
      const { beta } = await buildGallery({ source: path.join(dir, 'src'), out: path.join(dir, 'out') });
      expect([beta[0].width, beta[0].height]).toEqual([200, 400]);
      const meta = await sharp(path.join(dir, 'out', beta[0].variants[0].src.replace('/images/program/galeri/', ''))).metadata();
      expect([meta.width, meta.height]).toEqual([200, 400]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a missing source folder gives an empty manifest, not an error', async () => {
    expect(await buildGallery({ source: path.join(root, 'nope'), out: path.join(root, 'out-nope') })).toEqual({});
  });

  it('a file that is not a readable image fails the build and names the file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sakem-gallery-bad-'));
    try {
      await mkdir(path.join(dir, 'src', 'gamma'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'gamma', '1.jpg'), 'this is text, not a jpeg');
      await expect(buildGallery({ source: path.join(dir, 'src'), out: path.join(dir, 'out') })).rejects.toThrow(/gamma[\\/]1\.jpg/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the generated module is typed and holds exactly the manifest', async () => {
    const manifest = await buildGallery({ source, out });
    const src = manifestModule(manifest);
    expect(src).toContain("import type { GalleryManifest } from './gallery-types';");
    expect(src).toContain('export const gallery: GalleryManifest = ');
    const body = src.slice(src.indexOf('= ') + 2, src.lastIndexOf(';'));
    expect(JSON.parse(body)).toEqual(manifest);
  });
});

describe('the real manifest (src/lib/gallery.generated.ts, written by `pnpm test` before this run)', () => {
  const folder = (id: string) => path.join(repoRoot, 'public/images/program/galeri', id);
  const photosOnDisk = (id: string) => (existsSync(folder(id)) ? readdirSync(folder(id)).filter((n) => IMAGE_RE.test(n)) : []);

  it.each(programs.map((p) => p.id))('%s: one entry per photo in the repo folder, none missing, none extra', (id) => {
    const names = getProgramGallery(id).map((p) => p.name);
    expect(names.length).toBeGreaterThan(0);
    expect([...names].sort()).toEqual([...photosOnDisk(id)].sort());
  });

  it('same photos in the same order as the legacy lib/gallery.ts lists them', async () => {
    const legacy = await importRoot<{ getProgramGallery: (id: string) => Promise<{ name: string }[]> }>('lib/gallery.ts');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(repoRoot); // the legacy code reads <cwd>/public
    try {
      for (const { id } of programs) {
        const old = await legacy.getProgramGallery(id);
        expect(old.length).toBeGreaterThan(0);
        expect(getProgramGallery(id).map((p) => p.name), id).toEqual(old.map((p) => p.name));
      }
    } finally {
      cwd.mockRestore();
    }
  });

  it('every variant: a file that exists in public/, WebP, under 200 KB, width ascending, one aspect ratio', () => {
    for (const { id } of programs) {
      for (const photo of getProgramGallery(id)) {
        const widths = photo.variants.map((v) => v.width);
        expect(widths, photo.name).toEqual([...widths].sort((a, b) => a - b));
        const ratio = photo.width / photo.height;
        for (const v of photo.variants) {
          expect(v.src).toMatch(new RegExp(`^/images/program/galeri/${id}/[a-z0-9-]+\\.[0-9a-f]{8}-${v.width}\\.webp$`));
          const file = path.join(webRoot, 'public', v.src);
          expect(existsSync(file), v.src).toBe(true);
          expect(statSync(file).size, v.src).toBeLessThan(200 * 1024);
          expect(Math.abs(v.width / v.height - ratio), v.src).toBeLessThan(0.01);
        }
        expect([photo.width, photo.height]).toEqual([photo.variants.at(-1)!.width, photo.variants.at(-1)!.height]);
      }
    }
  });

  it('an id without a folder has no gallery', () => {
    expect(getProgramGallery('does-not-exist')).toEqual([]);
    expect(getProgramGallery('')).toEqual([]);
  });

  it('alt text: "Dokumentasi <program title> <position from 1>", as in the legacy page', () => {
    expect(galleryAlt('Pembelajaran Intensif', 0)).toBe('Dokumentasi Pembelajaran Intensif 1');
    expect(galleryAlt('Alumni & Beasiswa', 5)).toBe('Dokumentasi Alumni & Beasiswa 6');
    expect(readRoot('app/(public)/program/[id]/_program-content.tsx')).toContain('alt={`Dokumentasi ${program.title} ${index + 1}`}');
  });

  it('srcset lists every variant with its width descriptor', () => {
    const photo = getProgramGallery('pembinaan')[0];
    expect(gallerySrcset(photo)).toBe(photo.variants.map((v) => `${v.src} ${v.width}w`).join(', '));
    expect(gallerySrcset(photo)).toMatch(/ 480w, .* 960w$/);
  });

  it('typed: the manifest satisfies GalleryManifest', () => {
    const manifest: GalleryManifest = Object.fromEntries(programs.map((p) => [p.id, getProgramGallery(p.id)]));
    expect(Object.keys(manifest)).toHaveLength(3);
    expect(readFileSync(path.join(webRoot, 'src/lib/gallery.generated.ts'), 'utf8')).toContain('GalleryManifest');
  });
});
