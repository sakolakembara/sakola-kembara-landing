import type { Root } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, inject, it } from "vitest";
import { renderArticle } from "../src/blog/render";
import { isSafeImageSrc, isSafeLinkHref, sanitizeTree } from "../src/blog/sanitize";
import { ARTICLE_COUNT } from "./helpers";

// The sanitiser (src/blog/sanitize.ts): an allow-list over the tree the markdown renderer makes. Two ways in:
//
//   1. through `renderArticle`, the way a writer reaches it: the markdown pipeline drops raw HTML, but it does NOT
//      filter URLs (`[x](javascript:...)` reaches the tree as written), so the URL rules are what these tests prove;
//   2. through the same sanitiser behind a pipeline that DOES let raw HTML through (rehype-raw, a test-only
//      dependency), to prove the sanitiser alone holds when something upstream changes: `<script>`, `onerror`,
//      iframes, SVG, style attributes, nested and obfuscated tags.
//
// `audit` reads the HTML that comes out the way a browser would and fails on anything outside the allow-list.

const ALLOWED_TAGS = new Set(["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "strong", "em", "del", "code", "pre", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "input", "section", "sup", "span"]);
const ALLOWED_ATTRIBUTES = new Set(["href", "title", "target", "rel", "class", "id", "src", "alt", "srcset", "sizes", "width", "height", "loading", "decoding", "start", "align", "type", "checked", "disabled", "aria-describedby", "aria-label", "data-footnote-ref", "data-footnote-backref", "data-footnotes"]);

const decode = (value: string) => value.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec))).replace(/&(amp|lt|gt|quot);/g, (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"' })[name]!);

/** Every start tag of `html` with its attributes. rehype-stringify quotes every value, so a plain scan is exact. */
function tagsOf(html: string): { name: string; attributes: Record<string, string> }[] {
  const tags: { name: string; attributes: Record<string, string> }[] = [];
  for (const match of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[2]!.matchAll(/\s+([^\s=>]+)(?:="([^"]*)")?/g)) attributes[attribute[1]!] = decode(attribute[2] ?? "");
    tags.push({ name: match[1]!, attributes });
  }
  return tags;
}

/** Fails (with what and where) on anything a browser could run or fetch that the allow-list does not name. */
function audit(html: string): void {
  // Any "<" that does not open an allowed tag, close one, or sit in text as an entity is a tag we did not see.
  const stripped = html.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^\s=>]+(?:="[^"]*")?)*\s*\/?>/g, "");
  expect(stripped, "a raw '<' outside a tag we recognise").not.toMatch(/<[a-zA-Z/!?]/);
  for (const { name, attributes } of tagsOf(html)) {
    expect(ALLOWED_TAGS.has(name), `element <${name}>`).toBe(true);
    for (const [attribute, value] of Object.entries(attributes)) {
      expect(ALLOWED_ATTRIBUTES.has(attribute), `attribute ${name}@${attribute}`).toBe(true);
      expect(attribute.startsWith("on"), `event handler ${attribute}`).toBe(false);
      if (name === "a" && attribute === "href") expect(isSafeLinkHref(value), `href ${value}`).toBe(true);
      if (name === "img" && attribute === "src") expect(isSafeImageSrc(value), `src ${value}`).toBe(true);
      if (attribute === "srcset") expect(value).toMatch(/^\/_img\/[0-9a-f]+-\d+\.webp \d+w(, \/_img\/[0-9a-f]+-\d+\.webp \d+w)*$/);
      expect(value, `${name}@${attribute}`).not.toMatch(/javascript:|vbscript:|data:text|data:image/i);
    }
    if (name === "a") expect(attributes.rel).toBe("noopener noreferrer");
    if (name === "input") expect(attributes.type).toBe("checkbox");
  }
}

const render = (markdown: string) => renderArticle(markdown);

describe("the migrated articles are inside the allow-list as they are", () => {
  it("passes the audit for every article (so the allow-list is no narrower than what the build produced)", () => {
    expect(inject("blogOracle").articles).toHaveLength(ARTICLE_COUNT);
    for (const article of inject("blogOracle").articles) audit(article.html);
  });
});

describe("links", () => {
  it.each([
    ["a plain javascript: URL", "[x](javascript:alert(1))"],
    ["mixed case", "[x](JaVaScRiPt:alert(1))"],
    ["the first letter as a character reference", "[x](&#106;avascript:alert(1))"],
    ["an autolink", "<javascript:alert(1)>"],
    ["vbscript:", "[x](vbscript:msgbox(1))"],
    ["data:text/html", "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["file:", "[x](file:///etc/passwd)"],
    ["ftp:", "[x](ftp://example.org/a)"],
    ["a protocol-relative URL", "[x](//evil.example/a)"],
  ])("a link with %s is text, not a link", (_name, markdown) => {
    const { html, removed } = render(`Teks sebelum ${markdown} sesudah.`);
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toMatch(/href=/);
    expect(removed).toBeGreaterThan(0);
    audit(html);
  });

  // The markdown parser percent-encodes spaces, control characters, zero-width characters and backslashes in an
  // address, so "java<tab>script:" reaches the tree as "java%09script:", a relative path no browser runs. These
  // never become a scheme; what is proved is that nothing a browser could read as one comes out.
  it.each([
    ["a tab spelled as a character reference", "[x](java&#x09;script:alert(1))"],
    ["a newline spelled as a character reference", "[x](java&#10;script:alert(1))"],
    ["a control character before the scheme", "[x](\u0001javascript:alert(1))"],
    ["a leading space inside angle brackets", "[x](< javascript:alert(1)>)"],
    ["a zero-width space inside the scheme", "[x](java\u200bscript:alert(1))"],
    ["a backslash host", "[x](\\\\evil.example\\a)"],
    ["a reference definition", "[x][1]\n\n[1]: javascript:alert(1)"],
  ])("a link with %s cannot be read as a script URL", (_name, markdown) => {
    const { html } = render(`Teks sebelum ${markdown} sesudah.`);
    audit(html);
    for (const { name, attributes } of tagsOf(html)) {
      if (name !== "a") continue;
      // What a browser does to a URL before reading its scheme: drop tabs and newlines, trim leading control characters and spaces.
      const seen = attributes.href!.replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+/, "");
      expect(seen).not.toMatch(/^(javascript|vbscript|data|file):/i);
      expect(seen.startsWith("//")).toBe(false);
    }
  });

  it("keeps the words of a refused link", () => {
    expect(render("Baca [panduan kami](javascript:alert(1)) dulu.").html).toBe("<p>Baca panduan kami dulu.</p>");
  });

  it("allows http, https, mailto, tel, a path, a relative path and a fragment, and gives each link rel", () => {
    const { html, removed } = render("[a](https://example.org/x?y=1) [b](http://example.org) [c](mailto:halo@example.org) [d](tel:+628123456789) [e](/blog/lain) [f](tulisan/lain) [g](#bagian)");
    expect(removed).toBe(0);
    expect(html).toContain('<a href="https://example.org/x?y=1" target="_blank" rel="noopener noreferrer">a</a>');
    expect(html).toContain('<a href="http://example.org" target="_blank" rel="noopener noreferrer">b</a>');
    expect(html).toContain('<a href="mailto:halo@example.org" rel="noopener noreferrer">c</a>');
    expect(html).toContain('<a href="tel:+628123456789" rel="noopener noreferrer">d</a>');
    expect(html).toContain('<a href="/blog/lain" rel="noopener noreferrer">e</a>');
    expect(html).toContain('<a href="#bagian" rel="noopener noreferrer">g</a>');
    audit(html);
  });

  it("opens only a link that leaves the site in a new tab", () => {
    const html = render("[luar](https://example.org) [dalam](/donasi)").html;
    expect(html).toMatch(/<a href="https:\/\/example.org" target="_blank" rel="noopener noreferrer">luar<\/a>/);
    expect(html).toMatch(/<a href="\/donasi" rel="noopener noreferrer">dalam<\/a>/);
  });

  it("cannot be broken out of an attribute through the title", () => {
    const html = render('[x](/a "\\" onmouseover=\\"alert(1)")').html;
    audit(html);
    expect(tagsOf(html)[1]!.attributes).not.toHaveProperty("onmouseover");
  });

  it("a very long address is refused", () => {
    expect(render(`[x](https://example.org/${"a".repeat(2100)})`).html).not.toMatch(/<a /);
  });
});

describe("images", () => {
  const uploaded = "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto.png";

  it.each([
    ["javascript:", "![x](javascript:alert(1))"],
    ["data:image/svg+xml", "![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)"],
    ["http:", "![x](http://example.org/a.png)"],
    ["an upload of another kind", "![x](/uploads/team-photo/2026/0a1b2c3d-1111-4222-8333-444455556666-foto.png)"],
    ["a path that is not an upload key", "![x](/uploads/../etc/passwd)"],
    ["a path of the site outside the blog's", "![x](/images/logo.png)"],
    ["a legacy path with ..", "![x](/blog/images/../../etc/passwd)"],
    ["a protocol-relative URL", "![x](//evil.example/a.png)"],
    ["https with credentials", "![x](https://user:secret@example.org/a.png)"],
  ])("an image from %s is removed", (_name, markdown) => {
    const { html, removed } = render(`Sebelum\n\n${markdown}\n\nSesudah`);
    expect(html).not.toMatch(/<img/);
    expect(html).not.toMatch(/<span/);
    expect(removed).toBeGreaterThan(0);
    audit(html);
  });

  it("keeps https images, our uploads and the legacy blog's files", () => {
    const { html, removed } = render(`![a](https://example.org/a.png)\n\n![b](${uploaded})\n\n![c](/blog/images/2024/10/img-daffa.png)`);
    expect(removed).toBe(0);
    expect(html).toContain('<img src="https://example.org/a.png" alt="a" loading="lazy" decoding="async" class="rounded-xl max-w-full h-auto my-6">');
    expect(html).toContain(`<span class="block my-6 relative w-full max-w-full"><img src="${uploaded}" alt="b" loading="lazy" decoding="async" class="rounded-xl w-full h-auto"></span>`);
    // The legacy file the build knows gets its ladder, size and the `@`-safe URL.
    expect(html).toMatch(/<img src="\/blog\/images\/2024\/10\/img-daffa.png" alt="c" srcset="\/_img\/cd6953e6ff48-419.webp 419w" sizes="[^"]+" width="419" height="420"/);
    audit(html);
  });

  it("gives an upload the size recorded for it, so the page reserves its space", () => {
    const html = renderArticle(`![b](${uploaded})`, { images: (path) => (path === uploaded ? { width: 800, height: 600 } : null) }).html;
    expect(html).toContain(`src="${uploaded}" alt="b" width="800" height="600" loading="lazy"`);
  });

  it("never lets a looked-up address or ladder into the page unchecked", () => {
    // A lookup that returns something hostile (it cannot today: the sanitiser is the last word on it).
    const html = renderArticle("![b](/blog/images/2024/10/img-daffa.png)", { images: () => ({ width: 1, height: 1, src: "javascript:alert(1)", srcset: "javascript:alert(1) 1w" }) }).html;
    expect(html).not.toMatch(/javascript/);
    expect(html).not.toMatch(/<img/);
  });
});

describe("text and code are text", () => {
  it("shows tags a writer typed as nothing at all", () => {
    expect(render("Halo <script>alert(1)</script> dunia").html).toBe("<p>Halo alert(1) dunia</p>");
    expect(render('<img src=x onerror="alert(1)">\n\nsesudahnya').html).toBe("<p>sesudahnya</p>");
  });

  it("escapes what looks like a tag in text and in code", () => {
    const html = render("&lt;script&gt;alert(1)&lt;/script&gt;\n\n```html\n<script>alert(1)</script>\n```").html;
    expect(html).not.toMatch(/<script/);
    expect(html).toContain("&#x3C;script>");
    audit(html);
  });

  it("keeps a code fence's language class and drops any other class", () => {
    expect(render("```js\nconst a = 1;\n```").html).toContain('<code class="language-js">');
  });
});

describe("markdown features stay intact", () => {
  it("renders tables with alignment, task lists, strikethrough, footnotes and ordered lists from 5", () => {
    const html = render("| a | b |\n|:--|--:|\n| 1 | 2 |\n\n- [x] selesai\n- [ ] belum\n\n~~coret~~ catatan[^1]\n\n5. lima\n6. enam\n\n[^1]: isi catatan").html;
    expect(html).toContain('<th align="left">a</th>');
    expect(html).toContain('<td align="right">2</td>');
    expect(html).toContain('<ul class="contains-task-list">');
    expect(html).toContain('<input type="checkbox" checked disabled>');
    expect(html).toContain("<del>coret</del>");
    expect(html).toContain('<ol start="5">');
    expect(html).toContain('id="user-content-fn-1"');
    expect(html).toContain("data-footnote-ref");
    audit(html);
  });
});

// ------------------------------------------------------------------------------------------------------------
// The sanitiser behind a pipeline that lets raw HTML through: what it must stop if something upstream changes.

const rawPipeline = unified()
  .use(remarkParse)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(() => (tree: Root) => {
    sanitizeTree(tree);
  })
  .use(rehypeStringify);

const viaRawHtml = (html: string) => String(rawPipeline.processSync(html));

describe("raw HTML, if a pipeline ever let it through", () => {
  const attacks: [string, string][] = [
    ["a script", "<script>alert(1)</script>"],
    ["a script with attributes", '<script src="https://evil.example/x.js" async></script>'],
    ["an image with onerror", "<img src=x onerror=alert(1)>"],
    ["an image with onerror and a good src", '<img src="/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-a.png" onerror="alert(1)" onload="alert(2)">'],
    ["a link with onclick", '<a href="/x" onclick="alert(1)" onmouseover="alert(2)">x</a>'],
    ["a javascript: link", '<a href="javascript:alert(1)">x</a>'],
    ["an obfuscated javascript: link", '<a href="&#x6A;avascript&colon;alert(1)">x</a>'],
    ["a tab inside the scheme", '<a href="java\tscript:alert(1)">x</a>'],
    ["an iframe", '<iframe src="https://evil.example"></iframe>'],
    ["an iframe with srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ["an svg with onload", "<svg onload=alert(1)><circle r=1></circle></svg>"],
    ["an svg with a script", '<svg><script>alert(1)</script></svg>'],
    ["math", "<math><mi xlink:href=javascript:alert(1)>x</mi></math>"],
    ["an object", '<object data="javascript:alert(1)"></object>'],
    ["an embed", '<embed src="javascript:alert(1)">'],
    ["a form", '<form action="https://evil.example"><input name=p><button>go</button></form>'],
    ["a style element", "<style>body{display:none}</style>"],
    ["a style attribute", '<p style="position:fixed;top:0;left:0;width:100%;height:100%">overlay</p>'],
    ["a base element", '<base href="https://evil.example/">'],
    ["a meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
    ["a link element", '<link rel="stylesheet" href="https://evil.example/x.css">'],
    ["nested tags that rebuild a script", "<scr<script>ipt>alert(1)</scr</script>ipt>"],
    ["a doubled bracket", "<<script>script>alert(1)<</script>/script>"],
    ["an uppercase script", "<SCRIPT>alert(1)</SCRIPT>"],
    ["a mixed case handler", '<img src="/blog/images/2024/10/img-daffa.png" OnErRoR="alert(1)">'],
    ["a comment holding a script", "<!--<script>alert(1)</script>-->"],
    ["a conditional comment", "<!--[if IE]><script>alert(1)</script><![endif]-->"],
    ["a CDATA section", "<![CDATA[<script>alert(1)</script>]]>"],
    ["details with ontoggle", "<details open ontoggle=alert(1)>x</details>"],
    ["a video with onerror", '<video><source src="x" onerror="alert(1)"></video>'],
    ["a button with formaction", '<button formaction="javascript:alert(1)">x</button>'],
    ["a textarea holding a script", "<textarea><script>alert(1)</script></textarea>"],
    ["a data: image", '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">'],
    ["a target and a hostile rel", '<a href="https://example.org" target="_top" rel="opener">x</a>'],
    ["an id that could clobber the page", '<p id="__proto__">x</p><a id="cookie" href="/x">y</a>'],
    ["a class that names our styles", '<p class="fixed inset-0 z-50">x</p>'],
  ];

  it.each(attacks)("%s", (_name, html) => {
    const out = viaRawHtml(`<p>aman</p>\n\n${html}\n\n<p>akhir</p>`);
    audit(out);
    expect(out).not.toMatch(/alert\(1\)<\/script|<script|<iframe|<svg|<style|<object|<embed|<form|<button|<base|<meta|<link|<video|<math|<textarea|<details|style=|onerror|onload|onclick|onmouseover|ontoggle|srcdoc|formaction/i);
    expect(out).toContain("aman");
    expect(out).toContain("akhir");
  });

  it("does not leave the script's text behind", () => {
    expect(viaRawHtml("<p>a</p><script>alert(1)</script><p>b</p>")).toBe("<p>a</p><p>b</p>");
    expect(viaRawHtml("<style>p{}</style><p>b</p>")).toBe("<p>b</p>");
  });

  it("keeps the words of an element it does not know", () => {
    expect(viaRawHtml("<p>a <font color=red>rusak</font> b</p>")).toBe("<p>a rusak b</p>");
  });

  it("removes a script nested anywhere, inside a table or a list", () => {
    const out = viaRawHtml("<table><tbody><tr><td><script>alert(1)</script>x</td></tr></tbody></table><ul><li><img src=x onerror=alert(1)>y</li></ul>");
    audit(out);
    expect(out).toBe("<table><tbody><tr><td>x</td></tr></tbody></table><ul><li>y</li></ul>");
  });

  it("makes every link carry rel and only an outside link a target", () => {
    const out = viaRawHtml('<a href="https://example.org" target="_top" rel="opener">x</a><a href="/y" target="_blank">z</a>');
    // The hostile target and rel are replaced; adding `target` to an outside link is the renderer's step, not the sanitiser's.
    expect(out).toBe('<p><a href="https://example.org" rel="noopener noreferrer">x</a><a href="/y" rel="noopener noreferrer">z</a></p>');
  });
});

describe("the URL rules", () => {
  it("isSafeLinkHref", () => {
    for (const ok of ["https://example.org", "http://example.org/a?b=1#c", "mailto:a@b.co", "tel:+62812", "/blog/x", "blog/x", "#a", "?q=1", "../x"]) expect(isSafeLinkHref(ok), ok).toBe(true);
    for (const bad of ["", " ", "%20javascript:1", "java%0Ascript:1", "javascript:1", "JAVASCRIPT:1", "data:text/html,x", "vbscript:x", "//evil", "\\\\evil", "http://", "https://u:p@example.org", "a b", "java\tscript:1", "x".repeat(2001), 12, null, undefined]) expect(isSafeLinkHref(bad as never), String(bad)).toBe(false);
  });

  it("isSafeImageSrc", () => {
    for (const ok of ["https://example.org/a.png", "/blog/images/2026/05/a-b_c.JPG", "/blog/images/2026/05/a%40b.jpg", "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-a.png"]) expect(isSafeImageSrc(ok), ok).toBe(true);
    for (const bad of ["", "http://example.org/a.png", "javascript:1", "data:image/png;base64,AAAA", "/images/a.png", "/blog/images/../a.png", "/blog/images/", "/uploads/blog-image/2026/x.png", "/uploads/report/2026/0a1b2c3d-1111-4222-8333-444455556666-a.pdf", "https://", "//example.org/a.png", "/blog/images/a b.png", null, 3]) expect(isSafeImageSrc(bad as never), String(bad)).toBe(false);
  });
});
