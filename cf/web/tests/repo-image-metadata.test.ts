import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findGpsMetadata } from '../../../scripts/lib/image-gps.mjs';
import { stripJpegMetadata } from '../../../scripts/lib/strip-jpeg-metadata.mjs';
import { repoRoot } from './helpers';
import { GPS_XMP, baseJpeg, basePng, exifChunkData, exifSegment, multiPicture, pngWithChunk, withSegments, xmpSegment } from './jpeg-fixtures';

// SAKEM-099: no image of this PUBLIC repository carries GPS metadata. The sources under public/ are what the
// asset pipeline reads (the files the site serves are re-encoded without metadata, but the repository is public
// too). The test reads the real files, by their content (a few ".jpg" files are PNG data), and takes well under
// a second. When it fails: `pnpm images:strip-metadata` at the repository root strips a JPEG without re-encoding it.

/** What is looked at: images by extension, and the PDFs and SVGs that can embed one or carry XMP. */
const CANDIDATE = /\.(jpe?g|jpe|jfif|png|webp|gif|avif|heic|heif|tiff?|pdf|svg)$/i;
/** Never walked by the fallback listing: dependencies, build output, and the asset pipeline's generated copies. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.next', '.astro', '.wrangler', '.claude', 'dist', 'coverage', 'storybook-static']);

/** What the version control lists as part of the repository: tracked files, plus untracked ones that are not ignored. Null when it cannot answer. */
function trackedFiles(root: string): string[] | null {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString('utf8').split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/** Every file under `root` except the usual generated places (no version control needed). */
function walkFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name) && rel !== 'cf/web/public') walk(full);
      } else found.push(rel);
    }
  };
  walk(root);
  return found;
}

/** Paths (relative, "/"-separated) of the files of the repository: as the index lists them when it can, else by walking the folder (a source archive, a container without git). */
const listRepoFiles = (root: string): string[] => trackedFiles(root) ?? walkFiles(root);

interface Offender {
  file: string;
  format: string;
  hits: string[];
}

/** The files among `files` (relative to `root`) that carry GPS metadata. A file listed but gone from disk is skipped. */
function findOffenders(root: string, files: string[]): { scanned: string[]; offenders: Offender[] } {
  const scanned: string[] = [];
  const offenders: Offender[] = [];
  for (const file of files) {
    if (!CANDIDATE.test(file)) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(root, file));
    } catch {
      continue; // listed by the index but deleted in the working tree
    }
    scanned.push(file);
    const { format, hits } = findGpsMetadata(bytes);
    if (hits.length > 0) offenders.push({ file, format, hits });
  }
  return { scanned, offenders };
}

describe('the repository carries no GPS metadata in its images (SAKEM-099)', () => {
  it('has none in any image, PDF or SVG of the repository', () => {
    const { scanned, offenders } = findOffenders(repoRoot, listRepoFiles(repoRoot));

    // the sweep must have looked at the real thing: the blog sources and the other photos
    expect(scanned.filter((f) => f.startsWith('public/blog/images/') && /\.jpe?g$/i.test(f)).length).toBeGreaterThan(150);
    expect(scanned.filter((f) => f.startsWith('public/images/') && /\.jpe?g$/i.test(f)).length).toBeGreaterThan(20);
    expect(scanned).toContain('public/og-default.jpg');

    expect(
      offenders.map((o) => `${o.file} (${o.format}): ${o.hits[0]}`),
      `${offenders.length} file(s) carry GPS metadata. Run \`pnpm images:strip-metadata\` at the repository root (it strips JPEGs without re-encoding), or remove it from other formats with another tool.`,
    ).toEqual([]);
  });

  describe('and it does fail when one is added (the same functions, on a scratch folder)', () => {
    let dir: string;
    const put = (rel: string, bytes: Buffer) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), bytes);
    };
    const sweep = () => findOffenders(dir, walkFiles(dir));

    beforeAll(async () => {
      dir = mkdtempSync(path.join(tmpdir(), 'sakem-sweep-'));
      const clean = await baseJpeg();
      put('public/blog/images/2026/10/clean.jpg', clean);
      put('public/blog/images/2026/10/with-exif-only.jpg', withSegments(clean, exifSegment({ make: 'TestPhone', orientation: 1 })));
      put('public/blog/images/2026/10/with-gps.jpg', withSegments(clean, exifSegment({ make: 'TestPhone', gps: true })));
      put('public/images/with-gps-in-xmp.jpeg', withSegments(clean, xmpSegment(GPS_XMP)));
      put('public/images/png-data-named-jpg.jpg', pngWithChunk(await basePng(), 'eXIf', exifChunkData({ gps: true })));
      put('public/images/second-image-has-gps.jpg', multiPicture(clean, withSegments(await baseJpeg({ width: 8, height: 6 }), exifSegment({ gps: true }))));
      put('docs/not-an-image.txt', withSegments(clean, exifSegment({ gps: true }))); // not a candidate by extension
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('names exactly the files that carry GPS, whatever their extension or where in the file it sits', () => {
      const { scanned, offenders } = sweep();
      expect(scanned).toHaveLength(6);
      expect(offenders.map((o) => o.file).sort()).toEqual([
        'public/blog/images/2026/10/with-gps.jpg',
        'public/images/png-data-named-jpg.jpg',
        'public/images/second-image-has-gps.jpg',
        'public/images/with-gps-in-xmp.jpeg',
      ]);
      expect(offenders.find((o) => o.file.endsWith('png-data-named-jpg.jpg'))?.format).toBe('png');
    });

    it('stops naming a JPEG once it is stripped', () => {
      const file = 'public/blog/images/2026/10/with-gps.jpg';
      const stripped = stripJpegMetadata(readFileSync(path.join(dir, file)));
      expect(stripped.changed).toBe(true);
      writeFileSync(path.join(dir, file), stripped.data);
      expect(sweep().offenders.map((o) => o.file)).not.toContain(file);
    });

    it('lists the untracked files that are not ignored, and skips the ignored ones, in a repository', () => {
      const repo = mkdtempSync(path.join(tmpdir(), 'sakem-sweep-repo-'));
      try {
        try {
          execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        } catch {
          return; // no git on this machine: the walk below is what runs
        }
        mkdirSync(path.join(repo, 'public/blog/images'), { recursive: true });
        mkdirSync(path.join(repo, 'generated'), { recursive: true });
        writeFileSync(path.join(repo, '.gitignore'), '/generated/\n');
        writeFileSync(path.join(repo, 'public/blog/images/new.jpg'), 'x');
        writeFileSync(path.join(repo, 'generated/derived.jpg'), 'x');
        expect(trackedFiles(repo)?.sort()).toEqual(['.gitignore', 'public/blog/images/new.jpg']);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('walks the folder when there is no repository, skipping dependencies and the generated copies of cf/web', () => {
      const plain = mkdtempSync(path.join(tmpdir(), 'sakem-sweep-plain-'));
      try {
        mkdirSync(path.join(plain, 'node_modules/x'), { recursive: true });
        mkdirSync(path.join(plain, 'cf/web/public/_img'), { recursive: true });
        mkdirSync(path.join(plain, 'public'), { recursive: true });
        writeFileSync(path.join(plain, 'node_modules/x/a.jpg'), 'x');
        writeFileSync(path.join(plain, 'cf/web/public/_img/a.webp'), 'x');
        writeFileSync(path.join(plain, 'public/a.jpg'), 'x');
        expect(walkFiles(plain)).toEqual(['public/a.jpg']);
        expect(existsSync(path.join(plain, '.git'))).toBe(false);
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }
    });
  });
});
