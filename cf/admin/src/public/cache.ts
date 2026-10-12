// Response headers of the public read endpoints (contract, "Caching").
//
// A change shows in a cache in front of the API after at most `s-maxage`
// (60 s) plus one stale answer while it refetches. Announcements get the
// shorter window because an urgent notice should appear and disappear quickly;
// a 404 is cached for 30 s so probing cannot hammer D1 while a newly published
// article still appears within 30 s.
//
// The responses carry no cookie and depend on no request header, so they are
// safe to share and send no `Vary`. There is no CORS: the Astro Worker calls
// them server to server. No ETag or Last-Modified either: the contract defines
// neither, and the only consumer (cf/web) keeps its own copy by TTL and never
// sends a conditional request; an ETag would cost a digest of every body for
// no saving in D1 reads.

export const CACHE_CONTENT = "public, s-maxage=60, stale-while-revalidate=300";
export const CACHE_ANNOUNCEMENT = "public, s-maxage=30, stale-while-revalidate=60";
export const CACHE_NOT_FOUND = "public, s-maxage=30";
export const CACHE_NONE = "no-store";

/**
 * `Cache-Tag` values, one per public resource. Inert unless something that
 * understands the header sits in front of the Worker (a zone cache, or Workers
 * Cache): then an admin save can purge by tag instead of guessing every URL
 * (docs/cloudflare/public-api.md, "Purge options"). Cloudflare removes the
 * header before it reaches a browser.
 */
export const TAGS = {
  team: "team",
  reports: "reports",
  resources: "resources",
  announcement: "announcement",
  blog: "blog",
} as const;

export type ContentTag = (typeof TAGS)[keyof typeof TAGS];

/** The tag of one article: purges that article without touching the list. */
export const articleTag = (slug: string) => `blog-${slug}`;
