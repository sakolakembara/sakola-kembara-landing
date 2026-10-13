import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const webRoot = fileURLToPath(new URL('..', import.meta.url));
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Read a file of the legacy app (read only). */
export const readRoot = (rel: string): string => readFileSync(`${repoRoot}${rel}`, 'utf8');
export const readWeb = (rel: string): string => readFileSync(`${webRoot}${rel}`, 'utf8');

/**
 * A title as the root (legacy Next) app writes it, "<page> | Sakola Kembara", in the form this site writes it since
 * SAKEM-090, "<page> - Yayasan Sakola Kembara Indonesia": the pattern of the live WordPress pages, which the SEO parity
 * run asked for. Lets the tests that compare head data with the root's keep comparing everything but that suffix.
 */
export const liveTitle = (rootTitle: string): string => rootTitle.replace(/ \| Sakola Kembara$/, ' - Yayasan Sakola Kembara Indonesia');

/** The JSON-LD blocks of a built page, parsed, in document order. */
export const ldBlocks = (html: string): Record<string, any>[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

/**
 * The `@type`s of the site graph of a built page (the first JSON-LD block, which every indexable page has since
 * SAKEM-090: Organization, WebSite, a WebPage and usually a BreadcrumbList), joined with "+" for a type list.
 */
export const graphTypes = (html: string): string[] =>
  (ldBlocks(html)[0]?.['@graph'] ?? []).map((node: { '@type': string | string[] }) => [node['@type']].flat().join('+'));

/**
 * How many articles content/blog holds, and so how many lib/blog-posts.json lists, how many the markdown adapter and the
 * fixture API serve, and how many WordPress URLs the redirect and parity tests walk. It is a constant, not a count taken
 * from the folder, so that a file that goes missing or an article added without its redirect and its tests fails here.
 * Change it together with the content (README.md of content/blog is not an article).
 */
export const ARTICLE_COUNT = 80;

export interface BlogPostsJson {
  meta: { total: number };
  articles: { id: string; sourceUrl: string; title: string; dateISO: string; modifiedISO: string }[];
}

/** lib/blog-posts.json of the legacy app: the 80 articles with their WordPress sourceUrl. */
export const blogPosts = (): BlogPostsJson => JSON.parse(readRoot('lib/blog-posts.json')) as BlogPostsJson;

/**
 * Import a module of the legacy app by file path, typed by the caller. A
 * variable path keeps TypeScript from resolving the file (it imports `next`
 * types this app does not install); vitest still transforms and runs it.
 */
export async function importRoot<T>(rel: string): Promise<T> {
  const href = new URL(`../../../${rel}`, import.meta.url).href;
  return (await import(/* @vite-ignore */ href)) as T;
}
