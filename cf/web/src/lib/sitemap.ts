// sitemap.xml and robots.txt text, in the exact shape Next's
// app/sitemap.ts and app/robots.ts produce (same fields, same disallow list).

import { programs } from './programs';
import { SITE_URL } from './seo';

export interface SitemapEntry {
  url: string;
  /** ISO date or datetime. Omitted when there is no real modification date. */
  lastModified?: string;
  changeFrequency: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
  /** Used only while building entries. */
  path?: string;
}

/** Static routes of the sitemap, same list, priorities and frequencies as the root app/sitemap.ts. */
export const STATIC_ROUTES: { path: string; priority: number; changeFrequency: SitemapEntry['changeFrequency'] }[] = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/blog', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/donasi', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/gabung-siswa', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/tim', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/kontak', priority: 0.7, changeFrequency: 'yearly' },
];

/**
 * The sitemap entries of the blog articles: each with its real date (`modifiedISO` when the API sends it on list entries,
 * else the publication date). An article the editor hid from search (SAKEM-109, `noindex: true`) is left out: it is
 * published, but not offered to crawlers.
 */
export function blogSitemapEntries(articles: readonly { slug: string; dateISO: string; modifiedISO?: string; noindex?: true }[]): SitemapEntry[] {
  return articles
    .filter((article) => article.noindex !== true)
    .map((article) => ({ url: `${SITE_URL}/blog/${article.slug}`, lastModified: article.modifiedISO || article.dateISO, priority: 0.6, changeFrequency: 'monthly' }));
}

/** Program pages (/program/<id>), the ids the page is generated for. */
export const PROGRAM_IDS = programs.map((p) => p.id);

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** W3C datetime. A bare date ("2026-05-21") is kept as is; a full timestamp is normalized to ISO. */
function lastmod(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

export function buildSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) =>
      [
        '<url>',
        `<loc>${escapeXml(e.url)}</loc>`,
        e.lastModified ? `<lastmod>${lastmod(e.lastModified)}</lastmod>` : null,
        `<changefreq>${e.changeFrequency}</changefreq>`,
        `<priority>${e.priority}</priority>`,
        '</url>',
      ]
        .filter(Boolean)
        .join(''),
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** The rules of the root app/robots.ts (allow all, disallow /admin /api /login) plus /portal: the student portal is not for search engines. */
export const ROBOTS_DISALLOW = ['/admin', '/api', '/login', '/portal'];

export function buildRobotsTxt(): string {
  return [
    'User-Agent: *',
    'Allow: /',
    ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`),
    '',
    `Host: ${SITE_URL}`,
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');
}
