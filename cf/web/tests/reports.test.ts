import { describe, expect, it } from 'vitest';
import { SAMPLE_REPORTS } from '../scripts/fixture-api.mjs';
import {
  REPORTS_PATH,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABEL,
  REPORT_CATEGORY_TONE,
  formatAcademicYear,
  formatBytes,
  groupReportsByYear,
  loadReports,
  loadReportsSection,
  parseReportsPayload,
  type Report,
} from '~/lib/reports';
import { type ContentSource, contentPageHeaders, contentSectionHeaders } from '~/lib/content-api';
import { tagClasses } from '~/lib/ui';
import { fakeCache, hangingFetch, okFetch, statusFetch } from './fake-cache';
import { importRoot, readRoot } from './helpers';

const raw = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `id-${n}`,
  title: `Laporan ${n}`,
  description: null,
  category: 'yearly',
  year: '2025',
  filePath: `/reports/2025/yearly/laporan-${n}.pdf`,
  fileSize: 1024 * n,
  ...extra,
});

describe('parseReportsPayload', () => {
  it('reads { reports: [...] } and a bare array, and keeps every field of the contract', () => {
    const entry = raw(1, { description: 'Ringkasan.', category: 'impact', year: '2025/2026' });
    const expected: Report = { id: 'id-1', title: 'Laporan 1', description: 'Ringkasan.', category: 'impact', year: '2025/2026', filePath: '/reports/2025/yearly/laporan-1.pdf', fileSize: 1024 };
    expect(parseReportsPayload({ reports: [entry] })).toEqual([expected]);
    expect(parseReportsPayload([entry])).toEqual([expected]);
    expect(parseReportsPayload({ reports: [] })).toEqual([]);
  });

  it('drops a malformed entry and keeps the rest (the input crosses a network)', () => {
    const list = parseReportsPayload({
      reports: [
        raw(1),
        null,
        'x',
        raw(2, { id: '' }),
        raw(3, { title: '  ' }),
        raw(4, { year: null }),
        raw(5, { category: 'alien' }),
        raw(6, { filePath: null }),
        raw(7, { filePath: 'javascript:alert(1)' }),
        raw(8, { fileSize: '10' }),
        raw(9, { fileSize: -1 }),
        raw(10, { fileSize: Number.NaN }),
        raw(11),
      ],
    });
    expect(list?.map((r) => r.id)).toEqual(['id-1', 'id-11']);
  });

  it('a description may be null or blank, a file may be absolute or empty-size', () => {
    const [a, b] = parseReportsPayload([raw(1, { description: '   ' }), raw(2, { filePath: 'https://files.example.org/a.pdf', fileSize: 0 })])!;
    expect(a.description).toBeNull();
    expect(b.filePath).toBe('https://files.example.org/a.pdf');
    expect(b.fileSize).toBe(0);
  });

  it('not a list at all: null (an API failure, not an empty page)', () => {
    for (const bad of [{ reports: {} }, { reports: 'x' }, { other: [] }, 'x', null, undefined, 4]) expect(parseReportsPayload(bad)).toBeNull();
  });
});

describe('groupReportsByYear', () => {
  const at = (n: number, year: string) => parseReportsPayload([raw(n, { year })])![0];

  it('newest year first, compared as strings: "2025/2026" above "2025" above "2024/2025" above "2024"', () => {
    const groups = groupReportsByYear([at(1, '2024'), at(2, '2025'), at(3, '2024/2025'), at(4, '2025/2026')]);
    expect(groups.map((g) => g.year)).toEqual(['2025/2026', '2025', '2024/2025', '2024']);
  });

  it('keeps the payload order inside a year (newest upload first, as the API sorts it) and does not reorder equal years', () => {
    const groups = groupReportsByYear([at(1, '2025'), at(2, '2024'), at(3, '2025'), at(4, '2025'), at(5, '2024')]);
    expect(groups).toHaveLength(2);
    expect(groups[0].reports.map((r) => r.id)).toEqual(['id-1', 'id-3', 'id-4']);
    expect(groups[1].reports.map((r) => r.id)).toEqual(['id-2', 'id-5']);
  });

  it('is the grouping of the root getReportsByYear for the same rows', () => {
    const src = readRoot('lib/reports.ts');
    expect(src).toContain('.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))');
    expect(src).toContain('byYear.get(r.year)!.push(r)');
  });

  it('no reports: no groups', () => {
    expect(groupReportsByYear([])).toEqual([]);
  });
});

