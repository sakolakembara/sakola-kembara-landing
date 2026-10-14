/// <reference types="astro/client" />

// Bindings and variables of this Worker (see wrangler.jsonc and dev.vars.example).
declare namespace Cloudflare {
  interface Env {
    /** Stand-in origin for local runs. Unset in production: pass-through is a plain fetch(request). */
    LEGACY_ORIGIN_URL?: string;
    /**
     * Local/CI only: base URL of the content API (`${CONTENT_API_URL}/api/public/team`, `/reports`, `/resources`,
     * `/blog`), a fixture server or a local API. Unset in production, where every read goes through the `API`
     * binding. When it is set it wins over the binding (lib/api-client.ts).
     */
    CONTENT_API_URL?: string;
    /**
     * The PUBLIC site key of the Turnstile widget on /kontak (not a secret; the matching secret key lives on the
     * API Worker). Set per deploy; locally Cloudflare's always-pass test key (dev.vars.example). Unset: the form
     * renders no widget and loads no Cloudflare script.
     */
    TURNSTILE_SITE_KEY?: string;
    /**
     * The admin's origin (a PUBLIC variable, set per deploy, not kept in the repository), e.g. `https://admin.example.org`:
     * `/admin` and everything under it is a 308 to it (src/lib/admin-redirect.ts). Unset or not an http(s) origin: no
     * redirect, the path is the site's 404. Locally `dev.vars.example` points it at the admin SPA's dev server.
     */
    ADMIN_URL?: string;
    /** Seconds a fetched team list is served from the cache before the API is asked again (default 300). */
    TEAM_CACHE_FRESH_SECONDS?: string;
    /** Same for the other lists (reports, resources) and for the blog pages and articles: default 60, the contract's `s-maxage`. */
    CONTENT_CACHE_FRESH_SECONDS?: string;
    /**
     * Seconds a rendered page (/blog, an article, /tim, /laporan, /gabung-siswa/docs, /sitemap.xml) is kept in the memory
     * of the isolate and answered from there, at most 120 and never longer than the page's own `s-maxage`. Unset, 0 or
     * not a number: off (every request renders). 30 is the value to start with. src/lib/page-cache.ts.
     */
    PAGE_CACHE_SECONDS?: string;
    /** Local/CI only: where the contact form posts instead of the `API` service binding (scripts/fixture-api.mjs). Unset in production. */
    CONTACT_API_URL?: string;
    /**
     * Public origin that serves the files the admin uploads (R2 behind its own domain), no trailing slash, e.g.
     * `https://files.example.org`. Prefixed to the `/uploads/...` paths of the content API (team photos, report and
     * document files, blog covers, and the images and links inside an article). Empty or unset (local, CI): paths
     * stay same-origin and nothing changes. See docs/cloudflare/uploads.md and src/lib/uploads.ts.
     */
    UPLOADS_BASE_URL?: string;
    /**
     * Service binding to the API Worker's `PublicApi` entrypoint (wrangler.jsonc `services`). In production the
     * contact form and every read of /api/public/* go through it; CONTACT_API_URL and CONTENT_API_URL win over it
     * when set (local runs and CI only).
     */
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
