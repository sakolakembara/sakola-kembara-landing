import type { Element, Root } from "hast";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { type ImageLookup, legacyImage } from "./images";
import { IMAGE_WRAPPER_CLASSES, INLINE_SIZES, sanitizeTree, type SanitizeStats } from "./sanitize";

// Markdown -> the sanitised HTML the public site shows (docs/cloudflare/admin-blog.md#the-render-pipeline).
//
// ONE pure function, run when an article is saved (and for the editor's preview), never on a public read:
// Workers Free allows 10 ms of CPU per request. The output is stored in `blog_posts.content_html` next to
// the markdown, which stays the source of truth.
//
// It is the pipeline of cf/web's build plugin (plugins/blog-content.mjs, the one that rendered the 80
// migrated articles into the pages), the same libraries and the same steps, so that what an editor saves
// reads exactly like what the build produced: remark-parse, remark-gfm, remark-rehype WITHOUT raw HTML (a
// tag a writer types is dropped, as react-markdown did), the `a` and `img` rules of the legacy
// BlogPostContent, rehype-stringify. test/blog-render-parity.test.ts renders all 80 articles with this
// function and compares them with the plugin's output byte for byte. The one step added is the sanitiser
// (./sanitize.ts), which changes nothing for those 80 and removes what must never be published.

export interface RenderOptions {
  /** What is known about an inline image by its path. Default: the legacy blog's files only (`legacyImage`). */
  images?: ImageLookup;
}

export interface RenderedArticle {
  html: string;
  /** How many nodes and attributes the sanitiser removed (0 for ordinary content). */
  removed: number;
}

/** Local pictures (the legacy blog's files and our uploads) fill the column inside a wrapper, as the build plugin renders `/blog/images/`. */
const isLocalImage = (src: string) => src.startsWith("/blog/images/") || src.startsWith("/uploads/");

interface Run {
  images: ImageLookup;
  stats: SanitizeStats;
}

// The pipeline is built once. A run's options reach the plugins through `run`, which `renderArticle` sets for
// the duration of one synchronous `processSync` and clears again (nothing else can run in between).
let run: Run | null = null;

/** Pre-order walk over the elements of a tree (what `unist-util-visit` does for the build plugin, without the dependency). */
function eachElement(node: { children?: unknown[] }, visit: (element: Element) => void): void {
  for (const child of node.children ?? []) {
    const candidate = child as { type?: string; children?: unknown[] };
    if (candidate.type === "element") visit(candidate as Element);
    if (candidate.children) eachElement(candidate, visit);
  }
}

/** The `a` and `img` rules of the legacy renderer (components/blog/BlogPostContent.tsx), as in plugins/blog-content.mjs. */
function rehypeBlogElements() {
  return (tree: Root) => {
    const lookup = run?.images ?? legacyImage;
    // Images are rewritten after the walk: a local one is wrapped in a <span>, and wrapping while visiting
    // would visit the wrapped <img> again.
    const imgs: Element[] = [];
    eachElement(tree, (node) => {
      if (node.tagName === "a") {
        const href = String(node.properties?.href ?? "");
        node.properties = {
          ...node.properties,
          ...(href.startsWith("http") ? { target: "_blank" } : {}),
          rel: ["noopener", "noreferrer"],
        };
      }
      if (node.tagName === "img" && node.properties?.src) imgs.push(node);
    });
    for (const node of imgs) {
      const src = String(node.properties.src);
      const info = lookup(src);
      const local = isLocalImage(src);
      node.properties = {
        src: info?.src ?? src,
        alt: node.properties.alt ?? "",
        ...(info?.srcset ? { srcset: info.srcset, sizes: INLINE_SIZES } : {}),
        ...(info ? { width: info.width, height: info.height } : {}),
        loading: "lazy",
        decoding: "async",
        className: local ? ["rounded-xl", "w-full", "h-auto"] : ["rounded-xl", "max-w-full", "h-auto", "my-6"],
      };
      if (local) {
        const img: Element = { ...node };
        node.tagName = "span";
        node.properties = { className: [...IMAGE_WRAPPER_CLASSES] };
        node.children = [img];
      }
    }
  };
}

/** The last word on what reaches the page. */
function rehypeSanitize() {
  return (tree: Root) => {
    sanitizeTree(tree, run?.stats);
  };
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeBlogElements).use(rehypeSanitize).use(rehypeStringify);

/**
 * Renders `markdown` to sanitised HTML. Surrounding whitespace is trimmed, as the legacy reader did
 * (`content.trim()`), and a CRLF is a newline.
 */
export function renderArticle(markdown: string, options: RenderOptions = {}): RenderedArticle {
  const stats: SanitizeStats = { removed: 0 };
  const previous = run;
  run = { images: options.images ?? legacyImage, stats };
  try {
    const html = String(processor.processSync(markdown.replace(/\r\n?/g, "\n").trim()));
    return { html, removed: stats.removed };
  } finally {
    run = previous;
  }
}

/**
 * The `/uploads/blog-image/...` paths an article's markdown mentions, to look their sizes up before rendering.
 * One linear scan for the exact shape of an upload path (the same pattern the upload API builds keys with), at
 * most `limit` distinct paths.
 */
export function uploadPathsIn(markdown: string, limit = 50): string[] {
  const found = new Set<string>();
  const pattern = /\/uploads\/[a-z-]{1,40}\/\d{4}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-z0-9][a-z0-9-]{0,59}\.(?:png|jpg|webp|gif|pdf)/g;
  for (const match of markdown.matchAll(pattern)) {
    found.add(match[0]);
    if (found.size >= limit) break;
  }
  return [...found];
}