describe('display helpers match the root lib/report-types.ts', async () => {
  const root = await importRoot<{
    formatBytes: (n: number) => string;
    formatAcademicYear: (y: string) => string;
    REPORT_CATEGORY_LABEL: Record<string, string>;
    REPORT_CATEGORY_TONE: Record<string, string>;
  }>('lib/report-types.ts');

  it.each([0, 1, 1023, 1024, 1536, 87040, 512000, 1048575, 1048576, 1843200, 3145728, 25 * 1024 * 1024])('formatBytes(%d)', (n) => {
    expect(formatBytes(n)).toBe(root.formatBytes(n));
  });

  it.each(['2025', '2025/2026', '2018'])('formatAcademicYear(%s)', (y) => {
    expect(formatAcademicYear(y)).toBe(root.formatAcademicYear(y));
  });

  it('formatBytes reads like the legacy page: "PDF · 1.8 MB", "500 KB", "85 KB"', () => {
    expect([1843200, 512000, 87040, 800].map(formatBytes)).toEqual(['1.8 MB', '500 KB', '85 KB', '800 B']);
  });

  it('categories, labels and tones are the root ones, in the same order as the database enum', () => {
    expect(REPORT_CATEGORY_LABEL).toEqual(root.REPORT_CATEGORY_LABEL);
    expect(REPORT_CATEGORY_TONE).toEqual(root.REPORT_CATEGORY_TONE);
    expect(readRoot('lib/db/schema/reports.ts')).toContain(`reportCategory = [${REPORT_CATEGORIES.map((c) => `"${c}"`).join(', ')}] as const`);
  });

  it('every tone has the legacy Tag classes (a hue with a 200 border, a 50 fill and a 700 text)', () => {
    for (const tone of Object.values(REPORT_CATEGORY_TONE)) {
      expect(tagClasses('sm', undefined, tone)).toMatch(/border border-\w+-200 bg-\w+-50 text-\w+-700 px-2\.5 py-1$/);
    }
  });
});

