import { describe, expect, it } from 'vitest';
import { SAMPLE_RESOURCES } from '../scripts/fixture-api.mjs';
import {
  RESOURCES_PATH,
  RESOURCE_CATEGORY_DESCRIPTION,
  RESOURCE_CATEGORY_LABEL,
  RESOURCE_CATEGORY_ORDER,
  RESOURCE_CONTENT_TYPES,
  groupResourcesByCategory,
  loadResources,
  parseResourcesPayload,
  type Resource,
} from '~/lib/resources';
import { fakeCache, hangingFetch, okFetch, statusFetch } from './fake-cache';
import { importRoot, readRoot } from './helpers';

const raw = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `id-${n}`,
  title: `Dokumen ${n}`,
  description: null,
  category: 'panduan',
  contentType: 'file',
  filePath: `/resources/dokumen-${n}.pdf`,
  fileSize: 2048,
  externalUrl: null,
  bodyText: null,
  ...extra,
});
const rawUrl = (n: number, extra: Record<string, unknown> = {}) =>
  raw(n, { contentType: 'url', filePath: null, fileSize: null, externalUrl: `https://example.org/${n}`, ...extra });
const rawText = (n: number, extra: Record<string, unknown> = {}) =>
  raw(n, { contentType: 'text', filePath: null, fileSize: null, bodyText: `Teks ${n}\nBaris kedua`, ...extra });

describe('parseResourcesPayload', () => {
  it('reads the three shapes and keeps every field of the contract', () => {
    const list = parseResourcesPayload({ resources: [raw(1, { description: 'Ringkas.' }), rawUrl(2), rawText(3)] })!;
    expect(list).toEqual<Resource[]>([
      { id: 'id-1', title: 'Dokumen 1', description: 'Ringkas.', category: 'panduan', contentType: 'file', filePath: '/resources/dokumen-1.pdf', fileSize: 2048, externalUrl: null, bodyText: null },
      { id: 'id-2', title: 'Dokumen 2', description: null, category: 'panduan', contentType: 'url', filePath: null, fileSize: null, externalUrl: 'https://example.org/2', bodyText: null },
      { id: 'id-3', title: 'Dokumen 3', description: null, category: 'panduan', contentType: 'text', filePath: null, fileSize: null, externalUrl: null, bodyText: 'Teks 3\nBaris kedua' },
    ]);
    expect(parseResourcesPayload([raw(1)])).toHaveLength(1); // a bare array too
    expect(parseResourcesPayload({ resources: [] })).toEqual([]);
  });

  it('drops an entry with no id, title, known category or known content type; keeps the rest', () => {
    const list = parseResourcesPayload({
      resources: [raw(1), null, 7, raw(2, { id: null }), raw(3, { title: '' }), raw(4, { category: 'alien' }), raw(5, { contentType: 'video' }), raw(6)],
    });
    expect(list?.map((r) => r.id)).toEqual(['id-1', 'id-6']);
  });

  it('a link that is not safe is nulled: the card stays, without its action (as the legacy card does for a missing value)', () => {
    const [file, url, text] = parseResourcesPayload([
      raw(1, { filePath: 'javascript:alert(1)' }),
      rawUrl(2, { externalUrl: 'javascript:alert(1)' }),
      rawText(3, { bodyText: '   ' }),
    ])!;
    expect(file.filePath).toBeNull();
    expect(url.externalUrl).toBeNull();
    expect(text.bodyText).toBeNull();
    expect([file, url, text].map((r) => r.contentType)).toEqual(['file', 'url', 'text']);
  });

  it('a missing, zero or invalid size hides the size (the legacy page tests it for truthiness)', () => {
    const sizes = parseResourcesPayload([raw(1, { fileSize: null }), raw(2, { fileSize: 0 }), raw(3, { fileSize: -5 }), raw(4, { fileSize: '10' }), raw(5, { fileSize: Number.NaN }), raw(6, { fileSize: 902144 })])!.map((r) => r.fileSize);
    expect(sizes).toEqual([null, null, null, null, null, 902144]);
  });

  it('text is kept as the admin wrote it (line breaks and spaces inside), only a blank text is dropped', () => {
    const [r] = parseResourcesPayload([rawText(1, { bodyText: '  Halo!\n\n#SakolaKembara  ' })])!;
    expect(r.bodyText).toBe('  Halo!\n\n#SakolaKembara  ');
  });

  it('not a list at all: null', () => {
    for (const bad of [{ resources: {} }, { resources: 'x' }, { other: [] }, 'x', null, undefined]) expect(parseResourcesPayload(bad)).toBeNull();
  });
});

describe('groupResourcesByCategory', () => {
  const at = (n: number, category: string) => parseResourcesPayload([raw(n, { category })])![0];

  it('puts the categories in the canonical order whatever order they arrive in, and omits the empty ones', () => {
    const groups = groupResourcesByCategory([at(1, 'lainnya'), at(2, 'panduan'), at(3, 'tutorial')]);
    expect(groups.map((g) => g.category)).toEqual(['panduan', 'tutorial', 'lainnya']);
  });

  it('keeps the payload order inside a category (the admin\'s manual order)', () => {
    const groups = groupResourcesByCategory([at(1, 'tutorial'), at(2, 'panduan'), at(3, 'tutorial'), at(4, 'tutorial')]);
    expect(groups.find((g) => g.category === 'tutorial')?.items.map((r) => r.id)).toEqual(['id-1', 'id-3', 'id-4']);
  });

  it('nothing in, no groups (the empty state)', () => {
    expect(groupResourcesByCategory([])).toEqual([]);
  });

  it('is the grouping of the root getResourcesByCategory (canonical order, empty categories omitted)', () => {
    const src = readRoot('lib/site-resources.ts');
    expect(src).toContain('RESOURCE_CATEGORY_ORDER.filter(');
    expect(src).toContain('(map.get(cat)?.length ?? 0) > 0');
  });
});

