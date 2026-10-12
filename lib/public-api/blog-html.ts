import { defaultUrlTransform } from "react-markdown";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype, { defaultHandlers } from "remark-rehype";
import { unified } from "unified";

// Server-side render of an article body for the public API, as an HTML
// string. The site renders the same markdown with react-markdown
// (components/blog/BlogPostContent.tsx); react-markdown is this same unified
// pipeline (remark-parse + remark-gfm + remark-rehype) ending in React
// elements, and Next does not allow react-dom/server in a route handler, so
// this ends in rehype-stringify instead. What carries over from the site:
//   - raw HTML in the markdown is shown as text, never passed through;
//   - URLs go through react-markdown's own defaultUrlTransform, so
//     javascript: and similar links are blanked;
//   - links to http(s) open in a new tab, every link gets rel="noopener noreferrer";
//   - an image is a plain <img> with the site's classes and loading="lazy"
//     (the site uses next/image for /blog/images/* and a plain <img> for
//     remote ones; a static HTML string has no optimizer to call).
// The surrounding <div class="blog-content"> is left to the consumer.

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, {
    // Raw HTML becomes `raw` nodes, which rehype-stringify (without
    // allowDangerousHtml) serializes as escaped text, like react-markdown.
    allowDangerousHtml: true,
    handlers: {
      link(state, node) {
        const element = defaultHandlers.link(state, node);
        const href = defaultUrlTransform(String(element.properties.href ?? ""));
        element.properties.href = href;
        // The site's <a> only passes href and children on, so a markdown
        // link title is not rendered there either.
        delete element.properties.title;
        element.properties.rel = ["noopener", "noreferrer"];
        if (href.startsWith("http")) element.properties.target = "_blank";
        return element;
      },
      image(state, node) {
        const src = defaultUrlTransform(node.url);
        if (!src) return undefined;
        return {
          type: "element",
          tagName: "img",
          properties: {
            src,
            alt: node.alt || "",
            className: ["rounded-xl", "max-w-full", "h-auto", "my-6"],
            loading: "lazy",
          },
          children: [],
        };
      },
    },
  })
  .use(rehypeStringify);

export function renderBlogHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return String(processor.processSync(markdown));
}