describe('the contract and the fixture', () => {
  it('the example of docs/cloudflare/content-api.md parses without losing a field', () => {
    const doc = readRoot('docs/cloudflare/content-api.md');
    const example = doc.match(/### `GET \/api\/public\/reports`[\s\S]*?```json\n([\s\S]*?)```/)?.[1];
    expect(example, 'the reports example is in the contract').toBeDefined();
    const payload = JSON.parse(example!);
    expect(parseReportsPayload(payload)).toEqual(payload.reports);
  });

  it('every fixture report parses (none dropped), and the fixture lists them in display order', () => {
    expect(parseReportsPayload({ reports: SAMPLE_REPORTS })).toHaveLength(SAMPLE_REPORTS.length);
    const grouped = groupReportsByYear(parseReportsPayload({ reports: SAMPLE_REPORTS })!);
    expect(grouped.flatMap((g) => g.reports.map((r) => r.id))).toEqual(SAMPLE_REPORTS.map((r) => r.id));
    expect(grouped.map((g) => g.year)).toEqual(['2025/2026', '2025', '2024/2025', '2024']);
    expect(new Set(SAMPLE_REPORTS.map((r) => r.category))).toEqual(new Set(REPORT_CATEGORIES));
  });

  it('the fixture exposes nothing the contract keeps private', () => {
    for (const r of SAMPLE_REPORTS) expect(Object.keys(r).sort()).toEqual(['category', 'description', 'fileSize', 'filePath', 'id', 'title', 'year'].sort());
  });
});

describe('loadReports', () => {
  const payload = { reports: [raw(1), raw(2, { year: '2024' })] };

  it(`asks ${REPORTS_PATH} and returns the reports with the source`, async () => {
    const { fetchImpl, calls } = okFetch(payload);
    const r = await loadReports({ baseUrl: 'http://api.test', fetchImpl });
    expect(calls).toEqual([`http://api.test${REPORTS_PATH}`]);
    expect(r.source).toBe('network');
    expect(r.reports?.map((x) => x.id)).toEqual(['id-1', 'id-2']);
  });

  it('serves from the cache inside the fresh window, then the stale copy when the API fails (200 path), then null when there is nothing', async () => {
    let t = 0;
    const cache = fakeCache(() => t);
    expect((await loadReports({ baseUrl: 'http://api.test', cache, fetchImpl: okFetch(payload).fetchImpl })).source).toBe('network');
    expect((await loadReports({ baseUrl: 'http://api.test', cache, fetchImpl: statusFetch(500) })).source).toBe('cache');
    t += 61_000;
    const stale = await loadReports({ baseUrl: 'http://api.test', cache, fetchImpl: statusFetch(500) });
    expect(stale.source).toBe('stale');
    expect(stale.reports).toHaveLength(2);
    const cold = await loadReports({ baseUrl: 'http://api.test', cache: fakeCache(() => 0), fetchImpl: statusFetch(503) });
    expect(cold).toEqual({ reports: null, source: 'empty' });
  });

  it('a hanging API on a cold cache gives null reports after the timeout, never a throw', async () => {
    expect(await loadReports({ baseUrl: 'http://api.test', fetchImpl: hangingFetch, timeoutMs: 30 })).toEqual({ reports: null, source: 'empty' });
  });

  it('an empty list is a real answer: [] from the network, not null', async () => {
    expect(await loadReports({ baseUrl: 'http://api.test', fetchImpl: okFetch({ reports: [] }).fetchImpl })).toEqual({ reports: [], source: 'network' });
  });

  it('without CONTENT_API_URL there is nothing to show (null)', async () => {
    expect(await loadReports({ baseUrl: undefined })).toEqual({ reports: null, source: 'empty' });
  });
});

// SAKEM-105: the reports are a section of /donasi, and /donasi must NEVER fail because of them.
describe('loadReportsSection: the data of the Laporan section of /donasi, which never throws', () => {
  const payload = { reports: [raw(1), raw(2, { year: '2024' }), raw(3)] };

  it('loads, groups by year (newest first) and counts', async () => {
    const section = await loadReportsSection(() => ({ baseUrl: 'http://api.test', fetchImpl: okFetch(payload).fetchImpl }));
    expect(section.source).toBe('network');
    expect(section.total).toBe(3);
    expect(section.years.map((y) => [y.year, y.reports.map((r) => r.id)])).toEqual([
      ['2025', ['id-1', 'id-3']],
      ['2024', ['id-2']],
    ]);
    expect(section.reports?.map((r) => r.id)).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('an empty list is a real answer (the legacy empty state), not a failure', async () => {
    const section = await loadReportsSection(() => ({ baseUrl: 'http://api.test', fetchImpl: okFetch({ reports: [] }).fetchImpl }));
    expect(section).toEqual({ reports: [], source: 'network', years: [], total: 0 });
  });

  it('the API cannot answer and nothing is cached: reports null (the failure panel), no years, no throw', async () => {
    const cold = await loadReportsSection(() => ({ baseUrl: 'http://api.test', cache: fakeCache(() => 0), fetchImpl: statusFetch(503) }));
    expect(cold).toEqual({ reports: null, source: 'empty', years: [], total: 0 });
    const hanging = await loadReportsSection(() => ({ baseUrl: 'http://api.test', fetchImpl: hangingFetch, timeoutMs: 30 }));
    expect(hanging.reports).toBeNull();
    expect((await loadReportsSection(() => ({ baseUrl: undefined }))).reports).toBeNull();
  });

  it('the last good copy is shown while the API is down (stale), so the section survives an outage', async () => {
    let t = 0;
    const cache = fakeCache(() => t);
    await loadReportsSection(() => ({ baseUrl: 'http://api.test', cache, fetchImpl: okFetch(payload).fetchImpl }));
    t += 61_000;
    const stale = await loadReportsSection(() => ({ baseUrl: 'http://api.test', cache, fetchImpl: statusFetch(500) }));
    expect(stale.source).toBe('stale');
    expect(stale.total).toBe(3);
  });

  it('a runtime that cannot be built, or a loader that throws, is the same as an API with nothing to show: the page does not fail', async () => {
    const noRuntime = await loadReportsSection(() => {
      throw new Error('no binding');
    });
    expect(noRuntime).toEqual({ reports: null, source: 'empty', years: [], total: 0 });
    const brokenCache = {
      match: () => {
        throw new Error('cache exploded');
      },
      put: () => Promise.reject(new Error('cache exploded')),
    } as never;
    const fetchFails = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    expect((await loadReportsSection(() => ({ baseUrl: 'http://api.test', cache: brokenCache, fetchImpl: fetchFails }))).reports).toBeNull();
  });

  it('a failure is told to the Worker log in fixed words (never a URL or a body)', async () => {
    const reasons: string[] = [];
    await loadReportsSection(() => ({ baseUrl: 'http://api.test', fetchImpl: statusFetch(500), onFailure: (r) => reasons.push(r) }));
    expect(reasons).toEqual(['status 500']);
  });
});

describe('contentSectionHeaders: a page that carries a list never fails because of it (SAKEM-105), unlike the page that is the list', () => {
  const all: ContentSource[] = ['network', 'cache', 'stale', 'empty', 'not_found'];

  it('always a 200, whatever the source: only the section says the list is missing', () => {
    for (const source of all) expect(contentSectionHeaders(source).status, source).toBe(200);
  });

  it('fresh data has the list pages\' freshness; stale data a short one; nothing at all is no-store, with no Retry-After', () => {
    const fresh = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
    expect(contentSectionHeaders('network').headers).toEqual({ 'cache-control': fresh });
    expect(contentSectionHeaders('cache').headers).toEqual({ 'cache-control': fresh });
    expect(contentSectionHeaders('stale').headers).toEqual({ 'cache-control': 'public, max-age=0, s-maxage=30' });
    for (const source of ['empty', 'not_found'] as const) expect(contentSectionHeaders(source).headers, source).toEqual({ 'cache-control': 'no-store' });
  });

  it('the cache-control of every source is the one of the page that IS the list, except where that page fails: there a 503 becomes a 200 no-store', () => {
    for (const source of ['network', 'cache', 'stale'] as const) {
      expect(contentSectionHeaders(source), source).toEqual({ status: 200, headers: contentPageHeaders(source).headers });
    }
    expect(contentPageHeaders('empty').status).toBe(503);
    expect(contentSectionHeaders('empty').status).toBe(200);
  });
});
