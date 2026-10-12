import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../assets.config.mjs';
import { galleryAlt, getProgramGallery, gallerySrcset } from '~/lib/gallery';
import { compareNames, listImages } from '~/lib/images';
import { programs } from '~/lib/programs';
import { importRoot, readRoot, repoRoot, webRoot } from './helpers';

// The program galleries come from the image manifest the asset pipeline writes
// (scripts/build-assets.mjs; `pnpm test` runs it first). The legacy lib/gallery.ts
// read the folder at request time; the listing rules are kept, the derivatives are
// the pipeline's (tests/build-assets.test.ts covers how they are made).

/** The extensions the pipeline reads (the legacy list had avif too; the pipeline refuses it loudly). */
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

describe('listing rules (same as the legacy lib/gallery.ts)', () => {
  it('numbered files first in numeric order, other names after, alphabetically', () => {
    const names = ['10.jpg', 'b.jpg', '2.jpg', 'a.png', '1.jpg', '07.jpeg'];
    expect([...names].sort(compareNames)).toEqual(['1.jpg', '2.jpg', '07.jpeg', '10.jpg', 'a.png', 'b.jpg']);
  });

  it('listImages returns only the direct children of a folder', () => {
    expect(listImages('/images/program/galeri').length).toBe(0); // its photos are in the subfolders
    expect(listImages('/images/program/galeri/pembinaan/').length).toBeGreaterThan(0);
    expect(listImages('/images/program/galeri/pembina')).toEqual([]); // a prefix of a folder name is not the folder
    expect(listImages('/images/program').map((g) => g.name)).toContain('mentoring.jpg');
  });
});

describe('the real galleries', () => {
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

  it('every variant: a file that exists in public/, WebP by name, under 1 MiB, width ascending, one aspect ratio', () => {
    for (const { id } of programs) {
      for (const photo of getProgramGallery(id)) {
        const widths = photo.variants.map((v) => v.width);
        expect(widths, photo.name).toEqual([...widths].sort((a, b) => a - b));
        const ratio = photo.width / photo.height;
        for (const v of photo.variants) {
          expect(v.src).toMatch(new RegExp(`^/_img/[0-9a-f]{12}-${v.width}\\.webp$`));
          const file = path.join(webRoot, 'public', v.src);
          expect(existsSync(file), v.src).toBe(true);
          expect(statSync(file).size, v.src).toBeLessThan(LIMITS.imageSoftBytes);
          expect(Math.abs(v.width / v.height - ratio), v.src).toBeLessThan(0.01);
        }
        expect([photo.width, photo.height]).toEqual([photo.variants.at(-1)!.width, photo.variants.at(-1)!.height]);
      }
    }
  });

  it('an id without a folder, or that is not a plain folder name, has no gallery', () => {
    expect(getProgramGallery('does-not-exist')).toEqual([]);
    expect(getProgramGallery('')).toEqual([]);
    expect(getProgramGallery('../galeri/pembinaan')).toEqual([]);
    expect(getProgramGallery('pembinaan/1.jpg')).toEqual([]);
  });

  it('alt text: "Dokumentasi <program title> <position from 1>", as in the legacy page', () => {
    expect(galleryAlt('Pembelajaran Intensif', 0)).toBe('Dokumentasi Pembelajaran Intensif 1');
    expect(galleryAlt('Alumni & Beasiswa', 5)).toBe('Dokumentasi Alumni & Beasiswa 6');
    expect(readRoot('app/(public)/program/[id]/_program-content.tsx')).toContain('alt={`Dokumentasi ${program.title} ${index + 1}`}');
  });

  it('srcset lists every variant with its width descriptor', () => {
    const photo = getProgramGallery('pembinaan')[0];
    expect(gallerySrcset(photo)).toBe(photo.variants.map((v) => `${v.src} ${v.width}w`).join(', '));
    expect(gallerySrcset(photo)).toMatch(/ 480w, .* 1600w$/);
  });
});
