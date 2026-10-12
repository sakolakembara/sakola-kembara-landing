// Vite plugin: turns the legacy repo's markdown blog (content/blog/*.md at the
// repo root) into two virtual modules, so the Worker never touches a file system.
//
//   virtual:blog-index   metadata of every article (no body), sorted newest
//                        first. Small; safe for SSR pages, the sitemap and the
//                        related-articles logic.
//   virtual:blog-bodies  { [slug]: html } rendered at build time. Only the
//                        prerendered article pages import it, so the HTML of
//                        80 articles stays out of the Worker bundle.
//
// Why a plugin instead of `import.meta.glob(..., { query: '?raw' })` or
// `astro:content`: the frontmatter is parsed and the markdown is rendered
// once, in Node, with the same engine react-markdown uses today (remark-parse
// + remark-gfm + remark-rehype; raw HTML is dropped, as react-markdown does).
// The Worker (and the prerender, which runs inside workerd) only ever sees
// plain strings. The plugin also reads the real image files under the root
// public/ to put width and height on every <img>, which the Next app could
// not do (it guessed 1024x768).
//
// The markdown stays where it is: no copy, no second source of truth.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { imageSizeFromFile } from 'image-size/fromFile';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';

const INDEX_ID = 'virtual:blog-index';
const BODIES_ID = 'virtual:blog-bodies';
const resolved = (id) => `\0${id}`;

/** Same rule as isLocalImage() in the root components/blog/BlogPostContent.tsx. */
const isLocalImage = (src) => src.startsWith('/blog/images/');

/**
 * @param {{ contentDir: string; publicDir: string }} options
 *   contentDir: folder with the <slug>.md files. publicDir: root public/,
 *   used only to read image dimensions.
 */
export default function blogContent({ contentDir, publicDir }) {
  const dimCache = new Map();

  async function dimensions(src) {
    if (!src || !src.startsWith('/')) return null;
    if (dimCache.has(src)) return dimCache.get(src);
    let dim = null;
    const file = path.join(publicDir, src.split(/[?#]/)[0]);
    if (existsSync(file)) {
      try {
        const { width, height } = await imageSizeFromFile(file);
        if (width && height) dim = { width, height };
      } catch {
        // unreadable image: leave the attributes off rather than guess
      }
    }
    dimCache.set(src, dim);
    return dim;
  }

  /** The rehype step: react-markdown's `img` and `a` overrides, as HTML attributes. */
  function rehypeBlogElements() {
    return async (tree) => {
      const jobs = [];
      visit(tree, 'element', (node) => {
        if (node.tagName === 'a') {
          const href = String(node.properties?.href ?? '');
          node.properties = {
            ...node.properties,
            ...(href.startsWith('http') ? { target: '_blank' } : {}),
            rel: 'noopener noreferrer',
          };
        }
        if (node.tagName === 'img') {
          const src = String(node.properties?.src ?? '');
          if (!src) return;
          jobs.push(
            (async () => {
              const dim = await dimensions(src);
              const local = isLocalImage(src);
              node.properties = {
                src,
                alt: node.properties?.alt ?? '',
                ...(dim ?? {}),
                loading: 'lazy',
                decoding: 'async',
                className: local
                  ? ['rounded-xl', 'w-full', 'h-auto']
                  : ['rounded-xl', 'max-w-full', 'h-auto', 'my-6'],
              };
              if (local) {
                // next/image sat in `<span class="block my-6 relative w-full max-w-full">`
                const img = { ...node };
                node.tagName = 'span';
                node.properties = { className: ['block', 'my-6', 'relative', 'w-full', 'max-w-full'] };
                node.children = [img];
              }
            })(),
          );
        }
      });
      await Promise.all(jobs);
    };
  }

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeBlogElements)
    .use(rehypeStringify);

  /** Read, parse and render every article. Mirrors readAllArticles() in the root lib/blog.ts. */
  async function readAll() {
    const files = readdirSync(contentDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
    const articles = await Promise.all(
      files.map(async (file) => {
        const { data, content } = matter(readFileSync(path.join(contentDir, file), 'utf8'));
        const id = data.id ?? file.replace(/\.md$/, '');
        const image = data.image ?? '';
        const html = String(await processor.process(content.trim()));
        const dim = await dimensions(image);
        return {
          meta: {
            id,
            wpId: data.wpId ?? 0,
            category: data.category ?? 'Uncategorized',
            date: data.date ?? '',
            dateISO: data.dateISO ?? '1970-01-01',
            title: data.title ?? '(untitled)',
            excerpt: data.excerpt ?? '',
            featured: Boolean(data.featured),
            image,
            imageWidth: dim?.width ?? null,
            imageHeight: dim?.height ?? null,
            author: data.author ?? 'Sakola Kembara',
            sourceUrl: data.sourceUrl ?? '',
            modifiedISO: data.modifiedISO ?? data.dateISO ?? '1970-01-01',
          },
          html,
        };
      }),
    );
    // Newest first, like getBlogArticlesSorted(); ties keep a stable order by id.
    articles.sort(
      (a, b) =>
        new Date(b.meta.dateISO).getTime() - new Date(a.meta.dateISO).getTime() ||
        a.meta.id.localeCompare(b.meta.id),
    );
    return articles;
  }

  let cache = null;
  const load = () => (cache ??= readAll());

  return {
    name: 'sakem:blog-content',
    resolveId(id) {
      if (id === INDEX_ID || id === BODIES_ID) return resolved(id);
    },
    async load(id) {
      if (id !== resolved(INDEX_ID) && id !== resolved(BODIES_ID)) return;
      const articles = await load();
      if (id === resolved(INDEX_ID)) {
        return `export const articles = ${JSON.stringify(articles.map((a) => a.meta))};`;
      }
      return `export const bodies = ${JSON.stringify(Object.fromEntries(articles.map((a) => [a.meta.id, a.html])))};`;
    },
    configureServer(server) {
      // Dev only: re-read the markdown when a file changes and reload the page.
      server.watcher.add(contentDir);
      const onChange = (file) => {
        if (!file.startsWith(contentDir)) return;
        cache = null;
        for (const env of Object.values(server.environments ?? {})) {
          for (const id of [INDEX_ID, BODIES_ID]) {
            const mod = env.moduleGraph.getModuleById(resolved(id));
            if (mod) env.moduleGraph.invalidateModule(mod);
          }
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}
