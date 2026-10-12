# cf/web: the public site on Astro + Workers (SAKEM-075)

A local, thin slice of the new public site: **Astro 6 SSR on Cloudflare Workers** in front of the legacy Next app. It exists to prove the shape (SEO parity, redirects, pass-through, what runs in the Worker) before the remaining pages are ported. Context and decisions: [`README.md`](README.md).

**Status.** Built and tested locally only. Nothing is deployed, no Cloudflare account was used (`wrangler login`, `deploy` and every remote command were avoided; only `wrangler dev` in local mode and `wrangler deploy --dry-run`). **Visual QA was not done** (no browser was opened); layout, spacing and motion were not looked at, only HTML, CSS output and behaviour were checked.

## Run it

```bash
cd cf/web
pnpm install                    # its own lockfile; not a pnpm workspace
cp dev.vars.example .dev.vars   # fake local values, untracked
pnpm stub-origin                # terminal 1: stand-in for the legacy app, :4390
pnpm fixture-api                # terminal 2: content API with sample team data, :4391
pnpm dev                        # terminal 3: astro dev on :4321 (the Worker runs in workerd)
```

| Command | What it does |
| --- | --- |
| `pnpm build` | Syncs a few root files (`scripts/sync-assets.mjs`), builds `dist/client` (assets) and `dist/server` (Worker) |
| `pnpm check` | `astro check` (types for `.astro` and `.ts`) |
| `pnpm test` | 475 unit tests (vitest); `built.test.ts`, `home-built.test.ts` and `home-dom.test.ts` read `dist/` and need `pnpm build` first (skipped without it) |
| `pnpm test:e2e` | 273 checks against the built Worker under `wrangler dev` (local mode) with the stub origin and the fixture API |
| `pnpm measure [-- --next http://127.0.0.1:3055]` | Sizes, warm timings, and the "does the Worker run?" experiment; writes `.measure/results.json` |
| `pnpm exec wrangler deploy --dry-run --outdir <dir> -c dist/server/wrangler.json` | Bundle size, no login needed |

`astro dev` differs from production in two ways: static assets are not served before the Worker, and `_redirects` is not processed (the middleware answers the same redirect table instead). Use the built Worker (`pnpm test:e2e`, or `wrangler dev -c dist/server/wrangler.json`) to see production behaviour.

## What is built

| URL | Served as | Notes |
| --- | --- | --- |
| `/` | prerendered, **assets layer** | All 7 sections (Hero, Mengapa Kami Ada?, Program Kami, Dampak, Partner, CTA, Cerita & Inspirasi), verbatim copy; Organization JSON-LD; the lazy Leaflet map (see "JS and CSS budget") |
| `/blog` | **SSR** | List with `?page=N` (15 per page), reads only a small metadata index bundled in the Worker |
| `/blog/<slug>` | prerendered, **assets layer**, 80 pages | Built from the root `content/blog/*.md`; Article JSON-LD, related articles |
| `/tim` | **SSR** | `${CONTENT_API_URL}/api/public/team`, 2 s timeout, `caches.default`, stale-if-error |
| unknown URL | **SSR 404 page**, HTTP 404 | noindex; also `/blog/<unknown slug>` |
| `/sitemap.xml`, `/robots.txt` | prerendered, assets layer | Same routes and disallow list as the Next app |
| `/cerita/<slug>/`, `/education/...`, `/feed`, ... | **`_redirects`**, assets layer, 308 | 80 WordPress URLs and the other rules, see below |
| `/login`, `/portal/*`, `/admin/*`, `/api/*`, `/_next/*`, uploads | **forwarded to the legacy origin** | See "Pass-through" |
| `/program/*`, `/laporan`, `/donasi`, `/kontak`, `/gabung-siswa*` | forwarded to the legacy origin | Not ported yet |
| `/<slug>` (single segment, slug grammar) | forwarded to the legacy origin | Admin-managed shortlinks live in Postgres |

