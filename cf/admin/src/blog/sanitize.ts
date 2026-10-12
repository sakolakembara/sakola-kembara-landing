import type { Element, ElementContent, Root, RootContent } from "hast";
import { keyForPath, kindOfKey } from "../uploads/key";

// The sanitiser of the blog (docs/cloudflare/admin-blog.md#the-sanitiser): an ALLOW-LIST over the tree the
// markdown renderer produced, applied to the tree and not to a string, so there is no HTML to re-parse and
// no regular expression runs over the whole article. Everything not listed is removed, never repaired:
//
//   elements    only those markdown can produce (paragraphs, headings, lists, links, images, code, tables,
//               footnotes, task-list checkboxes). `script`, `style`, `iframe`, `svg`, `object`, `form` and
//               the like are removed WITH their content; any other unknown element loses its tags and
//               keeps its (cleaned) text.
//   attributes  an allow-list per element, each with its own check. Event handlers (`onerror`), `style`,
//               `srcdoc`, `formaction` and every other name are simply not on the list.
//   URLs        a link may be `http:`, `https:`, `mailto:`, `tel:`, a path or a fragment. Nothing else:
//               `javascript:`, `data:` and `vbscript:` (however they are spelled, with tabs, case or
//               control characters inside) are refused, and the link loses its tags and keeps its text.
//               An image may be one of ours (`/uploads/blog-image/...`), a file of the legacy blog
//               (`/blog/images/...`) or `https:`; any other image is removed.
//   links       every link carries `rel="noopener noreferrer"`, and `target="_blank"` only when it leaves
//               the site.
//
// The renderer drops raw HTML before this runs (remark-rehype without `allowDangerousHtml`), so the tree
// cannot carry an element a writer typed. This is the second wall: a change to the pipeline (a plugin that
// lets raw HTML through) or a URL the markdown parser does not filter (it does not: `[x](javascript:...)`
// reaches the tree as written) still cannot reach a visitor. The public site injects `contentHtml`
// unescaped (docs/cloudflare/content-api.md), so this function is what makes that safe.

/** The `sizes` of an inline article image: the reading column is 800 px wide (plugins/blog-content.mjs of cf/web). */
export const INLINE_SIZES = "(min-width: 800px) 672px, (min-width: 768px) calc(100vw - 128px), calc(100vw - 96px)";

/** Classes the renderer puts on the wrapper span and the image of an inline picture. */
export const IMAGE_WRAPPER_CLASSES = ["block", "my-6", "relative", "w-full", "max-w-full"] as const;
export const IMAGE_CLASSES = ["rounded-xl", "w-full", "h-auto", "max-w-full", "my-6"] as const;

const TAGS = new Set([
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "strong", "em", "del", "code", "pre", "a", "img",
  "table", "thead", "tbody", "tr", "th", "td", "input", "section", "sup", "span",
]);

/** Elements that are removed together with what is inside them: their content is code, style or another document. */
const DROPPED_WITH_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "svg", "math", "template", "noscript", "head", "title", "base",
  "link", "meta", "form", "button", "select", "textarea", "option", "audio", "video", "source", "track", "canvas", "portal", "dialog", "slot", "xmp", "plaintext",
]);

const VOID = new Set(["br", "hr", "img", "input"]);

/**
 * True when `value` has a control character, a space or one of the invisible code points that look like one.
 * (A loop and not a regular expression, so the list can be read and cannot be broken by an editor that
 * "fixes" invisible characters in a source file.)
 */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0x1680 || (c >= 0x2000 && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) return true;
  }
  return false;
}
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const LEGACY_IMAGE = /^\/blog\/images\/[A-Za-z0-9._%@+()-]+(?:\/[A-Za-z0-9._%@+()-]+)*$/;
const FRAGMENT = /^#[A-Za-z0-9_%.:-]{0,200}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const FOOTNOTE_ID = /^(?:user-content-)?(?:fn|fnref)-[A-Za-z0-9_%.-]{1,100}$|^footnote-label$/;
const SRCSET_CANDIDATE = /^\/_img\/[0-9a-f]{6,64}-\d{2,5}\.webp \d{2,5}w$/;
const LANGUAGE = /^language-[A-Za-z0-9_+#.-]{1,40}$/;
const MAX_URL_LENGTH = 2000;

function decodedStartsWithForeignScheme(value: string): boolean {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A malformed escape ("%zz"): look at the text as written.
  }
  let start = 0;
  while (start < decoded.length && decoded.charCodeAt(start) <= 0x20) start++;
  const seen = decoded.slice(start).replace(/[\t\n\r]/g, "");
  const scheme = SCHEME.exec(seen)?.[1]?.toLowerCase();
  return scheme !== undefined && !LINK_SCHEMES.has(scheme);
}

