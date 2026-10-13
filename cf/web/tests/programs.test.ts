import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { programCards } from '~/lib/site';
import { PROGRAM_IDS } from '~/lib/sitemap';
import { SITE_URL, buildSeo, jsonLdScript } from '~/lib/seo';
import { programSeo, programs } from '~/lib/programs';
import { importRoot, liveTitle, readRoot, repoRoot } from './helpers';

// lib/programs.ts is a port of `programs` in the root lib/data.ts, and programSeo()
// a port of app/(public)/program/[id]/layout.tsx. Copy and head data must not drift.

interface RootProgram {
  id: string;
  title: string;
  description: string;
  points: string[];
  tag: string;
  image: unknown;
  subPrograms: { title: string; description: string; hours?: string; image?: unknown; attachment?: { label: string; href: string } }[];
}
interface RootSeo {
  buildPageMetadata: (a: { title: string; description: string; path: string; ogImage?: string }) => {
    title: { absolute: string };
    description: string;
    alternates: { canonical: string };
    openGraph: { title: string; description: string; url: string; siteName: string; locale: string; type: string; images: { url: string }[] };
    twitter: { card: string; title: string; description: string; images: { url: string }[] };
  };
  programJsonLd: (p: { id: string; title: string; description: string }) => unknown;
  jsonLdScript: (d: unknown) => string;
}

const getProgram = (id: string) => programs.find((p) => p.id === id);

describe('program data is the legacy data', async () => {
  const root = (await importRoot<{ programs: RootProgram[] }>('lib/data.ts')).programs;

  it('same three programs, same order', () => {
    expect(programs.map((p) => p.id)).toEqual(['prapembinaan', 'pembinaan', 'pasca-pembinaan']);
    expect(programs.map((p) => p.id)).toEqual(root.map((p) => p.id));
  });

  it.each(['prapembinaan', 'pembinaan', 'pasca-pembinaan'])('%s: title, description, tag and bullets are identical', (id) => {
    const ours = getProgram(id)!;
    const theirs = root.find((p) => p.id === id)!;
    expect({ title: ours.title, description: ours.description, tag: ours.tag, points: ours.points }).toEqual({
      title: theirs.title,
      description: theirs.description,
      tag: theirs.tag,
      points: theirs.points,
    });
  });

  it.each(['prapembinaan', 'pembinaan', 'pasca-pembinaan'])('%s: every activity keeps its text, hours, PDF and thumbnail', (id) => {
    const ours = getProgram(id)!.subPrograms;
    const theirs = root.find((p) => p.id === id)!.subPrograms;
    expect(ours.map((s) => ({ title: s.title, description: s.description, hours: s.hours, attachment: s.attachment }))).toEqual(
      theirs.map((s) => ({ title: s.title, description: s.description, hours: s.hours, attachment: s.attachment })),
    );
    // Same thumbnail: the legacy value is the imported file, whose name is the photo key.
    expect(ours.map((s) => s.photo ?? null)).toEqual(
      theirs.map((s) => (s.image === undefined ? null : String(s.image).match(/\/([a-z-]+)\.jpg/)?.[1] ?? null)),
    );
  });

  it('every photo key is a file in public/images/program/', () => {
    const keys = new Set(programs.flatMap((p) => [p.photo, ...p.subPrograms.flatMap((s) => (s.photo ? [s.photo] : []))]));
    expect(keys.size).toBe(7);
    for (const key of keys) expect(existsSync(`${repoRoot}public/images/program/${key}.jpg`), key).toBe(true);
  });

  it('every PDF an activity links to exists in public/files/', () => {
    for (const p of programs) {
      for (const s of p.subPrograms) if (s.attachment) expect(existsSync(`${repoRoot}public${s.attachment.href}`), s.attachment.href).toBe(true);
    }
  });

  it('the homepage cards (lib/site.ts) agree with the program pages on id, title, tag and bullets', () => {
    expect(programCards).toEqual(programs.map(({ id, title, points, tag }) => ({ id, title, points, tag })));
  });

  it('the sitemap lists the programs this page is generated for', () => {
    expect(PROGRAM_IDS).toEqual(programs.map((p) => p.id));
  });
});

describe('SEO of /program/<id> equals what the legacy layout builds', async () => {
  const rootSeo = await importRoot<RootSeo>('lib/seo.ts');
  const layout = readRoot('app/(public)/program/[id]/layout.tsx');

  it('the legacy layout still builds what this port mirrors (title, path, share image, JSON-LD)', () => {
    expect(layout).toContain('title: `Program ${program.title}`');
    expect(layout).toContain('description: program.description');
    expect(layout).toContain('path: `/program/${id}`');
    expect(layout).toContain('ogImage: program.image.src');
    expect(layout).toContain('jsonLdScript(programJsonLd(program))');
  });

  it.each(programs.map((p) => p.id))('%s: title, description, canonical, Open Graph and Twitter match buildPageMetadata()', (id) => {
    const p = getProgram(id)!;
    const image = '/_astro/photo.abc123.jpeg';
    const ours = buildSeo(programSeo(p, image).seo);
    const theirs = rootSeo.buildPageMetadata({ title: `Program ${p.title}`, description: p.description, path: `/program/${id}`, ogImage: image });

    expect(ours.title).toBe(liveTitle(theirs.title.absolute)); // the suffix is the live pattern since SAKEM-090
    expect(ours.title).toBe(`Program ${p.title} - Yayasan Sakola Kembara Indonesia`);
    expect(ours.description).toBe(theirs.description);
    expect(ours.canonical).toBe(`${SITE_URL}${theirs.alternates.canonical}`);
    expect(ours.og).toMatchObject({
      title: theirs.openGraph.title,
      description: theirs.openGraph.description,
      url: `${SITE_URL}${theirs.openGraph.url}`,
      siteName: theirs.openGraph.siteName,
      locale: theirs.openGraph.locale,
      type: theirs.openGraph.type,
    });
    expect(ours.og.image.url).toBe(`${SITE_URL}${theirs.openGraph.images[0].url}`);
    expect(ours.twitter).toEqual({
      card: theirs.twitter.card,
      title: theirs.twitter.title,
      description: theirs.twitter.description,
      image: `${SITE_URL}${theirs.twitter.images[0].url}`,
    });
    expect(ours.robots).toBe('index, follow');
  });

  it.each(programs.map((p) => p.id))('%s: Program JSON-LD is identical to the root programJsonLd()', (id) => {
    const p = getProgram(id)!;
    const { jsonLd } = programSeo(p, '/x.jpeg');
    expect(jsonLd).toEqual([rootSeo.programJsonLd(p)]);
    expect(jsonLdScript(jsonLd[0])).toBe(rootSeo.jsonLdScript(rootSeo.programJsonLd(p)));
  });
});
