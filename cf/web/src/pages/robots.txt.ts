import type { APIRoute } from 'astro';
import { buildRobotsTxt } from '~/lib/sitemap';

// Static asset at build time. Same rules as the Next app/robots.ts.
export const prerender = true;

export const GET: APIRoute = () =>
  new Response(buildRobotsTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
