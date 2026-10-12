import { articleTag, TAGS } from "./cache";

// "Content changed": what an admin save tells the public side, and what is done
// about the caches that may hold the old answer.
//
// A save route calls `notifyContentChanged({ area: "team" }, waitUntil)` after
// its D1 write. The call works out WHAT is stale (a `PurgePlan`: the public URLs
// and the cache tags of the affected endpoints) and hands the plan to a
// `ContentPurger`. The purger decides HOW:
//
//   ttlOnlyPurger   (the default) does nothing: every cache between D1 and the
//                   visitor expires by its TTL, so an edit shows within
//                   `STALENESS_SECONDS` of the API plus the consumer's own
//                   fresh window. No Cloudflare API is called.
//
// The other options (a zone purge by URL, a purge by tag, Workers Cache) are
// documented with their limits in docs/cloudflare/public-api.md ("Purge
// options"). They are one `ContentPurger` each, swapped in at `activePurger`.
// The Cache API (`caches.default`) the Astro Worker uses is per data centre, so
// nothing running here can delete from it elsewhere: that is why a global purge
// goes through Cloudflare's purge API or tags, not `cache.delete`.

/** The public resources a save can change. */
export type ContentChange =
  | { area: "team" }
  | { area: "reports" }
  | { area: "resources" }
  | { area: "announcement" }
  /** `slug` is the article that was saved; omit it for a change that touches no single article (a reorder). */
  | { area: "blog"; slug?: string; /** How many index pages exist (articles / 15), so each `?page=N` URL can be named. Default 1. */ listPages?: number };

export interface PurgePlan {
  /** Root-relative public paths, as the consumer builds its cache keys (`${CONTENT_API_URL}${path}`). */
  paths: string[];
  /** `Cache-Tag` values of the affected responses (see TAGS in ./cache.ts). */
  tags: string[];
}

/**
 * With no purge, how long a cache in front of the API can show the old answer
 * (contract, "Caching"): `s-maxage` (60 s), and in the worst case one stale
 * answer more while it refetches (`stale-while-revalidate`, 300 s). The
 * consumer's own fresh window adds to this.
 */
export const STALENESS_SECONDS = { typical: 60, worstCase: 60 + 300 } as const;

const PATHS = {
  team: "/api/public/team",
  reports: "/api/public/reports",
  resources: "/api/public/resources",
  announcement: "/api/public/announcements/current",
  blogList: "/api/public/blog",
} as const;

/**
 * What is stale after `change`. A pure function: it touches no cache and no
 * network, so what it names is tested without any of them.
 *
 * A blog list exists once per `page` and `pageSize` a consumer asked for, so
 * naming every URL is a guess; `tags` covers all of them, and the tag is the
 * reliable way to purge a list. Related-article cards inside OTHER articles can
 * also show an old title for up to the TTL: they are not worth a purge of their own.
 */
export function planPurge(change: ContentChange): PurgePlan {
  switch (change.area) {
    case "team":
      return { paths: [PATHS.team], tags: [TAGS.team] };
    case "reports":
      return { paths: [PATHS.reports], tags: [TAGS.reports] };
    case "resources":
      return { paths: [PATHS.resources], tags: [TAGS.resources] };
    case "announcement":
      return { paths: [PATHS.announcement], tags: [TAGS.announcement] };
    case "blog": {
      const pages = Math.max(1, Math.min(Math.trunc(change.listPages ?? 1), 100));
      const paths: string[] = [PATHS.blogList];
      for (let page = 1; page <= pages; page++) paths.push(`${PATHS.blogList}?page=${page}`);
      const tags: string[] = [TAGS.blog];
      if (change.slug) {
        paths.push(`${PATHS.blogList}/${change.slug}`);
        tags.push(articleTag(change.slug));
      }
      return { paths, tags };
    }
  }
}

/** How stale answers are dealt with. Implementations must not throw for a refused or failed purge: staleness is bounded by the TTL anyway. */
export interface ContentPurger {
  readonly name: string;
  purge(plan: PurgePlan): Promise<void>;
}

/** The default: purge nothing, let the TTLs run out. */
export const ttlOnlyPurger: ContentPurger = {
  name: "ttl-only",
  async purge() {},
};

/**
 * The purger in use. SEAM: when a zone-purge or tag-purge implementation
 * exists, choose it here from the environment (for example when its token and
 * zone id are configured) and fall back to `ttlOnlyPurger` otherwise.
 */
export function activePurger(): ContentPurger {
  return ttlOnlyPurger;
}

/**
 * Builds the function save routes call. `waitUntil` keeps the purge running
 * after the response, so a slow or failing purge never delays or fails a save:
 * the data is already in D1, and the TTL bounds the staleness.
 */
export function createContentChangeNotifier(purger: () => ContentPurger = activePurger) {
  return function notifyContentChanged(change: ContentChange, waitUntil: (promise: Promise<unknown>) => void): PurgePlan {
    const plan = planPurge(change);
    const current = purger();
    waitUntil(
      Promise.resolve()
        .then(() => current.purge(plan))
        // The name and the error type only: no URL, no body.
        .catch((error: unknown) => console.error(`[purge] ${current.name} failed (${error instanceof Error ? error.name : "unknown"})`)),
    );
    return plan;
  };
}

/** What admin save routes import: `notifyContentChanged({ area: "reports" }, c.executionCtx.waitUntil.bind(c.executionCtx))`. */
export const notifyContentChanged = createContentChangeNotifier();
