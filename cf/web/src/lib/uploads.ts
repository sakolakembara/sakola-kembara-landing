// Where an upload lives for a visitor.
//
// Files and images the admin uploads sit in R2 and are served from a SEPARATE public
// domain (no Worker request per download, no redeploy after an upload). The API keeps
// their paths root-relative (`/uploads/<kind>/<year>/<id>-<name>.<ext>`, see
// docs/cloudflare/uploads.md) and this site puts the domain in front when it renders:
//
//   uploadUrl(path, base)             one image or file path from the API: team photo,
//                                     report and document file, blog cover
//   rewriteUploadsInHtml(html, base)  the `src`, `href`, `srcset` and `poster` attributes
//                                     inside an article's `contentHtml`
//
// `base` is the Worker variable UPLOADS_BASE_URL: an origin such as `https://files.example.org`
// without a trailing slash (a trailing slash is tolerated and dropped). Empty or unset (local
// dev, tests, the fixture API) leaves everything exactly as it is: same strings, byte-identical
// HTML, same-origin paths. A value that is not an http(s) origin is treated as unset, so a typo
// can break images but can never put a `javascript:` URL or a quote into an attribute.
//
// Only paths that start with `/uploads/` are touched. The legacy static paths the Worker serves
// as assets (`/blog/images/...`, `/files/...`, `/images/...`), absolute URLs and everything else
// come back unchanged. No HTML parser: a single linear scan over the tags, so the cost grows
// with the length of the article and nothing can make it slower than that.

/** The one prefix the admin uploads live under. */
export const UPLOADS_PREFIX = '/uploads/';

/** An http(s) origin: scheme, host, optional port. No path, query, userinfo, quote, angle bracket or space. */
const ORIGIN = /^https?:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/;

/** The usable base (no trailing slash), or '' when there is none. */
export function uploadsBase(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  return ORIGIN.test(trimmed) ? trimmed : '';
}

/** What a path may contain to be rewritten: no whitespace, control character, backslash, `..` segment, `?` or `#`. */
const SAFE_UPLOAD_PATH = /^(?!.*\/\.\.(?:\/|$))\/uploads\/[^\s\\?#\u0000-\u001f]+$/;

/** `base` + `path` for an upload path, `path` itself for anything else or without a base. */
export function uploadUrl(path: string, base: string | undefined | null): string;
export function uploadUrl(path: string | null, base: string | undefined | null): string | null;
export function uploadUrl(path: string | null, base: string | undefined | null): string | null {
  if (path === null) return null;
  const origin = uploadsBase(base);
  if (!origin || !SAFE_UPLOAD_PATH.test(path)) return path;
  return `${origin}${path}`;
}

/** Attributes whose value is a single URL. `data-*` and every other attribute are left alone. */
const URL_ATTRIBUTES = new Set(['src', 'href', 'poster']);

/** In a srcset, a candidate starts at the beginning or after a comma; only a candidate that is an upload path is prefixed. */
const SRCSET_UPLOAD_CANDIDATE = /(^|,)(\s*)(\/uploads\/[^\s,]+)/g;

function rewriteSrcset(value: string, origin: string): string {
  return value.replace(SRCSET_UPLOAD_CANDIDATE, (match: string, lead: string, space: string, path: string) => {
    return SAFE_UPLOAD_PATH.test(path) ? `${lead}${space}${origin}${path}` : match;
  });
}

const LETTER = /[A-Za-z]/;
const isSpace = (ch: string | undefined) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';

/**
 * Prefixes the upload paths in the `src`, `href`, `poster` and `srcset` attributes of the tags in
 * `html`. Text is never touched: `src="/uploads/x.png"` written inside a code block or a
 * paragraph (where the `<` of the tag is escaped as `&lt;`) is not an attribute and stays as it is,
 * and so does a comment. A tag that never ends (an unclosed quote, no `>` before the end of a cut-off
 * article) stops the scan: what was read before the cut is rewritten, the rest comes back unchanged.
 */
export function rewriteUploadsInHtml(html: string, base: string | undefined | null): string {
  const origin = uploadsBase(base);
  // Nothing to do, and no copy of the string: the same value comes back.
  if (!origin || !html.includes(UPLOADS_PREFIX)) return html;

  let out = '';
  let copied = 0; // html[0, copied) is already in `out`
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    // An opening tag: `<` and a letter. A closing tag, `<!doctype>`, `<?` or a stray `<` is skipped.
    if (!LETTER.test(html[lt + 1] ?? '')) {
      i = lt + 1;
      continue;
    }

    // Tag name.
    let p = lt + 1;
    while (p < html.length && !isSpace(html[p]) && html[p] !== '>' && html[p] !== '/') p++;

    // Attributes.
    let closed = false;
    while (p < html.length) {
      while (p < html.length && (isSpace(html[p]) || html[p] === '/')) p++;
      if (html[p] === '>') {
        closed = true;
        p++;
        break;
      }
      if (p >= html.length) break;

      const nameStart = p;
      while (p < html.length && !isSpace(html[p]) && html[p] !== '=' && html[p] !== '>' && html[p] !== '/') p++;
      const name = html.slice(nameStart, p).toLowerCase();
      while (p < html.length && isSpace(html[p])) p++;
      if (html[p] !== '=') continue; // a boolean attribute (`download`, `loading`)
      p++;
      while (p < html.length && isSpace(html[p])) p++;

      let valueStart = p;
      let valueEnd: number;
      const quote = html[p];
      if (quote === '"' || quote === "'") {
        valueStart = p + 1;
        valueEnd = html.indexOf(quote, valueStart);
        if (valueEnd === -1) {
          p = html.length; // an unclosed quote: the tag never ends
          break;
        }
        p = valueEnd + 1;
      } else {
        while (p < html.length && !isSpace(html[p]) && html[p] !== '>') p++;
        valueEnd = p;
      }

      const value = html.slice(valueStart, valueEnd);
      let rewritten = value;
      if (URL_ATTRIBUTES.has(name)) rewritten = uploadUrl(value, origin);
      else if (name === 'srcset') rewritten = rewriteSrcset(value, origin);
      if (rewritten !== value) {
        out += html.slice(copied, valueStart) + rewritten;
        copied = valueEnd;
      }
    }

    if (!closed) break;
    i = p;
  }

  return copied === 0 ? html : out + html.slice(copied);
}