Client JS has no framework. On every page: the **navbar script** (about 3.4 KB raw, 1.5 KB gzip, inline): mobile menu toggle, the auth-aware button (`/api/auth/session` -> Masuk / Portal / Dashboard), the announcement strip (`/api/announcements/current`) and the footer year (DESIGN.md says it is "computed live"); it exists because that state lives on the legacy app or in the browser. On `/tim`: a **dialog opener** (about 0.3 KB) for a member's native `<dialog>`. On `/` three more: the **stat dialog opener** (0.3 KB), the **carousel controls** (1 KB) and the **map loader** (3 KB, a file because it holds dynamic imports) that fetches Leaflet only when the map is within 400 px of the viewport. The numbers, what each one is for and the enforced budget are in "JS and CSS budget" below. Everything else is HTML and CSS; the entrance animations are CSS (`.anim-fade-up` on load, `.anim-reveal` on a view timeline), framer-motion is not used.

## Decisions and why

- **Design tokens are copied, not imported.** `src/styles/global.css` holds the `:root` vars, the `@theme inline` block, the base heading scale, the focus ring and `.blog-content` from `app/globals.css`. Importing the root file by path would pull in its Leaflet styles and, worse, its `@source not "../cf"` (added in commit 1), which would stop Tailwind from scanning this app's own files. `tests/tokens.test.ts` fails if a value drifts from the root file.
- **Fonts** are self-hosted with `@fontsource` (static files, Lora 400-700 and Plus Jakarta Sans 400-700, latin only, like `lib/fonts.ts`); two are preloaded. No Google Fonts request.
- **Blog content: a small Vite plugin** (`plugins/blog-content.mjs`) turns `content/blog/*.md` into two virtual modules: a metadata index (small, bundled in the Worker for `/blog`) and the rendered bodies (imported only by the prerendered article pages, so no article text is in the Worker bundle; a test checks this). The markdown is rendered with the engine react-markdown uses (remark-parse, remark-gfm, remark-rehype), the same `img` and `a` handling, and the plugin reads the real image files to put `width` and `height` on every `<img>`. Why not `import.meta.glob('?raw')` or `astro:content`: parsing and rendering happen once in Node, so the Worker and the workerd prerender never see a file system, and no raw markdown or parser ships in the Worker.
- **Redirects: one table, compiled to `_redirects`** (`redirects.config.mjs`). The assets layer answers `_redirects` before the Worker runs, so legacy WordPress traffic costs no Worker request and no CPU. Astro's own `redirects` option was not used: with params the adapter's generator (`@astrojs/underscore-redirects` 1.0.3) writes `/cerita/:slug  /cerita/:slug.html  301` and drops the destination and the status. The same table feeds the middleware (used by `astro dev` and as a safety net) and the tests, so there is one source.
- **Pass-through in a middleware plus a catch-all route.** Astro middleware only runs for a request that matches a route; without a catch-all (`src/pages/[...path].astro`) an unmatched multi-segment path such as `/portal/status` gets Astro's built-in 404 and never reaches the middleware (found in the first e2e run). The catch-all also resolves shortlinks (below).
- **`security.checkOrigin` is off.** Astro's origin check answers 403 to any POST/PUT/PATCH/DELETE with a form content type and no matching `Origin`, which would reject requests the legacy app accepts (server-to-server callbacks, a form posted from the LMS host). The Astro pages here have no state-changing endpoint; the contact form, when ported, validates `Origin` itself.
- **The 404 is SSR, not prerendered.** A prerendered `404.html` is a static file and the assets layer serves static files with status 200 (`/404` itself answered 200 in the first build). Cost: one small render per unknown URL.
- **One URL per page.** The middleware folds a trailing slash and `.html` with a 308 (Next does the same for the slash); the page's canonical link is the second line of defence. A prerendered page requested with a trailing slash is redirected by the assets layer with a **307**, not Next's 308 (not configurable).
- **Images.** Plain `<img>` with `width`/`height`; `loading="lazy"` except the hero photo (`loading="eager" fetchpriority="high"`). Images the components import (hero, program photos, logos) are hashed and the photos resized at build time with sharp (`imageService: { build: 'compile', runtime: 'passthrough' }`; no Cloudflare Images): the hero went from a 1.4 MB PNG to an 85 KB webp at 800 px. Blog covers and inline article images are **not** resized (see gaps).
- **Security headers** that Caddy adds today (HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy) are re-added for Worker and asset responses (`public/_headers` and the middleware); a test keeps them equal to the Caddyfile.
- **Team API contract** (`src/lib/team-types.ts`): `GET ${CONTENT_API_URL}/api/public/team` returns `{ "members": TeamMember[] }` shaped like the `team_members` row of `lib/db/schema/team-members.ts` (dates as ISO strings); a bare array is accepted. **This endpoint does not exist in the legacy app yet.** Cache: 5 min fresh, 7 days stale; on failure the stale copy is also re-served as fresh for 30 s so an outage costs one 2 s wait per 30 s, not one per request. `TEAM_CACHE_FRESH_SECONDS` tunes the fresh window.