/** True for the address of a link we are willing to write into a page. */
export function isSafeLinkHref(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.length > MAX_URL_LENGTH) return false;
  // A URL never contains whitespace or control characters; a browser would strip some of them
  // ("java\tscript:" is "javascript:"), which is exactly how filters are got around.
  if (hasControlOrSpace(value)) return false;
  // What a browser, or any program that decodes the address first, would read as the scheme: percent-escapes
  // undone, tabs and newlines inside dropped, leading control characters and spaces trimmed. "%20javascript:x" and
  // "java%0Ascript:x" are relative paths to a browser, but are not worth the doubt.
  if (decodedStartsWithForeignScheme(value)) return false;
  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (!LINK_SCHEMES.has(scheme)) return false;
    if (scheme === "http" || scheme === "https") {
      try {
        const url = new URL(value);
        return url.hostname !== "" && url.username === "" && url.password === "";
      } catch {
        return false;
      }
    }
    return true;
  }
  // No scheme: a path, a query or a fragment of this site. "//host" and "\\host" leave it.
  if (value.startsWith("//") || value.includes("\\")) return false;
  return value.startsWith("#") ? FRAGMENT.test(value) : true;
}

/** True for the `src` of an image we are willing to write into a page: ours, the legacy blog's, or https. */
export function isSafeImageSrc(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.length > MAX_URL_LENGTH || hasControlOrSpace(value)) return false;
  if (value.startsWith("/uploads/")) {
    const key = keyForPath(value);
    return key !== null && kindOfKey(key) === "blog-image";
  }
  if (value.startsWith("/blog/images/")) return LEGACY_IMAGE.test(value) && !value.split("/").some((part) => part === ".." || part === ".");
  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "";
    } catch {
      return false;
    }
  }
  return false;
}

/** What `removed` counts: nodes and attributes taken out. */
export interface SanitizeStats {
  removed: number;
}

type Verdict = boolean | { replace: unknown };
type Check = (value: unknown, node: Element) => Verdict;

const isText = (max: number): Check => (value) => typeof value === "string" && value.length <= max;
const isFlag: Check = (value) => value === true || value === "";
const isInteger =
  (min: number, max: number): Check =>
  (value) => {
    const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,7}$/.test(value) ? Number(value) : Number.NaN;
    return Number.isInteger(n) && n >= min && n <= max;
  };

const tokens = (value: unknown): string[] | null => {
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value as string[];
  return null;
};

/** `class`: keep the listed tokens, drop the rest; nothing left means no attribute. */
const classes =
  (allowed: readonly string[] | RegExp): Check =>
  (value) => {
    const list = tokens(value);
    if (list === null) return false;
    const kept = list.filter((token) => (Array.isArray(allowed) ? allowed.includes(token) : (allowed as RegExp).test(token)));
    if (kept.length === 0) return false;
    return kept.length === list.length ? true : { replace: kept };
  };

const idList: Check = (value) => {
  const list = tokens(value);
  return list !== null && list.length > 0 && list.every((token) => TOKEN.test(token));
};

const srcset: Check = (value) => {
  if (typeof value !== "string" || value.length > 1000) return false;
  const candidates = value.split(", ");
  return candidates.length > 0 && candidates.every((candidate) => SRCSET_CANDIDATE.test(candidate));
};

const align: Check = (value) => value === "left" || value === "right" || value === "center";

