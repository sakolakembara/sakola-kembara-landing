// A stand-in for the LIVE WordPress site, for rehearsing scripts/seo-parity.mjs without touching the real one.
//
// It serves INVENTED pages shaped the way a WordPress theme with an SEO plugin (Yoast) shapes them: the title
// ends in " - Sakola Kembara", every canonical URL ends in a slash, the JSON-LD is one @graph with WebPage,
// BreadcrumbList, ImageObject, WebSite, Organization and Person next to the Article, `sitemap_index.xml` lists
// `post-sitemap.xml`, `page-sitemap.xml` and `category-sitemap.xml`, `?p=<id>` redirects to the post, and
// `/<slug>` without its slash is a 301. It is NOT a copy of the real site and nobody has seen the real site's
// HTML in this repository: the shapes are what WordPress and Yoast usually produce, so a result against this stub
// proves the tool, never the real site.
//
// The pages are built from data the caller passes (the local rehearsal takes it from the candidate itself, so
// the baseline is "the same content in WordPress clothes" and every difference the tool reports is structural
// or planted on purpose, see PLANTED below).

import http from 'node:http';

export const PRODUCTION_ORIGIN = 'https://sakolakembara.org';

/** What the stub does on purpose, for the rehearsal's assertions. */
export const PLANTED = {
  /** A page the live site has and the candidate does not: a BLOCKER (url-missing). */
  missingOnCandidate: ['/halaman-lama/', '/arsip-lama/', '/kegiatan-lama/'],
  /** Category archives, which the candidate now sends to the blog index (SAKEM-090): INFO (address-moved), never a blocker. */
  redirectedArchives: ['/category/cerita/', '/category/news/'],
  /** A page whose title differs in more than the suffix: a WARN (title-changed). */
  titleChanged: '/tim/',
  /** A page with a BreadcrumbList the candidate does not render: a WARN (jsonld-type-dropped). The candidate gives every
   *  page but the home page a breadcrumb since SAKEM-090 (a trail of one step is not a trail), so it is the home page. */
  breadcrumbDropped: '/',
  /** A feed (RSS) where the candidate redirects to an HTML page: a WARN (content-type-changed). */
  feed: '/feed/',
  /** A page the candidate redirects to another address: INFO (address-moved). */
  moved: '/tentang-kami/',
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cleanText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function graph({ url, title, headline, datePublished, dateModified, image, article = false, breadcrumb = false, org = true }) {
  const nodes = [];
  if (article) {
    nodes.push({ '@type': 'Article', '@id': `${url}#article`, isPartOf: { '@id': `${url}#webpage` }, author: { '@id': `${PRODUCTION_ORIGIN}/#/schema/person/1` }, headline, datePublished, dateModified, mainEntityOfPage: { '@id': `${url}#webpage` }, publisher: { '@id': `${PRODUCTION_ORIGIN}/#organization` }, image: { '@id': `${url}#primaryimage` }, inLanguage: 'id-ID' });
  }
  nodes.push({ '@type': 'WebPage', '@id': `${url}#webpage`, url, name: title, isPartOf: { '@id': `${PRODUCTION_ORIGIN}/#website` }, inLanguage: 'id-ID' });
  if (image) nodes.push({ '@type': 'ImageObject', '@id': `${url}#primaryimage`, url: image, contentUrl: image });
  if (breadcrumb) nodes.push({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Beranda', item: `${PRODUCTION_ORIGIN}/` }, { '@type': 'ListItem', position: 2, name: headline }] });
  nodes.push({ '@type': 'WebSite', '@id': `${PRODUCTION_ORIGIN}/#website`, url: `${PRODUCTION_ORIGIN}/`, name: 'Sakola Kembara', inLanguage: 'id-ID' });
  if (org) nodes.push({ '@type': 'Organization', '@id': `${PRODUCTION_ORIGIN}/#organization`, name: 'Sakola Kembara', url: `${PRODUCTION_ORIGIN}/` });
  if (article) nodes.push({ '@type': 'Person', '@id': `${PRODUCTION_ORIGIN}/#/schema/person/1`, name: 'Penulis' });
  return { '@context': 'https://schema.org', '@graph': nodes };
}

/** One WordPress-shaped HTML page. `core` is the title without the site name; Yoast joins them with " - ". */
export function wpPage({ path, core, description, h1, ogType = 'website', image = null, article = null, breadcrumb = false, siteSuffix = true }) {
  const url = `${PRODUCTION_ORIGIN}${path}`;
  const title = siteSuffix ? `${core} - Sakola Kembara` : core;
  return `<!DOCTYPE html>
<html lang="id-ID">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Invented page, shaped like a WordPress theme with an SEO plugin. Not a copy of the real site. -->
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(url)}" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
<meta property="og:locale" content="id_ID" />
<meta property="og:type" content="${ogType}" />
<meta property="og:title" content="${esc(core)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:site_name" content="Sakola Kembara" />${image ? `\n<meta property="og:image" content="${esc(image)}" />` : ''}
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json" class="yoast-schema-graph">${JSON.stringify(graph({ url, title: core, headline: article?.headline ?? core, datePublished: article?.datePublished, dateModified: article?.dateModified, image, article: Boolean(article), breadcrumb }))}</script>
</head>
<body class="wp-singular"><main><h1 class="entry-title">${esc(h1 ?? core)}</h1><p>Isi contoh.</p></main></body>
</html>
`;
}

const urlset = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries
    .map((e) => `<url><loc>${PRODUCTION_ORIGIN}${e.path}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}${(e.images ?? []).map((i) => `<image:image><image:loc>${PRODUCTION_ORIGIN}${i}</image:loc></image:image>`).join('')}</url>`)
    .join('\n')}\n</urlset>\n`;

/**
 * @param {{ port?: number, articles: { id: string, wpId?: number, title: string, excerpt: string, dateISO: string, modifiedISO?: string, image?: string, sourceUrl: string }[],
 *           pages: { path: string, core: string, description: string, h1?: string, image?: string | null, exactTitle?: boolean }[],
 *           cleanExcerpt?: (s: string) => string }} opts
 */
export async function startWpStub({ port = 0, articles, pages, cleanExcerpt = cleanText }) {
  const routes = new Map(); // path -> { status, headers, body }
  const html = (body, status = 200) => ({ status, headers: { 'content-type': 'text/html; charset=UTF-8' }, body });
  const redirect = (to, status = 301) => ({ status, headers: { location: to, 'content-type': 'text/html; charset=UTF-8' }, body: '' });
  const wpImage = (img) => (img ? img.replace(/^\/blog\/images\//, '/wp-content/uploads/') : null);

  const postEntries = [];
  const imagePaths = new Set();
  for (const a of articles) {
    const path = new URL(a.sourceUrl).pathname; // /<category>/<slug>/
    const image = wpImage(a.image);
    if (image) imagePaths.add(image);
    routes.set(path, html(wpPage({ path, core: a.title, description: cleanExcerpt(a.excerpt), image: image ? `${PRODUCTION_ORIGIN}${image}` : null, ogType: 'article', article: { headline: a.title, datePublished: `${a.dateISO}T10:00:00+00:00`, dateModified: `${a.modifiedISO ?? a.dateISO}T10:00:00+00:00` }, breadcrumb: true })));
    routes.set(path.replace(/\/$/, ''), redirect(path)); // WordPress adds the slash
    if (a.wpId) routes.set(`/?p=${a.wpId}`, redirect(path)); // WordPress turns ?p=<id> into the pretty link
    postEntries.push({ path, lastmod: `${a.modifiedISO ?? a.dateISO}T10:00:00+00:00`, images: image ? [image] : [] });
  }

  const pageEntries = [];
  for (const p of pages) {
    const changed = p.path === PLANTED.titleChanged;
    routes.set(p.path, html(wpPage({ path: p.path, core: changed ? `${p.core} dan Pengurus Yayasan` : p.core, description: p.description, h1: p.h1, image: p.image ? `${PRODUCTION_ORIGIN}${p.image}` : null, breadcrumb: p.path === PLANTED.breadcrumbDropped, siteSuffix: !p.exactTitle })));
    if (p.path !== '/') routes.set(p.path.replace(/\/$/, ''), redirect(p.path));
    pageEntries.push({ path: p.path });
  }
  const extraPages = [PLANTED.moved, ...PLANTED.missingOnCandidate];
  for (const p of extraPages) {
    routes.set(p, html(wpPage({ path: p, core: p.replace(/\//g, ' ').trim().replace(/-/g, ' '), description: `Halaman ${p}` })));
    pageEntries.push({ path: p });
  }
  const categoryEntries = PLANTED.redirectedArchives.map((p) => ({ path: p }));
  for (const e of categoryEntries) routes.set(e.path, html(wpPage({ path: e.path, core: `Kategori ${e.path.split('/')[2]}`, description: 'Arsip kategori' })));
  routes.set('/index.php', redirect('/'));
  routes.set('/blog/page/2/', html(wpPage({ path: '/blog/page/2/', core: 'Blog - Halaman 2', description: 'Arsip blog halaman 2' })));
  routes.set(PLANTED.feed, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=UTF-8' }, body: '<?xml version="1.0"?><rss version="2.0"><channel><title>Sakola Kembara</title></channel></rss>\n' });

  routes.set('/robots.txt', { status: 200, headers: { 'content-type': 'text/plain; charset=UTF-8' }, body: `User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: ${PRODUCTION_ORIGIN}/sitemap_index.xml\n` });
  routes.set('/sitemap_index.xml', { status: 200, headers: { 'content-type': 'application/xml; charset=UTF-8' }, body: `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['post', 'page', 'category'].map((n) => `<sitemap><loc>${PRODUCTION_ORIGIN}/${n}-sitemap.xml</loc></sitemap>`).join('\n')}\n</sitemapindex>\n` });
  routes.set('/post-sitemap.xml', { status: 200, headers: { 'content-type': 'application/xml; charset=UTF-8' }, body: urlset(postEntries) });
  routes.set('/page-sitemap.xml', { status: 200, headers: { 'content-type': 'application/xml; charset=UTF-8' }, body: urlset(pageEntries) });
  routes.set('/category-sitemap.xml', { status: 200, headers: { 'content-type': 'application/xml; charset=UTF-8' }, body: urlset(categoryEntries) });
  // The WordPress media library, as far as the sitemap lists it: a 1x1 JPEG for every cover.
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const imageType = (p) => (/\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg');
  for (const p of imagePaths) routes.set(p, { status: 200, headers: { 'content-type': imageType(p) }, body: jpeg });

  const log = [];
  const server = http.createServer((req, res) => {
    log.push({ method: req.method, url: req.url, cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null, userAgent: req.headers['user-agent'] ?? null });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const u = new URL(req.url, 'http://stub');
    const hit = routes.get(`${u.pathname}${u.search}`) ?? routes.get(u.pathname);
    const r = hit ?? html(wpPage({ path: u.pathname, core: 'Halaman tidak ditemukan', description: 'Tidak ditemukan' }), 404);
    res.writeHead(r.status, r.headers);
    res.end(req.method === 'HEAD' ? undefined : r.body);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actualPort = server.address().port;
  return {
    base: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    log,
    articleCount: articles.length,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
