// SEO parity: the pure part. No network, no file system, no clock: HTML in, findings out, so every rule
// can be unit-tested with strings (tests/seo-parity.test.ts) and the same code runs in the CLI
// (scripts/seo-parity.mjs) against the live site and a candidate.
//
// What it does, in order:
//   1. extractPage(html, headers)   reads the SEO surface of one HTML page (title, description, canonical,
//                                   robots, Open Graph, Twitter, h1, JSON-LD, hreflang, lang).
//   2. classifyPair(live, cand)     compares what the live site answered with what the candidate answered
//                                   for the same path and returns findings: BLOCKER, WARN or INFO.
//   3. runParity(...)               walks a list of paths through two "sources" (see seo-parity-sources.mjs),
//                                   checks robots.txt and the candidate sitemap, and returns a result object.
//   4. renderMarkdown / toJson      the two report formats.
//
// Rules of the severity table live in SEVERITY below and are described for humans in
// docs/cloudflare/seo-audit.md; a test keeps the two in step.

export const TOOL_NAME = 'SakemSeoParity';
export const TOOL_VERSION = '1.0';
export const DOCS_URL = 'https://github.com/sakolakembara/sakola-kembara-landing/blob/cloudflare/docs/cloudflare/seo-audit.md';
export const USER_AGENT = `${TOOL_NAME}/${TOOL_VERSION} (+${DOCS_URL})`;

export const BLOCKER = 'BLOCKER';
export const WARN = 'WARN';
export const INFO = 'INFO';

/** Every finding code, its severity and a one-line meaning. Order is the order of the report's legend. */
export const SEVERITY = {
  // BLOCKER: do not cut over with one of these on a URL that ranks.
  'status-mismatch': { severity: BLOCKER, text: 'the live URL answers 200 and the candidate does not end in a 200 (5xx, other 4xx, timeout, network error, a redirect that leaves the site)' },
  'url-missing': { severity: BLOCKER, text: 'the live URL answers 200 and the candidate answers 404 or 410, with no redirect or only a trailing-slash fold' },
  'redirect-to-missing': { severity: BLOCKER, text: 'the candidate redirects the live URL somewhere that answers 404 or 410' },
  'redirect-loop': { severity: BLOCKER, text: 'the candidate redirects in a loop or through more than 10 hops' },
  'canonical-missing': { severity: BLOCKER, text: 'the candidate page has no <link rel="canonical">' },
  'canonical-other-url': { severity: BLOCKER, text: 'the candidate canonical points at a different URL than the page itself' },
  'canonical-host': { severity: BLOCKER, text: 'the candidate canonical is on another host than the live canonical (a staging host, or www against apex)' },
  'noindex-introduced': { severity: BLOCKER, text: 'the candidate says noindex (meta robots, googlebot or X-Robots-Tag) and the live page does not' },
  'robots-txt-blocks-url': { severity: BLOCKER, text: 'the candidate robots.txt disallows a URL that the live robots.txt allows' },
  'robots-txt-blocks-all': { severity: BLOCKER, text: 'the candidate robots.txt disallows the whole site' },
  'candidate-sitemap-unavailable': { severity: BLOCKER, text: 'the candidate sitemap does not answer 200 with a list of URLs' },
  // WARN: a change a person should look at and either accept or fix.
  'title-changed': { severity: WARN, text: '<title> differs (more than the site-name suffix)' },
  'description-changed': { severity: WARN, text: 'meta description differs' },
  'description-missing': { severity: WARN, text: 'the live page has a meta description and the candidate does not' },
  'jsonld-type-dropped': { severity: WARN, text: 'a rich-result JSON-LD type of the live page is missing on the candidate (Article, BreadcrumbList, FAQ, Event, ...; Organization only counts on the home page)' },
  'jsonld-field-changed': { severity: WARN, text: 'headline, datePublished or dateModified of the JSON-LD differs' },
  'jsonld-invalid': { severity: WARN, text: 'a JSON-LD block of the candidate is not valid JSON' },
  'h1-missing': { severity: WARN, text: 'the live page has an <h1> and the candidate has none' },
  'h1-multiple': { severity: WARN, text: 'the candidate has more than one <h1> and the live page has one' },
  'og-missing': { severity: WARN, text: 'an Open Graph tag the live page has (title, description, image, url, type) is missing on the candidate' },
  'og-url-mismatch': { severity: WARN, text: 'the candidate og:url is not its canonical URL' },
  'twitter-card-missing': { severity: WARN, text: 'the live page has twitter:card and the candidate does not' },
  'hreflang-dropped': { severity: WARN, text: 'the live page has hreflang alternates and the candidate has fewer' },
  'lang-changed': { severity: WARN, text: '<html lang> changed to another language' },
  'nofollow-introduced': { severity: WARN, text: 'the candidate robots say nofollow and the live page does not' },
  'redirect-temporary': { severity: WARN, text: 'the candidate reaches the final URL through a 302, 303 or 307' },
  'redirect-chain': { severity: WARN, text: 'the candidate needs more than one redirect hop' },
  'live-redirect-dropped': { severity: WARN, text: 'the live URL redirects somewhere and the candidate serves a page at that address with no redirect (a duplicate, and the old redirect equity is lost)' },
  'not-in-candidate-sitemap': { severity: WARN, text: 'the live sitemap lists the URL and the candidate sitemap does not list its final URL' },
  'staging-host-leak': { severity: WARN, text: 'og:url, og:image, hreflang or JSON-LD of the candidate names the candidate host instead of the site' },
  'soft-404-suspect': { severity: WARN, text: 'the candidate answers 200 with a "not found" title or heading' },
  'content-type-changed': { severity: WARN, text: 'a live file (not HTML) is served with another content type' },
  'amp-link-live': { severity: WARN, text: 'the live page advertises an AMP version: check that the AMP URL redirects' },
  // INFO: benign or expected.
  'address-moved': { severity: INFO, text: 'the candidate redirects the live URL permanently (301 or 308) to a different address that answers 200' },
  'redirect-shape-changed': { severity: INFO, text: 'same final address, different redirects (for example the trailing slash is folded)' },
  'title-suffix-changed': { severity: INFO, text: 'the title differs only in the site-name suffix or its separator' },
  'jsonld-type-added': { severity: INFO, text: 'the candidate has a JSON-LD type the live page lacks' },
  'jsonld-structural-dropped': { severity: INFO, text: 'a structural JSON-LD type (WebPage, WebSite, ImageObject, Person, ...) is not on the candidate' },
  'jsonld-minor-field-changed': { severity: INFO, text: 'another JSON-LD field differs (url, author, image, language)' },
  'h1-text-changed': { severity: INFO, text: '<h1> text differs' },
  'og-changed': { severity: INFO, text: 'an Open Graph or Twitter value differs (not the presence)' },
  'lang-region-changed': { severity: INFO, text: '<html lang> differs only in the region (id-ID against id)' },
  'robots-meta-changed': { severity: INFO, text: 'the robots meta directives differ (and neither side says noindex)' },
  'description-added': { severity: INFO, text: 'the candidate has a meta description the live page lacks' },
  'served-where-live-404': { severity: INFO, text: 'the live URL answers 404 or 410 and the candidate serves a page' },
  'live-not-200': { severity: INFO, text: 'the live URL does not end in a 200 (redirect to an error, 4xx, 5xx): there is no baseline to compare' },
  'live-unreachable': { severity: INFO, text: 'the live URL could not be fetched (timeout or network error): not compared' },
  'skipped-by-robots': { severity: INFO, text: 'robots.txt of the live site disallows the URL for this tool: not fetched' },
};