- **Home sections (SAKEM-080 part A).** Copy and data are in `src/lib/home-data.ts` (a file of its own, so parallel pages do not collide in `site.ts`); `tests/home.test.ts` compares every value with the root `lib/data.ts` (it imports it) and every phrase with the legacy components. Photos and logos are imported by the components, keyed by `id`, and resized at build time: the seven testimonial portraits went from up to 1.1 MB JPEGs to webp at 256, 384 and 640 px; the six logos to webp at 136 and 272 px; the page references 49 image files (srcset variants included), the largest 157 KB (the 1200 px hero), and no original.
- **Testimonial carousel: CSS scroll-snap, not a slider.** The track is an `overflow-x` scroll-snap row (two cards at a time from `md`, one below) in a focusable `role="region"` with `aria-roledescription="carousel"`; arrow keys, touch and trackpad scroll it with no JS. About 1 KB of script adds the previous/next buttons (they wrap around, like the Next version) and the dots; until it runs those controls are `hidden`, so there is never a dead button. `scrollTo` carries no `behavior`, so CSS decides (smooth, or instant under `prefers-reduced-motion`). Differences from the Next carousel: one card per testimonial in the HTML (Next rendered every card twice, once per slide), the last position shows cards 6 and 7 instead of 7 and 1, there is one dot fewer than cards when two are in view, and the dots have a larger invisible hit area.
- **Map: server-rendered list, Leaflet loaded lazily.** The panel is HTML first: the eight branches as a list (what crawlers, screen readers and a visitor without JS get). The map loader (an `IntersectionObserver`, `rootMargin` 400 px) dynamically imports Leaflet, its CSS and the marker CSS the first time the panel is near the viewport, draws one marker per list item (the list items carry the coordinates and the popup markup, so the script holds no copy) and then swaps the list for the map. A visit that never scrolls to the map never requests the Leaflet chunk (about 145 KB raw, 42 KB gzip). The CSS is imported with `?inline` and injected as a `<style>`: a plain CSS import in that script made Astro add a render-blocking `<link>` for all of Leaflet's CSS to the page. If the chunk cannot load, the list stays. Tiles still come from `tile.openstreetmap.org`, as before. Marker pulse keyframes are named `map-pulse`, so they cannot shadow Tailwind's `pulse`.
- **Entrance motion on the home sections is CSS only**: `.anim-reveal` (`src/styles/reveal.css`, inlined by Astro as a 349-byte `<style>`) runs a fade-up on a view timeline (`animation-timeline: view()`), staggered per card with `--i`. It sits behind `@supports (animation-timeline: view())`, so a browser without it just shows the content (nothing is hidden up front), and `prefers-reduced-motion` switches it off. It is not the 0.6 s time-based reveal of framer-motion; whether it feels right is a visual check nobody has done.
- **Tests that run the real scripts.** `tests/home-dom.test.ts` loads the built `index.html` into happy-dom (a dev dependency) and runs the page's actual scripts: it opens the dialog, drives the carousel (geometry stubbed, there is no layout), runs the lazy map (Leaflet really loads and draws the eight markers and a popup) and checks that nothing logs a console error. It proves the markup and the scripts agree; it is not a browser.

## Pass-through

How it works: the middleware (`src/middleware.ts`) checks the redirect table, then `src/lib/legacy-paths.ts`, and forwards with `src/lib/legacy-proxy.ts`. The request goes out with its method, headers (cookies and `Authorization` included), query and body stream; **redirects are not followed** (a 307 to `/login` reaches the browser); hop-by-hop headers are dropped; several `Set-Cookie` headers survive as several. In production (Workers **routes** mode, route covering the whole site) `fetch()` of the same URL reaches the origin behind the same hostname, so `LEGACY_ORIGIN_URL` stays unset. Locally it points at `scripts/stub-origin.mjs`, which echoes what it received.

