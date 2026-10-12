/// <reference types="astro/client" />

// Bindings and variables of this Worker (see wrangler.jsonc and dev.vars.example).
declare namespace Cloudflare {
  interface Env {
    /** Stand-in origin for local runs. Unset in production: pass-through is a plain fetch(request). */
    LEGACY_ORIGIN_URL?: string;
    /** Base URL of the content API (`${CONTENT_API_URL}/api/public/team`, `/reports`, `/resources`). */
    CONTENT_API_URL?: string;
    /** Seconds a fetched team list is served from the cache before the API is asked again (default 300). */
    TEAM_CACHE_FRESH_SECONDS?: string;
    /** Same for the other lists (reports, resources) and for the blog pages and articles: default 60, the contract's `s-maxage`. */
    CONTENT_CACHE_FRESH_SECONDS?: string;
    /** Local/CI only: where the contact form posts instead of the `API` service binding (scripts/fixture-api.mjs). Unset in production. */
    CONTACT_API_URL?: string;
    /** Service binding to the API Worker (wrangler.jsonc `services`); the contact form and, without CONTENT_API_URL, the read endpoints go through it. */
    API?: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
    /** Rate-limit binding for the contact form (wrangler.jsonc, see its comment). Absent: an in-memory limiter answers instead. */
    CONTACT_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  }
}

// The Workers runtime module. @cloudflare/workers-types would declare it, but it
// clashes with the DOM types the client scripts need; this is the one member used.
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}

// Workers expose a default cache next to named ones.
interface CacheStorage {
  default: Cache;
}

declare module 'virtual:blog-index' {
  import type { BlogMeta } from '~/lib/blog-types';
  export const articles: BlogMeta[];
}

declare module 'virtual:blog-bodies' {
  export const bodies: Record<string, string>;
}