export const SEVERITY_ORDER = { [BLOCKER]: 0, [WARN]: 1, [INFO]: 2 };

/** JSON-LD types whose loss can cost a rich result. Everything else that is dropped is INFO. */
export const RICH_TYPE_FAMILIES = new Set(['article', 'breadcrumblist', 'organization', 'faqpage', 'event', 'product', 'jobposting', 'videoobject', 'course', 'localbusiness', 'itemlist', 'recipe', 'review', 'howto']);

const ARTICLE_TYPES = new Set(['article', 'newsarticle', 'blogposting', 'techarticle', 'report', 'scholarlyarticle']);
const ORGANIZATION_TYPES = new Set(['organization', 'ngo', 'educationalorganization', 'nonprofitorganization', 'corporation', 'collegeoruniversity', 'school', 'localbusiness']);

/** Normalised family of a JSON-LD @type, so Article/NewsArticle/BlogPosting count as one and NGO as an Organization. */
export function typeFamily(type) {
  const t = String(type).toLowerCase();
  if (ARTICLE_TYPES.has(t)) return 'article';
  if (ORGANIZATION_TYPES.has(t)) return 'organization';
  return t;
}

// ---------------------------------------------------------------- text and HTML helpers

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©',
  middot: '·', bull: '•', times: '×',
};

export function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Decoded, whitespace collapsed, trimmed. The form every text comparison uses. */
export function normText(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function parseAttrs(source) {
  const out = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

const TAG_RE = /<(meta|link|html)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

function ldNodes(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) ldNodes(item, out);
  } else if (value && typeof value === 'object') {
    if (Array.isArray(value['@graph'])) {
      if (value['@type']) out.push(value);
      ldNodes(value['@graph'], out);
    } else {
      out.push(value);
    }
  }
  return out;
}

function firstString(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return firstString(v[0]);
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return firstString(v.url ?? v['@id'] ?? v.name ?? null);
  return String(v);
}

function personName(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return personName(v[0]);
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return typeof v.name === 'string' ? v.name : null;
  return null;
}

/** The fields of a JSON-LD node the comparison looks at. */
function ldFields(node) {
  return {
    headline: typeof node.headline === 'string' ? normText(node.headline) : null,
    name: typeof node.name === 'string' ? normText(node.name) : null,
    url: firstString(node.url) ?? firstString(node.mainEntityOfPage),
    datePublished: typeof node.datePublished === 'string' ? node.datePublished : null,
    dateModified: typeof node.dateModified === 'string' ? node.dateModified : null,
    author: personName(node.author),
    image: firstString(node.image),
    inLanguage: typeof node.inLanguage === 'string' ? node.inLanguage : null,
  };
}

/**
 * @typedef {{ nodes: { types: string[], families: string[], fields: Record<string, string | null> }[], errors: number, types: string[] }} JsonLd
 * @typedef {{ lang: string | null, title: string | null, description: string | null, canonical: { href: string, count: number } | null,
 *   robots: { robots: string | null, googlebot: string | null, xRobotsTag: string | null }, og: Record<string, string>, twitter: Record<string, string>,
 *   h1: string[], jsonld: JsonLd, hreflang: { hreflang: string, href: string }[], amphtml: string | null }} PageSeo
 */

/**
 * Reads the SEO surface of one HTML document. Tolerant on purpose: attribute order, quote style, entities,
 * comments and scripts are handled, and nothing throws on bad HTML.
 * @param {string} html
 * @param {{ headers?: Record<string, string> }} [opts]
 * @returns {PageSeo}
 */
export function extractPage(html, { headers = {} } = {}) {
  const source = String(html ?? '');
  const ldBlocks = [];
  let doc = source.replace(/<!--[\s\S]*?-->/g, '');
  doc = doc.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_m, attrs, body) => {
    if (/ld\+json/i.test(attrs)) ldBlocks.push(body);
    return '';
  });
  doc = doc.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');

  const headEnd = doc.search(/<\/head\s*>/i);
  const head = headEnd >= 0 ? doc.slice(0, headEnd) : doc;
  const titleMatch = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);

  const metaName = {};
  const metaProp = {};
  const canonicals = [];
  const hreflang = [];
  let amphtml = null;
  let lang = null;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(doc))) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);
    if (tag === 'html') {
      if (lang === null && attrs.lang !== undefined) lang = attrs.lang.trim();
    } else if (tag === 'meta') {
      const content = attrs.content;
      if (content === undefined) continue;
      if (attrs.name !== undefined) {
        const key = attrs.name.toLowerCase();
        if (!(key in metaName)) metaName[key] = content;
      }
      if (attrs.property !== undefined) {
        const key = attrs.property.toLowerCase();
        if (!(key in metaProp)) metaProp[key] = content;
      }
    } else if (tag === 'link') {
      const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      if (rel.includes('canonical') && attrs.href !== undefined) canonicals.push(attrs.href.trim());
      if (rel.includes('amphtml') && attrs.href !== undefined && amphtml === null) amphtml = attrs.href.trim();
      if (rel.includes('alternate') && attrs.hreflang !== undefined && attrs.href !== undefined) hreflang.push({ hreflang: attrs.hreflang.toLowerCase(), href: attrs.href.trim() });
    }
  }

  /** @type {Record<string, string>} */
  const og = {};
  /** @type {Record<string, string>} */
  const twitter = {};
  for (const [k, v] of Object.entries(metaProp)) {
    if (k.startsWith('og:')) og[k.slice(3)] = normText(v);
    if (k.startsWith('twitter:')) twitter[k.slice(8)] = normText(v);
  }
  for (const [k, v] of Object.entries(metaName)) {
    if (k.startsWith('twitter:') && !(k.slice(8) in twitter)) twitter[k.slice(8)] = normText(v);
    if (k.startsWith('og:') && !(k.slice(3) in og)) og[k.slice(3)] = normText(v);
  }

  const h1 = [];
  const h1Re = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi;
  while ((m = h1Re.exec(doc))) {
    const text = normText(m[1].replace(/<[^>]*>/g, ' '));
    if (text) h1.push(text);
  }

  const nodes = [];
  let ldErrors = 0;
  for (const block of ldBlocks) {
    try {
      for (const node of ldNodes(JSON.parse(block.trim()))) {
        const raw = node['@type'];
        const types = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((t) => typeof t === 'string');
        if (types.length) nodes.push({ types, families: [...new Set(types.map(typeFamily))], fields: ldFields(node) });
      }
    } catch {
      ldErrors += 1;
    }
  }

  const xRobots = headers['x-robots-tag'] ?? null;
  return {
    lang,
    title: titleMatch ? normText(titleMatch[1]) : null,
    description: metaName.description !== undefined ? normText(metaName.description) : null,
    canonical: canonicals.length ? { href: canonicals[0], count: canonicals.length } : null,
    robots: { robots: metaName.robots ?? null, googlebot: metaName.googlebot ?? null, xRobotsTag: xRobots },
    og,
    twitter,
    h1,
    jsonld: { nodes, errors: ldErrors, types: [...new Set(nodes.flatMap((n) => n.types))].sort() },
    hreflang,
    amphtml,
  };
}

