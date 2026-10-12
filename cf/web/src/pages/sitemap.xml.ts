import type { APIRoute } from 'astro';
import { getBlogSource } from '~/lib/blog';
import { blogRuntime } from '~/lib/blog-runtime';
import { SITE_URL } from '~/lib/seo';
import { PROGRAM_IDS, STATIC_ROUTES, buildSitemap, type SitemapEntry } from '~/lib/sitemap';

// SSR: the articles come from the content API, so a new one is in the sitemap without a
// rebuild. The source pages through the API with pageSize=50 and adds the featured article
// (the contract's way to enumerate every article), through the same Cache API scheme as the
// pages, so a crawler's visit costs a few cache hits, not API queries. The Next sitemap used
// `new Date()` as lastModified for every static route, which changed on each request; a
// made-up date tells crawlers nothing, so static routes carry no <lastmod>. A blog entry
// carries the article's real date: `modifiedISO` when the API sends it on list entries, else
// the publication date (`dateISO`, which every list entry has).
export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const source = await getBlogSource(blogRuntime((p) => locals.cfContext.waitUntil(p)));
  const articles = await source.all();
  // A sitemap without the articles is worse than none for a crawler that trusts it: say "try later".
  if (!articles.data) {
    return new Response('Sitemap sementara tidak tersedia.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '300' },
    });
  }

  const staticRoutes: SitemapEntry[] = STATIC_ROUTES.map(({ path, ...e }) => ({ ...e, url: `${SITE_URL}${path}` }));

  const programRoutes: SitemapEntry[] = PROGRAM_IDS.map((id) => ({
    url: `${SITE_URL}/program/${id}`,
    priority: 0.7,
    changeFrequency: 'monthly',
  }));

  const blogRoutes: SitemapEntry[] = articles.data.map((article) => ({
    url: `${SITE_URL}/blog/${article.slug}`,
    lastModified: article.modifiedISO || article.dateISO,
    priority: 0.6,
    changeFrequency: 'monthly',
  }));

  return new Response(buildSitemap([...staticRoutes, ...programRoutes, ...blogRoutes]), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': articles.source === 'stale' ? 'public, max-age=0, s-maxage=30' : 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600',
      'x-blog-source': articles.source,
    },
  });
};
