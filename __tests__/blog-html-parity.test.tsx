import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { renderBlogHtml } from "@/lib/public-api/blog-html";

// The public API's contentHtml must read the way the site's own renderer
// (components/blog/BlogPostContent.tsx: react-markdown + remark-gfm) renders
// the same markdown. This renders a feature-rich fixture both ways and
// compares them. Serialization details that carry no meaning are normalized:
// void-element slashes, the escape style of "<", and attribute order. The
// site's next/image wrapper for /blog/images/* is replaced by the plain <img>
// the API emits (a static HTML string has no optimizer).
//
// Not compared, and known to differ because the site's <a> and table
// rendering drop what the HTML serializer keeps: footnotes (extra aria and
// id attributes) and table column alignment (the API keeps align="left",
// the site turns it into style="text-align:left"). Neither occurs in
// content/blog today.

const FIXTURE = `
### **Judul bagian**

Paragraf dengan *miring*, **tebal**, ~~coret~~ dan \`kode\` &amp; entitas.

- satu
- dua
  - bersarang

1. pertama
2. kedua

- [x] tugas selesai
- [ ] tugas terbuka

> Kutipan dengan [tautan](https://example.org/a "judul tautan").

| Kolom A | Kolom B |
| ------- | ------- |
| 1       | 2       |

Autolink https://example.org/auto dan <https://example.org/angle>.

Tautan [relatif](/blog/lain) dan [mailto](mailto:halo@example.org).

![Foto lokal](/blog/images/2026/05/foto.jpg)

![Foto remote](https://example.org/foto.png "judul gambar")

\`\`\`js
const x = 1 < 2;
\`\`\`

<div class="raw">HTML mentah</div>

Baris dengan <b>HTML inline</b> di tengah.

[jahat](javascript:alert(1)) dan ![gambar jahat](javascript:alert(2))

---
`;

function normalize(html: string): string {
  return html
    .replace(/&#x3C;/g, "&lt;")
    .replace(/&#x26;/g, "&amp;")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/<(\w+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g, (_m, tag, attrs) => {
      // `disabled=""` and `disabled` are the same boolean attribute.
      const list = (attrs.match(/[\w:-]+(?:="[^"]*")?/g) ?? [])
        .map((a: string) => a.replace(/=""$/, ""))
        .sort();
      return `<${tag}${list.length ? " " + list.join(" ") : ""}>`;
    })
    // The site's renderer drops the whitespace between table elements.
    .replace(/(<\/?(?:table|thead|tbody|tr|th|td)(?: [^>]*)?>)\s+(?=<)/g, "$1");
}

function siteRender(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ src, alt }) =>
          typeof src === "string" && src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt || ""}
              className="rounded-xl max-w-full h-auto my-6"
              loading="lazy"
            />
          ) : null,
        a: ({ href, children }) => (
          <a
            href={href}
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>,
  );
}

describe("renderBlogHtml vs the site's react-markdown render", () => {
  test("a feature-rich article renders the same", () => {
    expect(normalize(renderBlogHtml(FIXTURE))).toBe(
      normalize(siteRender(FIXTURE)),
    );
  });

  test("the fixture really exercises the interesting cases", () => {
    const html = renderBlogHtml(FIXTURE);
    expect(html).toContain("<table>");
    expect(html).toContain("<del>coret</del>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("&#x3C;div");
    expect(html).not.toContain("<div");
    expect(html).not.toContain("javascript:");
  });

  test("empty and whitespace-only markdown give an empty string", () => {
    expect(renderBlogHtml("")).toBe("");
    expect(renderBlogHtml("  \n ")).toBe("");
  });
});