// ---------------------------------------------------------------- URLs and paths

/** Path (and query) in a form two answers can be compared in: no duplicate slashes, no trailing slash (except "/"), upper-case %XX. */
export function pathKey(pathAndSearch) {
  const raw = String(pathAndSearch || '/');
  const q = raw.indexOf('?');
  let path = q >= 0 ? raw.slice(0, q) : raw;
  const search = q >= 0 ? raw.slice(q) : '';
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/%[0-9a-f]{2}/gi, (x) => x.toUpperCase());
  return `${path}${search === '?' ? '' : search}`;
}

/** "path?query" of an absolute URL on one of the given hosts, else null. */
export function sitePath(url, hosts) {
  try {
    const u = new URL(url);
    return hosts.has(u.host.toLowerCase()) ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

/** The host plus its www or apex twin: the hosts a redirect may stay on. */
export function siteHosts(baseUrl, extra = []) {
  const host = new URL(baseUrl).host.toLowerCase();
  const twin = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  const hosts = new Set([host]);
  if (!/^[\d.]+(:\d+)?$/.test(host) && !host.startsWith('[') && !host.startsWith('localhost') && !host.startsWith('127.')) hosts.add(twin);
  for (const h of extra) hosts.add(String(h).toLowerCase());
  return hosts;
}

export function isLoopbackUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- robots.txt, sitemaps, url lists

/** Minimal robots.txt parser: groups of user agents with allow/disallow rules, and Sitemap lines. */
export function parseRobotsTxt(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === 'sitemap') sitemaps.push(value);
    else if ((field === 'allow' || field === 'disallow') && current) current.rules.push({ allow: field === 'allow', path: value });
  }
  return { groups, sitemaps };
}

function ruleMatches(rulePath, path) {
  if (rulePath === '') return false;
  const endsWithDollar = rulePath.endsWith('$');
  const body = endsWithDollar ? rulePath.slice(0, -1) : rulePath;
  const re = new RegExp(`^${body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${endsWithDollar ? '$' : ''}`);
  return re.test(path);
}

/** Whether `ua` may fetch `path` (with query). Longest matching rule wins, allow wins a tie, the group of the UA's own name beats "*". */
export function robotsAllows(parsed, ua, path) {
  if (!parsed) return true;
  const product = String(ua).toLowerCase().split(/[\s/]/)[0];
  const own = parsed.groups.filter((g) => g.agents.some((a) => a !== '*' && product.includes(a)));
  const groups = own.length ? own : parsed.groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const g of groups) {
    for (const r of g.rules) {
      if (!ruleMatches(r.path, path)) continue;
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}

/** Whether robots.txt shuts the whole site for `ua` (`Disallow: /` and no longer allow). */
export function robotsBlocksAll(parsed, ua) {
  return parsed ? !robotsAllows(parsed, ua, '/') && !robotsAllows(parsed, ua, '/blog') : false;
}

/** `<urlset>` or `<sitemapindex>` into { kind, entries: [{ loc, lastmod }] }. */
export function parseSitemap(xml) {
  const text = String(xml ?? '');
  const kind = /<sitemapindex\b/i.test(text) ? 'index' : /<urlset\b/i.test(text) ? 'urlset' : 'unknown';
  const entries = [];
  const re = kind === 'index' ? /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap\s*>/gi : /<url\b[^>]*>([\s\S]*?)<\/url\s*>/gi;
  let m;
  while ((m = re.exec(text))) {
    const loc = m[1].match(/<loc\b[^>]*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/loc\s*>/i);
    if (!loc) continue;
    const lastmod = m[1].match(/<lastmod\b[^>]*>\s*([^<]*?)\s*<\/lastmod\s*>/i);
    const images = [...m[1].matchAll(/<image:loc\b[^>]*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/image:loc\s*>/gi)].map((x) => decodeEntities((x[1] ?? x[2] ?? '').trim()));
    entries.push({ loc: decodeEntities((loc[1] ?? loc[2] ?? '').trim()), lastmod: lastmod ? lastmod[1] : null, images });
  }
  return { kind, entries };
}

/** One path or URL per line, `#` comments and blank lines ignored. Returns paths ("/x?y"), URLs on other hosts are dropped with a note. */
export function parseUrlList(text, hosts) {
  const paths = [];
  const ignored = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('/')) {
      paths.push(line);
      continue;
    }
    const p = sitePath(line, hosts);
    if (p) paths.push(p);
    else ignored.push(line);
  }
  return { paths, ignored };
}

const FIDELITY = { main: 0, 'wp-id': 1, extra: 1, article: 2, sitemap: 3, image: 3 };

/**
 * The ordered, de-duplicated list of paths to compare. Order: main pages, the extra list, the article URLs,
 * the WordPress ?p=<id> shortlinks, then the live sitemap(s) (and images). The same address in two sources is one
 * entry; the spelling of the most faithful source wins (a sitemap URL is the live canonical form, with its trailing slash).
 * @param {{ mainPaths?: string[], extraPaths?: string[], articlePaths?: string[], wpIdPaths?: string[], sitemapPaths?: string[], imagePaths?: string[], max?: number }} args
 */