describe('categories are the root ones, and so are the anchors', async () => {
  const root = await importRoot<{
    RESOURCE_CATEGORY_ORDER: string[];
    RESOURCE_CATEGORY_LABEL: Record<string, string>;
    RESOURCE_CATEGORY_DESCRIPTION: Record<string, string>;
  }>('lib/site-resources-config.ts');

  it('same order, labels and descriptions as lib/site-resources-config.ts', () => {
    expect([...RESOURCE_CATEGORY_ORDER]).toEqual(root.RESOURCE_CATEGORY_ORDER);
    expect(RESOURCE_CATEGORY_LABEL).toEqual(root.RESOURCE_CATEGORY_LABEL);
    expect(RESOURCE_CATEGORY_DESCRIPTION).toEqual(root.RESOURCE_CATEGORY_DESCRIPTION);
  });

  it('the five anchors the wizard and the admin link to', () => {
    expect([...RESOURCE_CATEGORY_ORDER]).toEqual(['panduan', 'berkas-pendaftaran', 'berkas-marketing', 'tutorial', 'lainnya']);
  });

  it('the database enums match (categories and content types)', () => {
    const schema = readRoot('lib/db/schema/site-resources.ts');
    expect(schema).toContain(`resourceCategory = [\n${RESOURCE_CATEGORY_ORDER.map((c) => `  "${c}",\n`).join('')}] as const`);
    expect(schema).toContain(`resourceContentType = [${RESOURCE_CONTENT_TYPES.map((c) => `"${c}"`).join(', ')}] as const`);
  });
});

describe('the contract and the fixture', () => {
  it('the example of docs/cloudflare/content-api.md parses without losing a field', () => {
    const doc = readRoot('docs/cloudflare/content-api.md');
    const example = doc.match(/### `GET \/api\/public\/resources`[\s\S]*?```json\n([\s\S]*?)```/)?.[1];
    expect(example, 'the resources example is in the contract').toBeDefined();
    const payload = JSON.parse(example!);
    expect(parseResourcesPayload(payload)).toEqual(payload.resources);
  });

  it('every fixture resource parses (none dropped); all five categories and all three types are there', () => {
    const list = parseResourcesPayload({ resources: SAMPLE_RESOURCES })!;
    expect(list).toHaveLength(SAMPLE_RESOURCES.length);
    expect(new Set(list.map((r) => r.category))).toEqual(new Set(RESOURCE_CATEGORY_ORDER));
    expect(new Set(list.map((r) => r.contentType))).toEqual(new Set(RESOURCE_CONTENT_TYPES));
  });

  it('the fixture is flattened in the page order, so grouping it changes nothing', () => {
    const list = parseResourcesPayload({ resources: SAMPLE_RESOURCES })!;
    expect(groupResourcesByCategory(list).flatMap((g) => g.items.map((r) => r.id))).toEqual(list.map((r) => r.id));
  });

  it('each fixture entry sets exactly the field of its type, and nothing private', () => {
    for (const r of SAMPLE_RESOURCES) {
      const set = (['filePath', 'externalUrl', 'bodyText'] as const).filter((k) => r[k] !== null);
      expect(set, r.title).toEqual([{ file: 'filePath', url: 'externalUrl', text: 'bodyText' }[r.contentType as 'file' | 'url' | 'text']]);
      expect(Object.keys(r).sort()).toEqual(['bodyText', 'category', 'contentType', 'description', 'externalUrl', 'filePath', 'fileSize', 'id', 'title'].sort());
    }
  });
});

describe('loadResources', () => {
  const payload = { resources: [raw(1), rawText(2, { category: 'lainnya' })] };

  it(`asks ${RESOURCES_PATH} and returns the resources with the source`, async () => {
    const { fetchImpl, calls } = okFetch(payload);
    const r = await loadResources({ baseUrl: 'http://api.test', fetchImpl });
    expect(calls).toEqual([`http://api.test${RESOURCES_PATH}`]);
    expect(r.source).toBe('network');
    expect(r.resources?.map((x) => x.id)).toEqual(['id-1', 'id-2']);
  });

  it('cache inside the fresh window, the stale copy when the API fails, null when there is nothing', async () => {
    let t = 0;
    const cache = fakeCache(() => t);
    expect((await loadResources({ baseUrl: 'http://api.test', cache, fetchImpl: okFetch(payload).fetchImpl })).source).toBe('network');
    expect((await loadResources({ baseUrl: 'http://api.test', cache, fetchImpl: statusFetch(500) })).source).toBe('cache');
    t += 61_000;
    const stale = await loadResources({ baseUrl: 'http://api.test', cache, fetchImpl: statusFetch(500) });
    expect(stale.source).toBe('stale');
    expect(stale.resources).toHaveLength(2);
    expect(await loadResources({ baseUrl: 'http://api.test', cache: fakeCache(() => 0), fetchImpl: statusFetch(502) })).toEqual({ resources: null, source: 'empty' });
  });

  it('a hanging API on a cold cache gives null after the timeout, never a throw', async () => {
    expect(await loadResources({ baseUrl: 'http://api.test', fetchImpl: hangingFetch, timeoutMs: 30 })).toEqual({ resources: null, source: 'empty' });
  });

  it('an empty catalog is a real answer: [] from the network, not null', async () => {
    expect(await loadResources({ baseUrl: 'http://api.test', fetchImpl: okFetch({ resources: [] }).fetchImpl })).toEqual({ resources: [], source: 'network' });
  });
});
