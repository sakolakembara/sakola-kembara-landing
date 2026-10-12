import type { APIRoute } from 'astro';
import { getAllArticles } from '~/lib/blog';
import { SITE_URL } from '~/lib/seo';
import { PROGRAM_IDS, STATIC_ROUTES, buildSitemap, type SitemapEntry } from '~/lib/sitemap';

// Generated at build time and served as a static asset. The Next sitemap used
// `new Date()` as lastModified for every static route, which changed on each
// request; a made-up date tells crawlers nothing, so static routes carry no
// <lastmod> here. Blog entries carry the article's real modifiedISO/dateISO.
export const prerender = true;

export const GET: APIRoute = () => {
  const staticRoutes: SitemapEntry[] = STATIC_ROUTES.map(({ path, ...e }) => ({ ...e, url: `${SITE_URL}${path}` }));

  const programRoutes: SitemapEntry[] = PROGRAM_IDS.map((id) => ({
    url: `${SITE_URL}/program/${id}`,
    priority: 0.7,
    changeFrequency: 'monthly',
  }));

  const blogRoutes: SitemapEntry[] = getAllArticles().map((article) => ({
    url: `${SITE_URL}/blog/${article.id}`,
    lastModified: article.modifiedISO || article.dateISO,
    priority: 0.6,
    changeFrequency: 'monthly',
  }));

  return new Response(buildSitemap([...staticRoutes, ...programRoutes, ...blogRoutes]), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