export function buildUrlSet({ mainPaths = [], extraPaths = [], articlePaths = [], wpIdPaths = [], sitemapPaths = [], imagePaths = [], max = Infinity }) {
  const byKey = new Map();
  const add = (paths, source) => {
    for (const path of paths) {
      const key = pathKey(path);
      const hit = byKey.get(key);
      if (!hit) byKey.set(key, { path, source, sources: new Set([source]), inLiveSitemap: source === 'sitemap' });
      else {
        hit.sources.add(source);
        if (source === 'sitemap') hit.inLiveSitemap = true;
        if (FIDELITY[source] > FIDELITY[hit.source]) {
          hit.path = path;
          hit.source = source;
        }
      }
    }
  };
  add(mainPaths, 'main');
  add(extraPaths, 'extra');
  add(articlePaths, 'article');
  add(wpIdPaths, 'wp-id');
  add(sitemapPaths, 'sitemap');
  add(imagePaths, 'image');
  const all = [...byKey.values()].map((e) => ({ path: e.path, source: e.source, inLiveSitemap: e.inLiveSitemap, sources: [...e.sources] }));
  const urls = Number.isFinite(max) ? all.slice(0, Math.max(0, max)) : all;
  return { urls, total: all.length, truncated: all.length - urls.length };
}

// ---------------------------------------------------------------- comparison

const hasToken = (value, token) => String(value ?? '').toLowerCase().split(/[\s,]+/).some((t) => t === token || t.endsWith(`:${token}`));

/** noindex or none, in any of the three places. */
function noindexOf(page) {
  const r = page?.robots ?? {};
  return [r.robots, r.googlebot, r.xRobotsTag].some((v) => hasToken(v, 'noindex') || hasToken(v, 'none'));
}
function nofollowOf(page) {
  const r = page?.robots ?? {};
  return [r.robots, r.googlebot, r.xRobotsTag].some((v) => hasToken(v, 'nofollow') || hasToken(v, 'none'));
}

const stripSuffix = (title, siteName) => {
  const escaped = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`\\s*[-–—|·:]\\s*${escaped}.*$`, 'i'), '').replace(new RegExp(`^${escaped}\\s*[-–—|·:]\\s*`, 'i'), '').trim();
};

const looksNotFound = (text) => /tidak ditemukan|page not found|not found|\b404\b/i.test(text ?? '');

/** Summary of one side's answer for the report: no bodies. */
export function summarizeSide(rec, hosts, page) {
  if (!rec) return null;
  const chain = (rec.hops ?? []).map((h) => ({ status: h.status, from: sitePath(h.url, hosts) ?? h.url, to: normalizeLocation(h.location, h.url, hosts) }));
  const final = rec.final ? { status: rec.final.status, url: rec.final.url, path: sitePath(rec.final.url, hosts), contentType: rec.final.contentType ?? '' } : null;
  return { requested: rec.url, skipped: rec.skipped ?? null, error: rec.error ?? null, chain, final, page: page ?? null, ms: rec.ms ?? null };
}

export function normalizeLocation(location, from, hosts) {
  if (!location) return null;
  try {
    const abs = new URL(location, from).toString();
    return sitePath(abs, hosts) ?? abs;
  } catch {
    return location;
  }
}

const isHtml = (side) => /text\/html|application\/xhtml\+xml/i.test(side?.final?.contentType ?? '');

/**
 * Findings for one path, from the two summarised answers.
 *
 * @param {object} live       summarizeSide() of the live answer
 * @param {object} cand       summarizeSide() of the candidate answer
 * @param {{ inLiveSitemap?: boolean, candidateSitemap?: Set<string> | null, siteName?: string,
 *           canonicalHost?: string | null, liveHost: string, candidateHost: string }} ctx
 * @returns {{ severity: string, code: string, message: string, live?: unknown, candidate?: unknown }[]}
 */