/** Attribute rules by element, keyed by the attribute's canonical name (lower case, no `-` or `_`; `className` is `classname`). */
const ATTRIBUTES: Record<string, Record<string, Check>> = {
  a: {
    href: (value) => isSafeLinkHref(value),
    title: isText(500),
    target: (value) => value === "_blank",
    rel: (value) => {
      const list = tokens(value);
      return list !== null && list.length === 2 && list[0] === "noopener" && list[1] === "noreferrer";
    },
    classname: classes(["data-footnote-backref"]),
    class: classes(["data-footnote-backref"]),
    id: (value) => typeof value === "string" && FOOTNOTE_ID.test(value),
    datafootnoteref: isFlag,
    datafootnotebackref: isFlag,
    ariadescribedby: idList,
    arialabel: isText(300),
  },
  img: {
    src: (value) => isSafeImageSrc(value),
    alt: isText(5000),
    srcset,
    sizes: (value) => value === INLINE_SIZES,
    width: isInteger(1, 99_999),
    height: isInteger(1, 99_999),
    loading: (value) => value === "lazy" || value === "eager",
    decoding: (value) => value === "async" || value === "sync" || value === "auto",
    classname: classes(IMAGE_CLASSES),
    class: classes(IMAGE_CLASSES),
  },
  span: { classname: classes(IMAGE_WRAPPER_CLASSES), class: classes(IMAGE_WRAPPER_CLASSES) },
  code: { classname: classes(LANGUAGE), class: classes(LANGUAGE) },
  ul: { classname: classes(["contains-task-list"]), class: classes(["contains-task-list"]) },
  ol: { classname: classes(["contains-task-list"]), class: classes(["contains-task-list"]), start: isInteger(0, 999_999) },
  li: { classname: classes(["task-list-item"]), class: classes(["task-list-item"]), id: (value) => typeof value === "string" && FOOTNOTE_ID.test(value) },
  th: { align },
  td: { align },
  input: { type: (value) => value === "checkbox", checked: isFlag, disabled: isFlag },
  section: { classname: classes(["footnotes"]), class: classes(["footnotes"]), datafootnotes: isFlag },
  h2: { classname: classes(["sr-only"]), class: classes(["sr-only"]), id: (value) => typeof value === "string" && FOOTNOTE_ID.test(value) },
};

const canonical = (name: string) => name.toLowerCase().replace(/[-_]/g, "");

function cleanProperties(node: Element, stats: SanitizeStats): void {
  const rules = ATTRIBUTES[node.tagName] ?? {};
  const properties = node.properties ?? {};
  for (const name of Object.keys(properties)) {
    const rule = rules[canonical(name)];
    const verdict = rule ? rule(properties[name], node) : false;
    if (verdict === true) continue;
    stats.removed += 1;
    if (verdict === false) {
      delete properties[name];
    } else {
      // A class list with some tokens removed: keep the attribute with what is allowed.
      properties[name] = verdict.replace as never;
    }
  }
  node.properties = properties;
}

const isAbsoluteWebUrl = (value: string) => /^https?:\/\//i.test(value);

function cleanElement(node: Element, stats: SanitizeStats): ElementContent[] {
  const tag = node.tagName.toLowerCase();
  node.tagName = tag;
  if (DROPPED_WITH_CONTENT.has(tag)) {
    stats.removed += 1;
    return [];
  }
  const children = cleanNodes(node.children, stats) as ElementContent[];
  if (!TAGS.has(tag)) {
    // Unknown element: its tags go, its words stay.
    stats.removed += 1;
    return children;
  }
  node.children = VOID.has(tag) ? [] : children;
  cleanProperties(node, stats);
  const properties = node.properties ?? {};

  if (tag === "a") {
    const href = properties.href;
    if (!isSafeLinkHref(href)) {
      // A link with no safe address is text.
      stats.removed += 1;
      return node.children;
    }
    // `target` only for a link that leaves the site; `rel` on every link.
    if (properties.target !== undefined && !isAbsoluteWebUrl(href)) delete properties.target;
    properties.rel = ["noopener", "noreferrer"];
  }
  if (tag === "img") {
    if (!isSafeImageSrc(properties.src)) {
      stats.removed += 1;
      return [];
    }
    if (properties.alt === undefined) properties.alt = "";
    // Both dimensions or neither: one alone would distort the picture.
    if ((properties.width === undefined) !== (properties.height === undefined)) {
      delete properties.width;
      delete properties.height;
    }
  }
  if (tag === "span") {
    // Only the wrapper of an inline picture is a span (cleanProperties kept its classes only if they were ours).
    if (properties.className === undefined && properties.class === undefined) {
      stats.removed += 1;
      return node.children;
    }
    // A wrapper that lost its picture is not worth keeping.
    if (node.children.length === 0) {
      stats.removed += 1;
      return [];
    }
  }
  if (tag === "input" && properties.type !== "checkbox") {
    stats.removed += 1;
    return [];
  }
  return [node];
}

function cleanNodes(nodes: (RootContent | ElementContent)[], stats: SanitizeStats): (RootContent | ElementContent)[] {
  const out: (RootContent | ElementContent)[] = [];
  for (const node of nodes) {
    if (node.type === "text") out.push(node);
    else if (node.type === "element") out.push(...cleanElement(node, stats));
    else stats.removed += 1; // comments, doctype, `raw` (HTML that someone let through), anything else
  }
  return out;
}

/** Cleans `tree` in place (and returns it). Exported for the tests, which feed it trees a markdown parser would never make. */
export function sanitizeTree(tree: Root, stats: SanitizeStats = { removed: 0 }): Root {
  tree.children = cleanNodes(tree.children, stats) as Root["children"];
  return tree;
}
