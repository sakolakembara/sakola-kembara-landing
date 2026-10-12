import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const webRoot = fileURLToPath(new URL('..', import.meta.url));
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Read a file of the legacy app (read only). */
export const readRoot = (rel: string): string => readFileSync(`${repoRoot}${rel}`, 'utf8');
export const readWeb = (rel: string): string => readFileSync(`${webRoot}${rel}`, 'utf8');

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