export function classifyPair(live, cand, ctx) {
  const findings = [];
  const add = (code, message, extra = {}) => findings.push({ severity: SEVERITY[code].severity, code, message, ...extra });
  const siteName = ctx.siteName ?? 'Sakola Kembara';

  if (live.skipped === 'robots') {
    add('skipped-by-robots', 'robots.txt of the live site disallows this path for this tool');
    return findings;
  }
  if (live.error && !live.final) {
    add('live-unreachable', `live: ${live.error}`);
    return findings;
  }

  const liveFinal = live.final;
  if (!liveFinal || liveFinal.status !== 200) {
    if (liveFinal && (liveFinal.status === 404 || liveFinal.status === 410)) {
      if (cand.final && cand.final.status === 200) {
        add('served-where-live-404', `live ${liveFinal.status}, candidate 200 at ${cand.final.path ?? cand.final.url}`);
        if (isHtml(cand) && cand.page && (looksNotFound(cand.page.title) || looksNotFound(cand.page.h1?.[0]))) add('soft-404-suspect', `candidate title or heading says "not found" with a 200: ${cand.page.title ?? cand.page.h1?.[0]}`);
      }
    } else {
      add('live-not-200', `live ends in ${liveFinal ? liveFinal.status : live.error ?? 'no response'}`);
    }
    return findings;
  }

  // The live URL is a 200. From here a candidate that does not end in a 200 is a problem.
  if (cand.skipped === 'robots') {
    add('robots-txt-blocks-url', 'the candidate robots.txt disallows this path (not fetched)');
    return findings;
  }
  if (cand.error === 'redirect-loop' || cand.error === 'too-many-redirects') {
    add('redirect-loop', `candidate: ${cand.error} after ${cand.chain.length} hop(s)`, { candidate: cand.chain });
    return findings;
  }
  if (cand.error && !cand.final) {
    add('status-mismatch', `live 200, candidate ${cand.error}`, { candidate: cand.chain });
    return findings;
  }
  const candFinal = cand.final;
  if (!candFinal) {
    add('status-mismatch', 'live 200, candidate gave no final response');
    return findings;
  }
  if (candFinal.status !== 200) {
    if (candFinal.status === 404 || candFinal.status === 410) {
      // A redirect that only folds the trailing slash or the case is not "a redirect somewhere": the URL is missing all the same.
      const requestedKey = pathKey(sitePathOf(cand.requested ?? ''));
      if (cand.chain.length === 0 || requestedKey === pathKey(candFinal.path ?? candFinal.url)) add('url-missing', `live 200, candidate ${candFinal.status}${cand.chain.length ? ` (after ${cand.chain.map((h) => h.status).join('>')}, the address folds to ${candFinal.path ?? candFinal.url})` : ' and no redirect'}`);
      else add('redirect-to-missing', `live 200, candidate redirects ${cand.chain.map((h) => h.status).join('>')} to ${candFinal.path ?? candFinal.url}, which answers ${candFinal.status}`, { candidate: cand.chain });
    } else {
      add('status-mismatch', `live 200, candidate ${candFinal.status}${cand.chain.length ? ` after ${cand.chain.length} redirect(s)` : ''}`, { candidate: cand.chain });
    }
    return findings;
  }

  // ---- both end in a 200: redirects first
  const liveKey = pathKey(liveFinal.path ?? liveFinal.url);
  const candKey = pathKey(candFinal.path ?? candFinal.url);
  const moved = liveKey !== candKey;
  const shape = (side) => JSON.stringify(side.chain.map((h) => [h.status, h.to && pathKey(h.to)]));
  if (!(shape(live) === shape(cand) && !moved)) {
    const statuses = cand.chain.map((h) => h.status);
    const permanent = statuses.every((s) => s === 301 || s === 308);
    if (statuses.some((s) => s === 302 || s === 303 || s === 307)) {
      add('redirect-temporary', `candidate reaches ${candFinal.path ?? candFinal.url} through ${statuses.join('>')}`, { candidate: cand.chain });
    }
    if (cand.chain.length > 1) add('redirect-chain', `candidate needs ${cand.chain.length} hops (${statuses.join('>')}) to reach ${candFinal.path ?? candFinal.url}`, { candidate: cand.chain });
    if (cand.chain.length === 0 && live.chain.length > 0 && moved) {
      add('live-redirect-dropped', `live redirects ${live.requested ? sitePathOf(live.requested) : '?'} to ${liveFinal.path ?? liveFinal.url}; the candidate serves ${candFinal.path ?? candFinal.url} at that address without a redirect`);
    } else if (moved && permanent && cand.chain.length === 1) add('address-moved', `${liveFinal.path ?? liveFinal.url} -> ${candFinal.path ?? candFinal.url} (${statuses[0]})`);
    else if (cand.chain.length <= 1 && !statuses.some((s) => [302, 303, 307].includes(s))) {
      add('redirect-shape-changed', `live: ${live.chain.length ? live.chain.map((h) => h.status).join('>') : 'no redirect'} to ${liveFinal.path ?? liveFinal.url}; candidate: ${statuses.length ? statuses.join('>') : 'no redirect'} to ${candFinal.path ?? candFinal.url}`);
    }
  }

  // The live URL redirects away and the candidate serves a page at it: the two pages are not the same page, so their
  // titles and tags are not compared (that is the live-redirect-dropped finding), only what the candidate page itself must satisfy.
  const compareContent = !(cand.chain.length === 0 && live.chain.length > 0 && moved);

  // ---- not HTML: only the content type is compared
  if (!isHtml(live) || !isHtml(cand)) {
    const lt = (liveFinal.contentType ?? '').split(';')[0].trim().toLowerCase();
    const ct = (candFinal.contentType ?? '').split(';')[0].trim().toLowerCase();
    if (lt && lt !== ct) add('content-type-changed', `live ${lt}, candidate ${ct || 'none'}`);
    return findings;
  }

  const lp = live.page ?? extractPage('');
  const cp = cand.page ?? extractPage('');

  // ---- indexing signals
  if (noindexOf(cp) && !noindexOf(lp)) add('noindex-introduced', `candidate: ${[cp.robots.robots, cp.robots.googlebot, cp.robots.xRobotsTag].filter(Boolean).join(' | ')}`);
  else if (nofollowOf(cp) && !nofollowOf(lp)) add('nofollow-introduced', `candidate: ${[cp.robots.robots, cp.robots.googlebot, cp.robots.xRobotsTag].filter(Boolean).join(' | ')}`);
  else if (compareContent && !noindexOf(cp) && normText(`${lp.robots.robots}|${lp.robots.googlebot}`) !== normText(`${cp.robots.robots}|${cp.robots.googlebot}`)) {
    add('robots-meta-changed', `live "${lp.robots.robots ?? ''}", candidate "${cp.robots.robots ?? ''}"`);
  }

  // ---- canonical
  const candidateIndexable = !noindexOf(cp);
  const liveCanonicalUrl = lp.canonical ? safeUrl(lp.canonical.href, liveFinal.url) : null;
  const candCanonicalUrl = cp.canonical ? safeUrl(cp.canonical.href, candFinal.url) : null;
  if (!cp.canonical) {
    if (candidateIndexable) add('canonical-missing', 'the candidate page has no canonical link');
  } else if (candCanonicalUrl) {
    const expectedHost = (ctx.canonicalHost || liveCanonicalUrl?.host || ctx.liveHost).toLowerCase();
    if (candCanonicalUrl.host.toLowerCase() !== expectedHost) {
      add('canonical-host', `candidate canonical host ${candCanonicalUrl.host}, expected ${expectedHost}`);
    } else if (candCanonicalUrl.protocol !== (liveCanonicalUrl?.protocol ?? 'https:')) {
      add('canonical-other-url', `candidate canonical uses ${candCanonicalUrl.protocol.replace(':', '')}, expected ${(liveCanonicalUrl?.protocol ?? 'https:').replace(':', '')}`);
    } else {
      const candCanonicalKey = pathKey(`${candCanonicalUrl.pathname}${candCanonicalUrl.search}`);
      // A canonical that drops the query string the page was reached with (?utm_source=, ?page=) is the normal case, not a different URL.
      const dropsQuery = !candCanonicalUrl.search && pathKey(candCanonicalUrl.pathname) === pathKey(String(candFinal.path ?? candFinal.url).split('?')[0]);
      if (candCanonicalKey !== candKey && !dropsQuery) {
        // The live page may canonicalise elsewhere on purpose; matching that is parity.
        const liveCanonicalKey = liveCanonicalUrl ? pathKey(`${liveCanonicalUrl.pathname}${liveCanonicalUrl.search}`) : null;
        if (liveCanonicalKey && liveCanonicalKey !== liveKey && liveCanonicalKey === candCanonicalKey) {
          // same deliberate target on both sides
        } else {
          add('canonical-other-url', `candidate canonical ${candCanonicalKey}, page is ${candKey}`);
        }
      }
    }
  }

  // ---- title and description
  if (compareContent && lp.title !== cp.title) {
    if (lp.title !== null && cp.title !== null && stripSuffix(lp.title, siteName) === stripSuffix(cp.title, siteName)) add('title-suffix-changed', `live "${lp.title}", candidate "${cp.title}"`);
    else add('title-changed', `live "${lp.title ?? ''}", candidate "${cp.title ?? ''}"`);
  }
  if (compareContent && lp.description !== cp.description) {
    if (lp.description && !cp.description) add('description-missing', `live "${clip(lp.description)}"`);
    else if (!lp.description && cp.description) add('description-added', `candidate "${clip(cp.description)}"`);
    else if (lp.description && cp.description) add('description-changed', `live "${clip(lp.description)}", candidate "${clip(cp.description)}"`);
  }

  // ---- headings
  if (!compareContent) {
    if (cp.h1.length > 1) add('h1-multiple', `candidate has ${cp.h1.length} h1`);
  } else if (lp.h1.length >= 1 && cp.h1.length === 0) add('h1-missing', `live "${clip(lp.h1[0])}"`);
  else if (cp.h1.length > 1 && lp.h1.length <= 1) add('h1-multiple', `candidate has ${cp.h1.length} h1`);
  else if (lp.h1.length && cp.h1.length && lp.h1[0] !== cp.h1[0]) add('h1-text-changed', `live "${clip(lp.h1[0])}", candidate "${clip(cp.h1[0])}"`);

  // ---- Open Graph and Twitter
  const missingOg = !compareContent ? [] : ['title', 'description', 'image', 'url', 'type'].filter((k) => lp.og[k] && !cp.og[k]);
  if (missingOg.length) add('og-missing', `missing on the candidate: ${missingOg.map((k) => `og:${k}`).join(', ')}`);
  const changedOg = !compareContent ? [] : ['title', 'description', 'image', 'url', 'type', 'site_name', 'locale'].filter((k) => lp.og[k] && cp.og[k] && lp.og[k] !== cp.og[k]);
  const changedTw = !compareContent ? [] : ['card', 'title', 'description', 'image'].filter((k) => lp.twitter[k] && cp.twitter[k] && lp.twitter[k] !== cp.twitter[k]);
  if (changedOg.length || changedTw.length) add('og-changed', [...changedOg.map((k) => `og:${k}`), ...changedTw.map((k) => `twitter:${k}`)].join(', '));
  if (compareContent && lp.twitter.card && !cp.twitter.card) add('twitter-card-missing', `live twitter:card is ${lp.twitter.card}`);
  if (cp.og.url && candCanonicalUrl) {
    const og = safeUrl(cp.og.url, candFinal.url);
    if (og && pathKey(`${og.pathname}${og.search}`) !== pathKey(`${candCanonicalUrl.pathname}${candCanonicalUrl.search}`)) add('og-url-mismatch', `og:url ${cp.og.url}, canonical ${cp.canonical.href}`);
  }

  // ---- JSON-LD
  if (cp.jsonld.errors) add('jsonld-invalid', `${cp.jsonld.errors} block(s) of JSON-LD on the candidate are not valid JSON`);
  const liveFamilies = new Map();
  for (const n of lp.jsonld.nodes) for (const f of n.families) if (!liveFamilies.has(f)) liveFamilies.set(f, n);
  const candFamilies = new Map();
  for (const n of cp.jsonld.nodes) for (const f of n.families) if (!candFamilies.has(f)) candFamilies.set(f, n);
  for (const [family, node] of compareContent ? liveFamilies : []) {
    if (!candFamilies.has(family)) {
      const label = node.types.join('/');
      // Organization markup matters on the home page (logo, name); on every other page its loss costs nothing a search result shows.
      if (RICH_TYPE_FAMILIES.has(family) && !(family === 'organization' && candKey !== '/')) add('jsonld-type-dropped', `live has ${label}, the candidate does not`);
      else add('jsonld-structural-dropped', `live has ${label}, the candidate does not`);
      continue;
    }
    const a = node.fields;
    const b = candFamilies.get(family).fields;
    const major = [];
    const minor = [];
    for (const key of ['headline', 'datePublished', 'dateModified']) {
      if (a[key] == null || b[key] == null) continue;
      const av = key.startsWith('date') ? a[key].slice(0, 10) : a[key];
      const bv = key.startsWith('date') ? b[key].slice(0, 10) : b[key];
      if (av !== bv) major.push(`${key}: "${clip(a[key])}" -> "${clip(b[key])}"`);
    }
    for (const key of ['name', 'url', 'author', 'image', 'inLanguage']) {
      if (key === 'url' && moved) continue;
      if (a[key] != null && b[key] != null && pathish(a[key]) !== pathish(b[key])) minor.push(key);
    }
    if (major.length) add('jsonld-field-changed', `${node.types.join('/')}: ${major.join('; ')}`);
    if (minor.length) add('jsonld-minor-field-changed', `${node.types.join('/')}: ${minor.join(', ')}`);
  }
  for (const [family, node] of candFamilies) if (compareContent && !liveFamilies.has(family)) add('jsonld-type-added', `candidate adds ${node.types.join('/')}`);

  // ---- hreflang, lang, AMP
  const liveAlt = new Set(lp.hreflang.map((h) => h.hreflang));
  const candAlt = new Set(cp.hreflang.map((h) => h.hreflang));
  const droppedAlt = [...liveAlt].filter((x) => !candAlt.has(x));
  if (compareContent && droppedAlt.length) add('hreflang-dropped', `not on the candidate: ${droppedAlt.join(', ')}`);
  if (!compareContent) {
    // not compared
  } else if (lp.lang && cp.lang && lp.lang.toLowerCase() !== cp.lang.toLowerCase()) {
    if (lp.lang.toLowerCase().split('-')[0] === cp.lang.toLowerCase().split('-')[0]) add('lang-region-changed', `live "${lp.lang}", candidate "${cp.lang}"`);
    else add('lang-changed', `live "${lp.lang}", candidate "${cp.lang}"`);
  } else if (lp.lang && !cp.lang) add('lang-changed', `live "${lp.lang}", candidate has no lang`);
  if (compareContent && lp.amphtml) add('amp-link-live', `live links ${lp.amphtml}`);

  // ---- candidate host leaking into tags that name URLs
  if (ctx.candidateHost && ctx.candidateHost !== (ctx.canonicalHost || liveCanonicalUrl?.host || ctx.liveHost)) {
    const leaks = [];
    const check = (label, value) => {
      const u = value ? safeUrl(value, candFinal.url) : null;
      if (u && u.host.toLowerCase() === ctx.candidateHost.toLowerCase()) leaks.push(label);
    };
    check('og:url', cp.og.url);
    check('og:image', cp.og.image);
    check('twitter:image', cp.twitter.image);
    for (const h of cp.hreflang) check('hreflang', h.href);
    for (const n of cp.jsonld.nodes) {
      check('JSON-LD url', n.fields.url);
      check('JSON-LD image', n.fields.image);
    }
    if (leaks.length) add('staging-host-leak', `names the candidate host: ${[...new Set(leaks)].join(', ')}`);
  }

  // ---- soft 404 and sitemap
  if (looksNotFound(cp.title) || looksNotFound(cp.h1[0])) add('soft-404-suspect', `candidate title or heading says "not found" with a 200: ${cp.title ?? cp.h1[0]}`);
  if (ctx.inLiveSitemap && ctx.candidateSitemap && candidateIndexable && !ctx.candidateSitemap.has(candKey)) add('not-in-candidate-sitemap', `${candFinal.path ?? candFinal.url} is not in the candidate sitemap`);

  return findings;
}