**Proven locally** (e2e, 26 pass-through checks): GET/POST/PUT/PATCH/DELETE/HEAD reach the stub with method, query, body (also a 1 MB body), custom headers and cookies intact; two `Set-Cookie` arrive as two; the origin's 307 is not followed; `te` and `proxy-authorization` are not forwarded; the stub's `Cache-Control` survives; Astro paths (`/`, `/blog`, `/tim`, the 404s, redirects) never reach the stub. **Not provable locally:** route-mode semantics (below).

### Legacy path list (`src/lib/legacy-paths.ts`)

| Path | Why it is forwarded |
| --- | --- |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` | Auth pages (Auth.js on the legacy app); forms post to the same URL as Next server actions |
| `/portal`, `/admin` | Signed-in areas, gated by the legacy `proxy.ts` |
| `/api` | Auth.js `/api/auth/*`, SSO `/api/sso/*`, account, announcements, admin and portal APIs; the new navbar script calls two of them |
| `/_next` | Chunks, hashed media and the `/_next/image` optimizer every legacy page needs |
| `/blog/images`, `/images`, `/files`, `/reports`, `/resources` | Migrated and dashboard-uploaded files that live on the VPS volume |
| not yet ported: `/program`, `/laporan`, `/donasi`, `/kontak`, `/gabung-siswa` | Delete an entry in the PR that ports its page |

`tests/legacy.test.ts` reads the legacy `app/` folders and fails if the legacy app gains a top-level route that is neither Astro's nor listed, and checks the root `RESERVED_SLUGS` the same way.

### Conflicts and findings

- **Shortlinks.** `sakolakembara.org/<slug>` is resolved by Next's root `[slug]` route against Postgres. Without care the Worker would answer those with a 404. The catch-all forwards a single segment that fits the slug grammar (same regex and 64-character limit as `validateSlug`) to the origin, which redirects (307) or answers its own 404; anything else is a 404 from the Worker without a database round trip. Static pages win over the catch-all, like in Next.
- **Files both sides serve.** The Worker ships copies of `favicon.ico`, `icon.png`, `apple-icon.png`, `og-default.jpg` and `images/logo-sakola-kembara.png` (copied from the root at build time, gitignored, so the root stays the single source). The assets layer answers first, so the origin's identical files are shadowed. `/robots.txt`, `/sitemap.xml`, `/blog` and `/blog/<slug>` are also Astro's now; the origin's versions become unreachable. `/_astro/*` (this app) and `/_next/*` (legacy) do not overlap.
- **Every pass-through is a Worker request** (100k per day on Free), including each `/_next` chunk, each `/blog/images/*` photo and each `/api/*` call. A `/blog` list view with 16 cover images is about 17 Worker requests. The navbar script keeps its two API answers in `sessionStorage` (announcement 5 min, signed-in session 5 min, signed-out session 30 s), so a visit costs two requests once per session, not per page. Moving the 235 blog images (69 MB) into this app's assets (free and unlimited, under the 20k-file limit) or to R2 removes most of the rest.
- **Blog content source of truth.** `content/blog/*.md` is baked into the Docker image, and the legacy `/admin/blog` writes new and edited articles to the container's disk (only `public/` is a volume). Articles authored there are not in git, so this build cannot see them, and they do not survive a deploy of the legacy image anyway. Before cutover the blog needs one source: a content API like `/api/public/team` (the `/blog` list is already SSR), or commits.
- **Client IP.** The legacy rate limiter prefers `CF-Connecting-IP`. The proxy forwards all request headers; whether Cloudflare keeps that header on a Worker's subrequest to the origin needs a check on a real zone.
- **Server actions** post to the page URL (`/login`, `/portal/daftar`): the e2e posts with a `next-action` header and a body, and it reaches the stub unchanged.
- `/blog/page/N?utm=x` loses the incoming query (`_redirects` keeps the destination's own query only). Not worth a code path.

## JS and CSS budget (home page)

The home page is the only page with more than the navbar script, so its client weight is fixed in a test: `tests/home-built.test.ts` (needs `pnpm build`) fails when the page ships more than the numbers below. The limits are what the build measured plus about 15%; raising one is a decision, made in the PR that needs it, with the reason written here.

| Part | Measured (raw / gzip) | Limit (raw / gzip) | Loaded |
| --- | --- | --- | --- |
| Navbar script (inline, every page) | 3,444 / 1,581 B | | on every page |
| Stat dialog opener (inline) | 266 / 200 B | | on `/` |
| Carousel controls (inline) | 1,028 / 532 B | | on `/` |
| Map loader (`ImpactMap...js`, a file) | 3,071 / 1,560 B | | on `/`; half of it is Vite's dynamic-import helper |
| **Eager JS of `/`** | **7,809 / 3,873 B** | **9,000 / 4,600 B** | |
| Leaflet + its CSS + marker CSS (3 lazy chunks) | 166,150 / 50,000 B | 190,000 / 58,000 B | only when the map is within 400 px of the viewport |
| CSS of `/` (one stylesheet + inline `<style>`) | 58,373 / 10,444 B | 67,000 / 12,200 B | render blocking, on every page (the stylesheet is shared) |

What each island is for, and why it is not CSS:

- **Navbar script**: the signed-in state and the announcement live on the legacy app; the menu toggle and the year need a script (see "What is built").
- **Stat dialog opener**: `showModal()` has no HTML-only form. Everything else about the dialog is native (focus trap, Escape, the `method="dialog"` Tutup button).
- **Carousel controls**: scrolling and snapping are CSS; the script only moves one card per click (wrapping) and syncs the dots. Without it the carousel still scrolls.
- **Map loader + Leaflet**: a map needs a map library. It is the one piece of real JS, so it is lazy (nothing of it is in the HTML, a test checks there is no `leaflet` and no `modulepreload` there) and it replaces a complete server-rendered list rather than an empty box. A static SVG map was rejected: there is no coastline data in the repo, and a drawn Indonesia would be new art.
- **No animation library**: entrance motion is CSS (`reveal.css`, `.anim-fade-up`). A test fails if `framer-motion` or `gsap` appears in any shipped JS.

The e2e script repeats the eager-JS check on the bytes the Worker serves, and checks that the lazy chunks are plain static files (200, immutable, never forwarded to the origin). `pnpm measure` prints the same page-weight numbers.

## Results (local, this machine)

**Tests.** `pnpm test`: 475 passed (14 files). `pnpm test:e2e`: 273 of 273 checks. `pnpm check`: 0 errors, 0 warnings. Root: `tsc --noEmit` and `pnpm test` (229) pass with `cf/` present; `eslint eslint.config.mjs` is clean. A full root `pnpm lint` reports 5 errors and 2 warnings in legacy files this change does not touch (`app/(admin)`, `app/(portal)`, `app/(public)/donasi`, `components/Map`, `scripts/scrape-blog.mjs`); none from `cf/` (ignored).

**What `/` loads** (JS means JS referenced by the HTML):

| | HTML raw / gzip | JS raw / gzip | CSS raw / gzip |
| --- | --- | --- | --- |
| Astro `/` (all 7 sections) | 77.3 / 15.3 KB | 7.6 / 3.5 KB (3 inline scripts + 1 file, Leaflet lazy and not counted) | 57.0 / 10.2 KB (one file + a 0.3 KB inline `<style>`) |
| Astro `/blog/<slug>` | 30.5 / 8.7 KB | 3.4 / 1.5 KB | 56.7 / 10.1 KB |
| Next `/` (all sections) | 131.7 / 22.0 KB | 1026.8 / 316.6 KB in 15 files, plus 32.2 / 8.4 KB in 16 inline scripts | 99.4 / 15.7 KB |

The Next row is measured from `next start` (the Next 16 build output no longer prints a First Load JS column) and dates from the first slice. The Astro home row is now like for like (all seven sections): about 4 KB of JS gzip up front instead of about 317 KB, and the Leaflet map (about 50 KB gzip with its CSS) is fetched only when the map is about to be seen. The HTML grew because the page now carries the testimonial quotes, the eight branches and the stat detail text as real markup. Next had measured the CSS of the whole app; Astro's single stylesheet is Tailwind's output for this app.

**Worker bundle** (`wrangler deploy --dry-run`, no login): 19 modules, **729 KiB raw, 182 KiB gzip** against 3 MB compressed on Free (the home page is prerendered, so its sections add almost nothing to the Worker). `dist/client`: 162 files, 5.2 MB (80 article pages, resized images, fonts, CSS, the Leaflet chunk).

**Warm response time**, client wall clock through `wrangler dev` (workerd, loopback stub, N=60; **proxy numbers, not CPU time**):

| Route | Status | Median | p95 |
| --- | --- | --- | --- |
| `/` (prerendered, 77 KB HTML) | 200 | 2.4 ms | 3.5 ms |
| `/blog` (SSR) | 200 | 2.2 ms | 3.2 ms |
| `/blog/<slug>` (prerendered) | 200 | 1.3 ms | 1.8 ms |
| `/tim` (SSR, cache hit) | 200 | 2.1 ms | 2.7 ms |
| unknown URL (SSR 404) | 404 | 1.4 ms | 2.3 ms |
| `/cerita/x/` (`_redirects`) | 308 | 0.8 ms | 1.4 ms |
| `/login` (pass-through) | 200 | 1.3 ms | 2.2 ms |

**Does a prerendered route invoke the Worker?** Measured with the Worker entry wrapped by a counter, under `wrangler dev` in local mode: **no** for `/`, `/blog/<slug>`, `/robots.txt`, `/sitemap.xml`, `public/` files, `/_astro/*` assets and every `_redirects` rule; **yes** for `/blog`, `/tim`, the 404, and every forwarded path. So, unlike the OpenNext spike, static pages are answered by the assets layer and cost no Worker request. This is the local emulation of the assets router; confirm on a real zone (below).

**Status codes verified** by the e2e checks (HTTP exchanges): 123 HTML responses with 200, 18 HTML 404s (real 404 status with the 404 page), 136 x 308 and 8 x 307 redirects (the 80 WordPress URLs among them; there are no 301s: Next's `permanent: true` is 308), plus 20 non-HTML 200s.

## SEO parity

| Item | Result | Evidence |
| --- | --- | --- |
| `<html lang="id">` | same | e2e, built.test |
| Title template `<page> \| Sakola Kembara`; home keeps the layout default | same | seo.test compares with the root `pageTitle`/`buildPageMetadata` |
| Meta description, canonical (absolute), robots and googlebot | same | seo.test, e2e on `/`, `/blog`, `/tim`, article |
| Open Graph (site_name, locale, title, description, url, image, type website) and Twitter card | same, including the 1200x630 alt on home | seo.test, e2e |
| JSON-LD: Organization (home), Article (80 articles), Program (ported, unused until program pages) | identical objects; the Article description uses the cleaned excerpt instead of the raw `[&hellip;]` | seo.test (deepEqual with the root), built.test parses all 80 |
| `sitemap.xml` | same 7 routes + 3 programs + 80 articles, same priorities; static routes have **no `<lastmod>`** (Next used `new Date()` on every request); articles carry their real date | headers-sitemap.test, e2e |
| `robots.txt` | same rules and `Host`/`Sitemap` lines | headers-sitemap.test, e2e |
| 404 | **real 404** with the 404 page and noindex, for unknown articles, unknown paths and `/404`; Next answered 200 with an empty shell for unknown slugs | e2e (8 URLs) |
| WordPress redirects | all 80 `sourceUrl` -> `/blog/<slug>`, 308, with and without the trailing slash; every rule of `next.config.ts` present with the same status; plus `/wp-content/uploads/*` (308) and `/program` (307) | redirects.test (table and generated `_redirects`), e2e |
| Images | `width`/`height` on every `<img>`; lazy except the hero (also on the full home page) | built.test, home-built.test, blog.test |
| Headings, skip link, one `<h1>` per page | same | built.test, e2e |
| Self-hosted fonts | no Google Fonts request | tokens.test, built.test |

Deliberate differences, for review: sitemap `lastmod` as above; trailing-slash and `.html` folding; article JSON-LD description; the team profile text is in the HTML (dialogs) instead of appearing only after a click; entrance animations are CSS and the hero photo scales in without fading (so it can be the LCP right away); scroll-reveal animations below the fold are not ported. `og:type` stays `website` for articles (parity); `article` plus `published_time` would be a separate decision.

## Known gaps

- **Not a complete site.** The home page is complete, but 5 public routes plus `/gabung-siswa/docs` and three program pages are still forwarded to the legacy app (SAKEM-080 parts B onward). Mixed mode means the old and new navbar differ until the rest is ported.
- **Home news covers are the blog's originals.** The three covers in "Cerita & Inspirasi" are `/blog/images/*` files at their original size (the two newest are 570 KB and 675 KB, one is 1.9 MB), served by the origin through the pass-through, one Worker request each, until the blog image derivatives exist (same gap as `/blog`). They are lazy, below the fold.
- **The map's tiles and the lazy chunk were not seen in a browser.** The loader and Leaflet run in the happy-dom test (markers, popup, CSS injection), but no tile, marker pulse, popup placement or layout was looked at.
- **Blog and team images are not optimized.** Covers and inline images are the originals (up to several hundred KB) served from the origin; the Next app resized them. Fix: build-time derivatives into this app's assets, then R2.
- **No visual QA.** Nothing was rendered in a browser. Utilities were checked in the built CSS, copy against the legacy source (tests/copy.test.ts), tokens against the root file.
- **Font fallback metrics.** `next/font` generates size-adjusted fallbacks; `@fontsource` does not, so a font swap can shift layout slightly (CLS).
- **No 100% dark-launch path yet.** Nothing here is deployed; route, DNS and rollback steps are not written.

## Needs a real zone (or a Free account) to settle

1. **Real CPU per request** (the 10 ms limit). Local wall times prove nothing about CPU. Candidates to watch: the `/blog` render (16 cards) and the 404 render.
2. **Route-mode pass-through.** That `fetch(sameUrl)` from the Worker reaches the origin and does not re-enter the Worker (and that Custom Domain mode would loop), that cookies, `Set-Cookie`, redirects and large bodies behave as in the local run, and that `CF-Connecting-IP` reaches the legacy rate limiter.
3. **Assets router in production**: prerendered pages, `_redirects` and `_headers` answered without a Worker invocation (the local emulation says yes), and the `html_handling` behaviour for trailing slashes (307).
4. **Cache API.** `caches.default` works on custom domains and routes, not on `*.workers.dev`; check hit/stale behaviour and eviction on the real zone.
5. **Request budget.** Count real Worker requests per page view with images and API calls from the origin; decide whether blog images move to assets or R2 before cutover.
6. **Limits quoted from memory** of the Cloudflare docs (3 MB compressed Worker, 10 ms CPU, 100k requests per day, 2,000 static and 100 dynamic `_redirects`, 20k asset files): re-check them when the Free account exists.

## Port checklist for the remaining public pages

Relative sizes are opinion (S: a few hours, M: about a day, L: several days).

- [x] **Home, remaining sections** (SAKEM-080 part A). Problem (charts as markup, native `<dialog>` with a 0.3 KB opener), Impact (metrics, the lazy Leaflet map, the scroll-snap carousel), Partners (active and past, resized logos), CTA (the four role cards, with the documented orange exception) and News (the three newest articles from the blog index, guarded against a missing cover). Decisions: "Home sections", the carousel, the map and the CSS motion above; budget below. Note for the ticket text: the legacy CTA has four cards ("Empat peran"), not three.
- [ ] **Program x3** `/program/<id>` (M): stepper, activity cards with PDFs, `programJsonLd`, prerender the three pages. The photo gallery reads a folder at request time (`lib/gallery.ts`), which a Worker cannot do: needs a build-time manifest or R2.
- [ ] **`/laporan`** (M): reads Postgres; needs `/api/public/reports` in the legacy app (or the new API) and an SSR page like `/tim`.
- [ ] **`/donasi`** (S-M): static copy, QRIS image, copy-account-number button (one small script).
- [ ] **`/kontak`** (L): the form posts a Next server action with rate limiting and Postgres. The Worker cannot call a server action; it needs a POST endpoint (legacy `/api/...` or the new Hono API), `Origin` validation, a honeypot like the current one, and a decision on the same rate-limit client IP.
- [ ] **`/gabung-siswa` and `/gabung-siswa/docs`** (M): recruitment page is static; docs lists `site_resources` from Postgres (needs `/api/public/resources`) with copy buttons.
- [ ] Each ported page: delete its entry from `NOT_YET_PORTED`, add its URL to the sitemap routes (already there), add a copy-parity case to `tests/copy.test.ts`, and update `docs/current-state/information-architecture.md`.
- [ ] Before cutover: blog source of truth (above), image derivatives, the route/DNS/rollback runbook, and the real-zone checks.