function sitePathOf(url) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
const clip = (s, n = 90) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const pathish = (s) => String(s).split('#')[0].replace(/\/+$/, '');
function safeUrl(href, base) {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

/** The worst severity of a list of findings, or "ok". */
export function verdictOf(findings) {
  if (findings.some((f) => f.severity === BLOCKER)) return 'blocker';
  if (findings.some((f) => f.severity === WARN)) return 'warn';
  if (findings.length) return 'info';
  return 'ok';
}

// ---------------------------------------------------------------- the run

/**
 * Walks the URL list through the two sources and classifies each pair.
 *
 * A source is `{ get(url) -> Promise<Answer>, base }`; an Answer is
 * `{ url, hops: [{ url, status, location }], final: { url, status, contentType, headers, body } | null, error?, skipped?, ms? }`.
 *
 * @param {{ live: any, candidate: any, urls: { path: string, source: string, inLiveSitemap?: boolean }[],
 *           liveRobots?: any, candidateRobots?: any, candidateSitemap?: Set<string> | null, ua?: string,
 *           siteName?: string, canonicalHost?: string | null, extraHosts?: string[], onProgress?: (i: number, n: number, path: string) => void }} args
 */
export async function compareUrls({ live, candidate, urls, liveRobots = null, candidateRobots = null, candidateSitemap = null, ua = USER_AGENT, siteName, canonicalHost = null, extraHosts = [], onProgress }) {
  const liveHosts = siteHosts(live.base, extraHosts);
  const candHosts = siteHosts(candidate.base, extraHosts);
  const liveHost = new URL(live.base).host.toLowerCase();
  const candidateHost = new URL(candidate.base).host.toLowerCase();
  const results = [];
  let i = 0;
  for (const entry of urls) {
    i += 1;
    onProgress?.(i, urls.length, entry.path);
    const liveUrl = join(live.base, entry.path);
    const candUrl = join(candidate.base, entry.path);
    const side = async (source, hosts, url, robots) => {
      if (!robotsAllows(robots, ua, entry.path)) return summarizeSide({ url, hops: [], final: null, skipped: 'robots' }, hosts, null);
      const answer = await source.get(url);
      const page = answer.final && /html/i.test(answer.final.contentType ?? '') ? extractPage(answer.final.body ?? '', { headers: answer.final.headers }) : null;
      return summarizeSide(answer, hosts, page);
    };
    const liveSide = await side(live, liveHosts, liveUrl, liveRobots);
    // The candidate is only asked when the live site answered something: with nothing to compare there is nothing to ask.
    const candSide = liveSide.skipped || !liveSide.final ? summarizeSide({ url: candUrl, hops: [], final: null }, candHosts, null) : await side(candidate, candHosts, candUrl, candidateRobots);
    const findings = classifyPair(liveSide, candSide, { inLiveSitemap: entry.inLiveSitemap, candidateSitemap, siteName, canonicalHost, liveHost, candidateHost });
    findings.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
    results.push({ path: entry.path, source: entry.source, inLiveSitemap: Boolean(entry.inLiveSitemap), live: stripPage(liveSide), candidate: stripPage(candSide), findings, verdict: liveSide.skipped ? 'skipped' : verdictOf(findings) });
  }
  return results;
}

const join = (base, path) => `${base.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;

/** A compact copy of the extracted page for the JSON report. */
function stripPage(side) {
  if (!side) return side;
  const { page, ...rest } = side;
  if (!page) return rest;
  return {
    ...rest,
    page: {
      lang: page.lang,
      title: page.title,
      description: page.description,
      canonical: page.canonical?.href ?? null,
      robots: page.robots,
      og: page.og,
      twitter: page.twitter,
      h1: page.h1,
      jsonldTypes: page.jsonld.types,
      hreflang: page.hreflang.map((h) => h.hreflang),
      amphtml: page.amphtml,
    },
  };
}

/** Site-level checks: robots.txt and the candidate sitemap. */
export function siteChecks({ liveRobotsRaw, candidateRobotsRaw, candidateSitemapStatus, candidateSitemapUrls, ua = USER_AGENT }) {
  const findings = [];
  const add = (code, message) => findings.push({ severity: SEVERITY[code].severity, code, message });
  const live = liveRobotsRaw == null ? null : parseRobotsTxt(liveRobotsRaw);
  const cand = candidateRobotsRaw == null ? null : parseRobotsTxt(candidateRobotsRaw);
  if (cand && robotsBlocksAll(cand, ua) && !(live && robotsBlocksAll(live, ua))) add('robots-txt-blocks-all', 'the candidate robots.txt disallows the whole site');
  if (candidateSitemapStatus !== 200 || !candidateSitemapUrls || candidateSitemapUrls.size === 0) add('candidate-sitemap-unavailable', `candidate sitemap: status ${candidateSitemapStatus ?? 'none'}, ${candidateSitemapUrls ? candidateSitemapUrls.size : 0} URL(s)`);
  const liveDisallow = new Set((live?.groups ?? []).flatMap((g) => g.rules.filter((r) => !r.allow && r.path).map((r) => r.path)));
  const candDisallow = new Set((cand?.groups ?? []).flatMap((g) => g.rules.filter((r) => !r.allow && r.path).map((r) => r.path)));
  return {
    findings,
    robots: {
      liveDisallow: [...liveDisallow].sort(),
      candidateDisallow: [...candDisallow].sort(),
      onlyOnLive: [...liveDisallow].filter((p) => !candDisallow.has(p)).sort(),
      onlyOnCandidate: [...candDisallow].filter((p) => !liveDisallow.has(p)).sort(),
      liveSitemaps: live?.sitemaps ?? [],
      candidateSitemaps: cand?.sitemaps ?? [],
    },
  };
}

// ---------------------------------------------------------------- reports

export function summarize(results, site) {
  const count = { blocker: 0, warn: 0, info: 0, ok: 0, skipped: 0 };
  for (const r of results) count[r.verdict] += 1;
  const byCode = {};
  for (const f of [...results.flatMap((r) => r.findings), ...(site?.findings ?? [])]) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
  const siteBlockers = (site?.findings ?? []).filter((f) => f.severity === BLOCKER).length;
  return { compared: results.length, ...count, siteBlockers, byCode, pass: count.blocker === 0 && siteBlockers === 0 };
}

export function toJson({ meta, results, site, summary, urlSet }) {
  return { tool: TOOL_NAME, version: TOOL_VERSION, meta, summary, urlSet, site, results };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown({ meta, results, site, summary, urlSet }) {
  const out = [];
  out.push('# SEO parity report', '');
  out.push(`Tool ${TOOL_NAME} ${TOOL_VERSION}. Generated ${meta.generatedAt}.`, '');
  out.push(`- Live base: \`${meta.liveBase}\`${meta.liveMode === 'recorded' ? ' (recorded files)' : ''}`);
  out.push(`- Candidate base: \`${meta.candidateBase}\`${meta.candidateMode === 'recorded' ? ' (recorded files)' : ''}`);
  out.push(`- Canonical host expected: \`${meta.canonicalHost}\``);
  out.push(`- Requests: GET only, no cookies, no credentials, ${meta.delayMs} ms between requests to one host, timeout ${meta.timeoutMs} ms, no retries`);
  out.push(`- URL set: ${urlSet.total} URL(s) found, ${summary.compared} compared${urlSet.truncated ? `, **${urlSet.truncated} not compared because of --max ${meta.max}**` : ''}`, '');

  out.push(`## Verdict: ${summary.pass ? 'PASS (no blockers)' : 'FAIL (blockers present)'}`, '');
  out.push('| Blockers | Warnings | Info only | Identical | Skipped | Site-level blockers |', '| ---: | ---: | ---: | ---: | ---: | ---: |');
  out.push(`| ${summary.blocker} | ${summary.warn} | ${summary.info} | ${summary.ok} | ${summary.skipped} | ${summary.siteBlockers} |`, '');
  out.push('A URL is counted by its worst finding. "Identical" means no finding at all.', '');

  out.push('## Site-level checks', '');
  if (site.findings.length) for (const f of site.findings) out.push(`- **${f.severity}** \`${f.code}\`: ${f.message}`);
  else out.push('- robots.txt and the candidate sitemap: no blocker.');
  out.push('', `- robots.txt Disallow only on the live site: ${site.robots.onlyOnLive.length ? site.robots.onlyOnLive.map((p) => `\`${p}\``).join(', ') : 'none'}`);
  out.push(`- robots.txt Disallow only on the candidate: ${site.robots.onlyOnCandidate.length ? site.robots.onlyOnCandidate.map((p) => `\`${p}\``).join(', ') : 'none'}`);
  out.push(`- Sitemap lines: live ${site.robots.liveSitemaps.length ? site.robots.liveSitemaps.map((s) => `\`${s}\``).join(', ') : 'none'}; candidate ${site.robots.candidateSitemaps.length ? site.robots.candidateSitemaps.map((s) => `\`${s}\``).join(', ') : 'none'}`);
  out.push(`- Live sitemaps read: ${site.liveSitemapFiles.length ? site.liveSitemapFiles.map((s) => `\`${s}\``).join(', ') : 'none (the URL list came from the other sources)'}`);
  out.push(`- Candidate sitemap: ${site.candidateSitemapUrlCount} URL(s)`, '');

  // Blockers: every row. Warnings and info: grouped by code, a few examples each (all of them are in the JSON file).
  const blockers = [];
  for (const r of results) for (const f of r.findings) if (f.severity === BLOCKER) blockers.push([r.path, f.code, f.message]);
  for (const f of site.findings) if (f.severity === BLOCKER) blockers.push(['(site)', f.code, f.message]);
  out.push(`## Blockers (${blockers.length})`, '');
  if (!blockers.length) out.push('None.', '');
  else {
    out.push('| URL (live path) | Code | What |', '| --- | --- | --- |');
    for (const [p, code, msg] of blockers) out.push(`| \`${cell(p)}\` | \`${code}\` | ${cell(msg)} |`);
    out.push('');
  }

  const warnGroups = new Map();
  for (const r of results) for (const f of r.findings) if (f.severity === WARN) (warnGroups.get(f.code) ?? warnGroups.set(f.code, []).get(f.code)).push([r.path, f.message]);
  const warnTotal = [...warnGroups.values()].reduce((n, rows) => n + rows.length, 0);
  out.push(`## Warnings (${warnTotal})`, '');
  if (!warnGroups.size) out.push('None.', '');
  for (const [code, rows] of [...warnGroups].sort((x, y) => y[1].length - x[1].length)) {
    out.push(`### \`${code}\` (${rows.length})`, '', SEVERITY[code].text, '');
    for (const [p, msg] of rows.slice(0, 8)) out.push(`- \`${p}\`: ${msg}`);
    if (rows.length > 8) out.push(`- ... and ${rows.length - 8} more (all of them are in the JSON file)`);
    out.push('');
  }

  out.push('## Info (grouped)', '');
  const infoGroups = new Map();
  for (const r of results) for (const f of r.findings) if (f.severity === INFO) (infoGroups.get(f.code) ?? infoGroups.set(f.code, []).get(f.code)).push([r.path, f.message]);
  if (!infoGroups.size) out.push('None.', '');
  for (const [code, rows] of infoGroups) {
    out.push(`### \`${code}\` (${rows.length})`, '', SEVERITY[code].text, '');
    for (const [p, msg] of rows.slice(0, 5)) out.push(`- \`${p}\`: ${msg}`);
    if (rows.length > 5) out.push(`- ... and ${rows.length - 5} more (all of them are in the JSON file)`);
    out.push('');
  }

  const moved = results.filter((r) => r.findings.some((f) => f.code === 'address-moved'));
  out.push(`## Address changes (the redirect map to prove in Search Console) (${moved.length})`, '');
  if (!moved.length) out.push('None.', '');
  else {
    out.push('| Live path | Candidate final path | Hops |', '| --- | --- | --- |');
    for (const r of moved.slice(0, 200)) out.push(`| \`${cell(r.path)}\` | \`${cell(r.candidate?.final?.path ?? r.candidate?.final?.url)}\` | ${r.candidate?.chain.map((h) => h.status).join('>')} |`);
    if (moved.length > 200) out.push(`| ... | ${moved.length - 200} more in the JSON file | |`);
    out.push('');
  }

  out.push('## Legend', '', '| Code | Severity | Meaning |', '| --- | --- | --- |');
  for (const [code, { severity, text }] of Object.entries(SEVERITY)) out.push(`| \`${code}\` | ${severity} | ${text} |`);
  out.push('');
  return `${out.join('\n')}\n`;
}
