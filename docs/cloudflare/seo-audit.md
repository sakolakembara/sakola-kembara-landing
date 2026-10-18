# SEO audit: the parity tool, the Core Web Vitals plan, the Search Console plan

Ticket: SAKEM-084, task M5-B. The cutover steps that use these tools are in [`cutover-runbook.md`](cutover-runbook.md); the risks they are meant to catch are in its risk register.

**Status.** The tool is built and unit-tested with recorded fixtures and no network (`cf/web/tests/seo-parity.test.ts`), and rehearsed on this machine against the built Worker and a WordPress-shaped stand-in ([Rehearsal](#rehearsal-on-this-machine)). **It was run once against the real site on 2026-10-13** (Dzul approved; the report and the recorded pages are outside the repository) and what that showed is in [Parity fixes of 2026-10-13](#parity-fixes-of-2026-10-13-sakem-090); since then it is repeated **offline** against the recorded pages. **It has not been run against staging or against any Cloudflare resource**: that needs Dzul's approval, one run at a time. The rehearsal's stand-in is still invented from what WordPress and its usual SEO plugin typically produce (a clean rehearsal proves the tool and the local candidate); the real HTML was read for SAKEM-090. No PageSpeed Insights run and no Search Console step has been done.

## What "parity" means here

The live site `sakolakembara.org` runs on WordPress today. The new site (Astro on Workers, [`web-skeleton.md`](web-skeleton.md)) has to hold the ranking the old one earned. Three facts shape the audit:

- **The address of every article changes.** WordPress serves `/<category>/<slug>/` (all 86 source URLs in `lib/blog-posts.json`, the 80 migrated and the 6 added on 2026-10-13, have that shape); the new site serves `/blog/<slug>`. Parity for an article is therefore a **proven permanent redirect to a page that says the same things**, not the same URL. All 86 are redirected with a 308 (Google treats 308 like 301) and that is tested ([`redirects.test.ts`](../../cf/web/tests/redirects.test.ts) and the e2e group `wp-redirects`).
- **Trailing slash and `www` policy differ** (WordPress: slash, apex; new site: no slash, apex fixed in `SITE_URL`).
- **Everything the sitemap lists on the live site must still answer** with a 200 or a redirect to a 200. The live sitemap is the inventory of URLs Google knows; the tool reads it, so URLs nobody remembered (categories, tags, pages, images) show up as findings.

## The tool

`cf/web/scripts/seo-parity.mjs` (with `scripts/lib/seo-parity-core.mjs` for the rules and `scripts/lib/seo-parity-sources.mjs` for the two ways of getting an answer). Plain Node, no new dependency.

```bash
cd cf/web
pnpm seo:parity -- --help
pnpm seo:parity -- --dry-run --live-base https://live.example --candidate-base https://staging.example --allow-network   # the plan, no request
pnpm seo:parity -- --live-base https://live.example --candidate-base https://staging.example --allow-network --record ~/private/seo-live   # a real run: needs approval
pnpm seo:parity -- --live-dir ~/private/seo-live/live --candidate-base https://production.example --allow-network   # after cutover, against the recorded live corpus
```

### What it refuses and what it promises

| Property | How it is enforced | Tested by |
| --- | --- | --- |
| Needs both sides, or does not start | each side is `--X-base` (network) or `--X-dir` (recorded); the run exits 2 before any request | `needs both sides` |
| Does not touch a public host without a flag | a base that is not localhost needs `--allow-network` (the reminder that Dzul approved the run) | `refuses a remote host without --allow-network` |
| One request per second per host | `--delay-ms` defaults to 1000 and cannot go below 1000 for a remote host; every redirect hop counts as a request | `waits at least delayMs`, `paces every hop` |
| GET only | the only method in the code is `GET`; a test greps the sources for a write method | `sends GET only`, `read-only by construction` |
| No cookie, no credential | three request headers only (User-Agent, Accept, Accept-Language), `credentials: omit`, `Set-Cookie` of the answers is dropped | `sends GET only, with three headers`, `drops Set-Cookie` |
| Honest User-Agent | `SakemSeoParity/1.0 (+<this document's URL>)` | same test |
| Honours robots.txt | robots.txt of both sides is read first; a path the live robots disallows for this tool is not fetched on either side, and a path only the candidate disallows is reported as a blocker without being fetched | `robots.txt Disallow stops the request on both sides` |
| No retries, timeouts | one attempt, `--timeout-ms` (15 s), body capped at 2 MB | `does not retry`, `timeout`, `body-too-large` |
| Stays on the site | redirects are followed by hand and only to the base host and its `www` or apex twin (plus `--allow-host`); a redirect elsewhere ends the chain and nothing is requested there | `does not follow a redirect to another site` |
| Writes only where told | `--out` (default `.seo-parity/`, ignored by git) and `--record` | |
| Stops at 500 URLs | `--max`, and the report says how many were not compared | `--max cuts the list` |

### Where the URL list comes from

1. The main pages and the legacy entry points (`MAIN_PATHS`: `/`, `/blog/`, `/tim/`, `/kontak/`, `/donasi/`, `/gabung-siswa/`, the three program pages, and the static sources of `redirects.config.mjs`, `/laporan/` among them since SAKEM-105: it is a redirect now, not a page of its own), in WordPress spelling (trailing slash).
2. The **86 WordPress article URLs** (`sourceUrl` of `lib/blog-posts.json`) and their **86 `/?p=<wpId>` shortlinks** (WordPress answers those with a redirect to the post; `--no-wp-ids` leaves them out).
3. Your own list: `--extra FILE` (one path or URL per line, `#` comments).
4. **The live sitemap(s)**: the `Sitemap:` lines of the live robots.txt, else `/sitemap_index.xml`, `/wp-sitemap.xml`, `/sitemap.xml` (the first that works), following an index into its children (at most 50 files, two levels). `--sitemap PATH` (repeatable) overrides. Sitemap URLs are re-based onto the live base, so a stand-in works.
5. With `--include-images`, the `<image:loc>` URLs of those sitemaps (only those on the same host as the page): status and content type are compared, nothing else.

The same address from two sources is one entry; the sitemap's spelling wins. A real run is about 250 to 400 URLs, two requests each: **roughly 700 requests and 6 to 8 minutes**. `--dry-run` prints the estimate for the exact options.

### What it compares for each URL

For every URL the live side is asked first. If it answered something, the candidate is asked for the **same path** and the two answers are compared: the final status, the redirect chain (statuses and normalised `Location`), and for HTML pages `<html lang>`, `<title>`, meta description, canonical, `robots` and `googlebot` meta and `X-Robots-Tag`, `og:*`, `twitter:*`, every `<h1>`, `hreflang` alternates, the AMP link, and the JSON-LD (`@type` set, flattened through `@graph`, with headline, dates, name, url, author, image and language). It also checks the candidate's `robots.txt` and sitemap as a whole, and whether the final address of every URL that the live sitemap lists is in the candidate sitemap.

Rules worth knowing before reading a report:

- **Final status decides the blockers.** A live 200 must end in a candidate 200. A redirect on the way is fine if permanent (301 or 308) and a single hop; a 302, 303 or 307 is a warning (`redirect-temporary`), two hops or more is a warning (`redirect-chain`), a loop or more than ten hops is a blocker.
- **A redirect that only folds the trailing slash or the case does not rescue a missing page**: it is `url-missing`.
- **The canonical is judged against the candidate's own final address**, not against the live canonical, and its host against the live canonical host (or `--canonical-host`). A canonical that drops the query string the page was reached with (`?utm_source=`) is normal. A canonical that points where the live canonical also points elsewhere, to the same place, is parity.
- **Titles**: the site name and its separator are ignored (`X - Sakola Kembara` against `X | Sakola Kembara` is info; a "Yayasan" before the name and what follows it count as the site name, so `X - Yayasan Sakola Kembara Indonesia` against a bare `X` is info too); any other difference is a warning.
- **JSON-LD** is compared by family (Article, NewsArticle and BlogPosting are one; Organization, NGO and EducationalOrganization are one). A lost Article or BreadcrumbList is a warning, a lost Organization only on the home page; WebPage, WebSite, ImageObject, Person and the like are info.
- **A live URL that redirects while the candidate serves a page at it without redirecting** (`live-redirect-dropped`, for example `/?p=<id>`) is a warning, and the titles and tags of the two different pages are not compared.
- **A non-HTML file** (feed, PDF, image) is compared by status and content type only.

### The severity table

A URL counts by its worst finding. **BLOCKER**: do not cut over with one on a URL that ranks. **WARN**: a change someone looks at and accepts (with the reason written down) or fixes. **INFO**: benign or expected. A test pins this table to the code: every code and its severity must be here.

| Code | Severity | Meaning |
| --- | --- | --- |
| `status-mismatch` | BLOCKER | the live URL answers 200 and the candidate does not end in a 200 (5xx, other 4xx, timeout, network error, a redirect that leaves the site) |
| `url-missing` | BLOCKER | the live URL answers 200 and the candidate answers 404 or 410, with no redirect or only a trailing-slash fold |
| `redirect-to-missing` | BLOCKER | the candidate redirects the live URL somewhere that answers 404 or 410 |
| `redirect-loop` | BLOCKER | the candidate redirects in a loop or through more than 10 hops |
| `canonical-missing` | BLOCKER | the candidate page has no canonical link |
| `canonical-other-url` | BLOCKER | the candidate canonical points at a different URL than the page itself (or uses http) |
| `canonical-host` | BLOCKER | the candidate canonical is on another host than the live canonical (a staging host, or www against apex) |
| `noindex-introduced` | BLOCKER | the candidate says noindex (meta robots, googlebot or X-Robots-Tag) and the live page does not |
| `robots-txt-blocks-url` | BLOCKER | the candidate robots.txt disallows a URL that the live robots.txt allows |
| `robots-txt-blocks-all` | BLOCKER | the candidate robots.txt disallows the whole site |
| `candidate-sitemap-unavailable` | BLOCKER | the candidate sitemap does not answer 200 with a list of URLs |
| `title-changed` | WARN | the title differs (more than the site-name suffix) |
| `description-changed` | WARN | meta description differs |
| `description-missing` | WARN | the live page has a meta description and the candidate does not |
| `jsonld-type-dropped` | WARN | a rich-result JSON-LD type of the live page is missing on the candidate |
| `jsonld-field-changed` | WARN | headline, datePublished or dateModified of the JSON-LD differs |
| `jsonld-invalid` | WARN | a JSON-LD block of the candidate is not valid JSON |
| `h1-missing` | WARN | the live page has an h1 and the candidate has none |
| `h1-multiple` | WARN | the candidate has more than one h1 and the live page has one |
| `og-missing` | WARN | an Open Graph tag the live page has (title, description, image, url, type) is missing on the candidate |
| `og-url-mismatch` | WARN | the candidate og:url is not its canonical URL |
| `twitter-card-missing` | WARN | the live page has twitter:card and the candidate does not |
| `hreflang-dropped` | WARN | the live page has hreflang alternates and the candidate has fewer |
| `lang-changed` | WARN | the html lang changed to another language |
| `nofollow-introduced` | WARN | the candidate robots say nofollow and the live page does not |
| `redirect-temporary` | WARN | the candidate reaches the final URL through a 302, 303 or 307 |
| `redirect-chain` | WARN | the candidate needs more than one redirect hop |
| `live-redirect-dropped` | WARN | the live URL redirects somewhere and the candidate serves a page at that address with no redirect |
| `not-in-candidate-sitemap` | WARN | the live sitemap lists the URL and the candidate sitemap does not list its final URL |
| `staging-host-leak` | WARN | og:url, og:image, hreflang or JSON-LD of the candidate names the candidate host instead of the site |
| `soft-404-suspect` | WARN | the candidate answers 200 with a "not found" title or heading |
| `content-type-changed` | WARN | a live file (not HTML) is served with another content type |
| `amp-link-live` | WARN | the live page advertises an AMP version: check that the AMP URL redirects |
| `address-moved` | INFO | the candidate redirects the live URL permanently (301 or 308) to a different address that answers 200 |
| `redirect-shape-changed` | INFO | same final address, different redirects (for example the trailing slash is folded) |
| `title-suffix-changed` | INFO | the title differs only in the site-name suffix or its separator |
| `jsonld-type-added` | INFO | the candidate has a JSON-LD type the live page lacks |
| `jsonld-structural-dropped` | INFO | a structural JSON-LD type (WebPage, WebSite, ImageObject, Person, ...) is not on the candidate |
| `jsonld-minor-field-changed` | INFO | another JSON-LD field differs (url, author, image, language) |
| `h1-text-changed` | INFO | h1 text differs |
| `og-changed` | INFO | an Open Graph or Twitter value differs (not the presence) |
| `lang-region-changed` | INFO | html lang differs only in the region (id-ID against id) |
| `robots-meta-changed` | INFO | the robots meta directives differ (and neither side says noindex) |
| `description-added` | INFO | the candidate has a meta description the live page lacks |
| `served-where-live-404` | INFO | the live URL answers 404 or 410 and the candidate serves a page |
| `live-not-200` | INFO | the live URL does not end in a 200 (redirect to an error, 4xx, 5xx): there is no baseline to compare |
| `live-unreachable` | INFO | the live URL could not be fetched (timeout or network error): not compared |
| `skipped-by-robots` | INFO | robots.txt of the live site disallows the URL for this tool: not fetched |

### The reports

`report.md` (what a person reads: verdict, site-level checks, **every blocker**, warnings and info grouped by code with a few examples each, the **address-change map** that must be proven in Search Console, the legend) and `report.json` (every URL with both answers summarised, every finding, no page body). The exit code is 0 without blockers, 1 with blockers (1 with warnings too under `--fail-on warn`), 2 for a usage error. Reports of a real run describe the real site: keep them outside the repository (`.seo-parity/` is ignored).

### Recorded answers, and the offline mode

`--record DIR` saves every answer of a network side under `DIR/live` and `DIR/candidate`: a `manifest.json` (one entry per request path: status, content type, headers without cookies, the file holding the body) and the bodies. `--live-dir` and `--candidate-dir` read them back with **no network**, so a run can be repeated, reviewed and, most useful, **repeated after the cutover when the live site no longer exists**: the recorded live corpus against the production host. A recorded directory can also be written by hand; the committed sample (`cf/web/tests/fixtures/seo-parity/sample/`, invented pages, an article that moves and a page whose trailing slash folds) is the format's example and a test runs it.

## Rehearsal on this machine

```bash
cd cf/web
pnpm build
E2E_PORT_OFFSET=3000 pnpm seo:parity:local     # any free offset; ports are 8791, 4390, 4391, 9331 plus the offset
```

It starts the built Worker under `wrangler dev` (local mode, with the stub origin and the fixture API, as `pnpm test:e2e` does) as the candidate, and a stand-in (`scripts/lib/wp-stub.mjs`) as the live side: invented WordPress-shaped pages built from the candidate's own content (so the baseline is "the same words in WordPress clothes"), a Yoast-style `sitemap_index.xml`, one article page per article (86) at `/<category>/<slug>/`, `?p=<id>` redirects, a feed, and **differences planted on purpose**: three pages only the live side has (a BLOCKER each), a changed title, a BreadcrumbList the candidate does not render, an RSS feed, a page the candidate moves. It runs the real tool with `--include-images`, writes `.seo-parity/local/report.md`, and checks that everything planted was found, that every article redirect came out as one permanent hop to a 200 with no blocker, that the stand-in saw GET only with no cookie, and that the tool's own verdict is FAIL (because of the planted blockers). Exit 0 means the tool behaved.

Result of the rehearsal run for this task (2026-10-13, repeated for SAKEM-090 with 86 articles: 301 URLs, 3 blockers, all planted; the nine checks passed): 268 URLs compared, 3 blockers (the planted ones), the rest warnings and info; the eight checks passed. What it found **in the local candidate itself**, independent of any guess about WordPress, is findings F-03 to F-08 of the runbook ([`cutover-runbook.md`](cutover-runbook.md#12-findings-from-this-audit)): five prerendered pages answer a trailing-slash request with a **307**; `/category/*` is a 404 (the stand-in listed those URLs, the candidate's answer is real); `/?p=<id>` is not redirected; `/feed/` becomes HTML; an image name with a literal `@` makes a 308 then 307 chain.

## Parity fixes of 2026-10-13 (SAKEM-090)

Ticket SAKEM-090. The tool was run once against the **real** site on 2026-10-13 (Dzul approved: GET only, one request per second, 291 URLs), the answers were **recorded**, and this section is what the first reading of them changed. The report and the recorded pages are public pages only and live **outside the repository** (`~/seo-reports-sakola-kembara/2026-10-13/`); the "after" below was measured **offline** against that recorded copy (`--live-dir`), with no request to the live site.

### The first run (before)

291 URLs compared: **103 blockers, 174 warnings, 14 info only**, verdict FAIL.

- **97 `url-missing`** (the live sitemap lists them, the candidate answered 404): 13 WordPress pages (`/home/`, `/sample-page/`, `/who-we-are/`, `/our-partners/`, `/contact-us/`, `/donate/`, `/donation-confirmation/`, `/donation-confirmation-2/`, `/donation-failed/`, `/donation-failed-2/`, `/donor-dashboard/`, `/donor-dashboard-2/`, `/work-with-us/`), 7 category archives and 77 tag archives.
- **6 `redirect-to-missing`**: articles published on WordPress after the 80 were migrated. Their old address already redirected to `/blog/<slug>`, which was a 404.
- Warnings: `jsonld-type-dropped` 92 (a BreadcrumbList on every page), `lang-changed` 92, `description-changed` 84, `live-redirect-dropped` 80 (the `/?p=<id>` shortlinks), `title-changed` 49, `jsonld-field-changed` 5, `content-type-changed` 2; info: `jsonld-structural-dropped` 354, `title-suffix-changed` 43 and others.

### What the real pages showed (facts, read from the recorded HTML)

- The site is **WordPress 7.1 with the Astra theme, Elementor and All in One SEO 4.8.9** (the SEO plugin), **Google Site Kit** (a Google Analytics tag: the analytics decision of the runbook has a baseline there) and sitemaps `/sitemap.xml` (index), `/post-sitemap.xml`, `/page-sitemap.xml`, `/category-sitemap.xml`, `/post_tag-sitemap.xml`, plus `/sitemap.rss` in `robots.txt`. The responses carry `server: cloudflare` and a `cf-ray`: **the apex is already proxied by a Cloudflare zone** (whose account, nobody has checked), the origin is LiteSpeed.
- `<html lang="en-US">`, `og:locale` `en_US` and `inLanguage` `en-US`, **on Indonesian text**. (The ticket said the live site uses `id-ID`; it does not. `id-ID` is still the right value for the content and what the new site now says; the tool reports `lang-changed` on every page, which is intended.)
- Titles are `<page> - Yayasan Sakola Kembara Indonesia` on every page and on 33 of the 86 articles; the other 53 articles have no suffix (a per-post SEO setting). The home title is `Sakola Kembara, Pendidikan Untuk Semua`.
- JSON-LD is one `@graph`: on an article BlogPosting, BreadcrumbList, Organization, Person, WebPage, WebSite; on archives CollectionPage; a BreadcrumbList on **every** page, the home page included. Robots meta is only `max-image-preview:large`.
- The 13 pages are **Elementor templates and WordPress defaults** ("Home", "What We Do", "Donate", "Sample Page", Lorem ipsum text): nothing to preserve but the address.
- `/donasi/`, `/daftar/` and `/apply/` are **301s to external forms** (Google Forms, s.id) on the live site. The new site has its own `/donasi`: decided before, not a parity gap (the tool reports them as `live-unreachable`, info). **Since SAKEM-103 (Phase A, 2026-10-15) `/daftar` is no longer sent to `/gabung-siswa`: it is an admin shortlink, a 307 to the same external form the live `/daftar/` redirects to**, so the address keeps doing what it did (the live one is a 301; the new one is temporary on purpose: each cohort changes the target). **Since SAKEM-107 (2026-10-18) `/apply` is no longer sent to `/gabung-siswa` either: it is an admin shortlink too, a 307 to the volunteer form that the "Bergabung Menjadi Relawan" button of `/tim` uses**, so, like `/daftar`, it keeps doing what the live address does.
- **Four articles were edited on WordPress after the migration snapshot**: their live `dateModified` is later than ours, and one live headline differs ("Jasa Ahdan Mewujudkan..." against our "Tanpa Jasa Ahdan Mewujudkan..."); they were re-imported on 2026-10-15 ([below](#re-import-of-the-4-articles-edited-on-wordpress-2026-10-15-sakem-096)). One live meta description carries an unresolved SEO-plugin variable (`#post_excerpt` glued to the text), and two live titles are garbage (a title repeated four times, an author name appended).

### What was changed

| Finding | Change | Where |
| --- | --- | --- |
| 13 WordPress pages, 7 category and 77 tag archives answered 404 | **Permanent (308) redirects, one hop**, in the one redirect table: pages to `/`, `/tim`, `/kontak`, `/donasi`, `/gabung-siswa` (`/who-we-are/` and `/our-partners/` go straight to `/tim`: the approved wording says `/tentang-kami`, which is itself a 308 to `/tim`, so pointing at it would be a chain), `/category/*` and `/tag/*` (splats) to `/blog`. The names are reserved for shortlinks in `cf/admin` | `redirects.config.mjs`, `cf/admin/src/shortlinks/reserved.ts` |
| An old slug that 8 article bodies link to is not an article | `/blog/perjalanan-seorang-founder-rommy-mendirikan-...` redirects to `/blog/perjalanan-seorang-founder` (found by a test that reads every internal link of every article; the bodies were not edited) | `redirects.config.mjs`, `tests/redirects.test.ts` |
| 6 live articles had no page | **Imported** (below); their old addresses were already covered by the category rules | `content/blog`, `public/blog/images`, `lib/blog-posts.json` |
| `lang` | `id-ID` for `<html lang>` and JSON-LD, `id_ID` for Open Graph | `src/lib/seo.ts`, `src/layouts/Base.astro` |
| Titles | `<page> - Yayasan Sakola Kembara Indonesia`; the home title with the live comma. The root app's titles are unchanged and the tests that compared with them compare everything but the suffix | `src/lib/seo.ts`, `tests/helpers.ts` (`liveTitle`) |
| JSON-LD | One `@graph` per indexable page (the table of [`web-skeleton.md`](web-skeleton.md#seo-parity)): Organization, WebSite, WebPage or CollectionPage, BreadcrumbList; BlogPosting and Person on an article. Only data the site has: a day, never a time of day; a person by name; no invented author page. The home page has no breadcrumb (a trail of one step is not a trail) | `src/lib/seo.ts` (`buildGraph`), `tests/seo-graph.test.ts`, e2e |
| `og:type` | `article` with `article:published_time`, `modified_time`, `section` and the cover's size, like the live pages | `src/lib/seo.ts` |
| Meta description of the articles | The front matter `description` (the live page's own text, from the recorded pages, entities decoded, whitespace collapsed, the unresolved `#post_excerpt` token removed) on **85 of the 86 articles**; the site uses it before the excerpt for `<meta name="description">`, `og:description`, `twitter:description` and the JSON-LD description. **It reaches production through D1**: column `blog_posts.meta_description` (migration `0012`, additive and nullable), `description` on the public article answer, the import script, [`content-api.md`](content-api.md). The one article without it is `daffa-najwan` (its live description is "Manajemen, UGM", equal to its excerpt). The article bodies were not touched; `title` of one article had a literal `&#8216;` and now has the curly quote the live headline has | `content/blog/*.md`, `cf/admin` (schema, migration, `src/public/*`, import), `cf/web` (plugin, fixture, parser, page) |
| Trailing slash on five prerendered pages answered 307 (F-03) | **A config-only fix works locally**: the build writes `/<page>/  /<page>  308` for every `.html` file of `dist/client` (so a page added later is covered), and the assets layer's own 307 loses to it in the local emulation. Not proven on a real zone: T-19 | `redirects.config.mjs` (`slashFoldPaths`), `astro.config.mjs`, `tests/built.test.ts`, e2e |
| The tool compared a legal-name suffix as a title difference | `Yayasan <site name>` counts as the site name (a test per case) | `scripts/lib/seo-parity-core.mjs` |

### Before and after

Same tool, same recorded live pages, the candidate being the built Worker with the fixture API serving all 86 articles from `content/blog`. The groups: **article** = a WordPress article address (86), **main page** = the home page, `/blog/`, `/index.php` and the pages the live site does not have (`/tim/`...), **other page** = the other WordPress pages, `/feed/`, `/program/...`, **category** = `/category/*` (7), **tag** = `/tag/*` (77), plus the category archives at the root (`/cerita/`...) and the `/?p=<id>` shortlinks.

| Group | URLs (before / after) | Blockers before | Blockers after | Warnings before | Warnings after | Info only before | Info only after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| article | 86 / 86 | 6 | **0** | 80 | 86 | 0 | 0 |
| main page | 8 / 8 | 0 | 0 | 3 | 3 | 5 | 5 |
| other page | 26 / 27 | 13 | **0** | 4 | 17 | 9 | 10 |
| category (`/category/*`) | 7 / 7 | 7 | **0** | 0 | 7 | 0 | 0 |
| category archive (`/cerita/`...) | 7 / 7 | 0 | 0 | 7 | 7 | 0 | 0 |
| tag | 77 / 77 | 77 | **0** | 0 | 77 | 0 | 0 |
| `/?p=<id>` shortlink | 80 / 86 | 0 | 0 | 80 | 80 | 0 | 6 |
| **Total** | **291 / 298** | **103** | **0** | **174** | **277** | **14** | **21** |

The 7 extra URLs are the 6 shortlinks of the new articles (not in the recorded corpus: `live-unreachable`, info) and the old founder-article slug, which is now a source of the redirect table. **The number of warnings went up, and that is expected**: a URL that answered 404 had no comparison at all, and the same URL redirecting to another page is now compared with it (title, language, description). Those are comparisons of two different pages **by design** (a tag archive and the blog index), see below. **Zero blockers.**

### What is left, and why

Every remaining finding, by code, with the reason. None of them is a regression to fix; they are differences chosen on purpose or the live site's own faults.

| Code (count) | Where | Why it stays |
| --- | --- | --- |
| `lang-changed` (195) | every page | The live site declares `en-US` on Indonesian text. The new site says `id-ID`. Intended. |
| `title-changed` (115 since SAKEM-096; 114 before) | 77 tag, 14 category, 15 other pages, 1 blog index, 8 articles | 106 are redirects of one page to a **different** page (a tag archive to `/blog`, `/who-we-are/` to `/tim`): the two titles are different by design. `/blog/` is "Blog & Cerita" against the live "Blog" (the page's own heading, copy that is fixed). 8 articles: the live `<title>` is an SEO-plugin override or damaged (a trailing " -", an author name appended, a title repeated four times, "demi" against "Demi", "raih" against "Raih", straight against curly quotes, "PEndidikan", and since SAKEM-096 `tanpa-jasa-ahdan-...`: the live SEO title still says "Tanpa Jasa Ahdan..." while the post's own headline, now ours, says "Jasa Ahdan..."); the new text is the article's own title. |
| `description-changed` (17) | 13 other pages, the home page, `/index.php`, `/blog/`, 1 article | The pages are different pages (as above). The **home page**, `/index.php` and `/blog/` keep the legacy copy (`DEFAULT_DESCRIPTION`, fixed copy): the live home description is "Bersama, Kita Ciptakan Kesempatan Pendidikan Tinggi yang Setara!..." (open decision). The article is `perjalanan-mengajar-zulfa-jannati...`: the live text starts with the unresolved `#post_excerpt` token, which was removed. |
| `jsonld-type-dropped` (4) | `/`, `/index.php`, `/home/`, `/sample-page/` | The live home page has a BreadcrumbList of **one** step; the new home page has none (Google needs two steps). |
| `jsonld-field-changed` (8 before, **0** since SAKEM-096) | none | The four articles edited on WordPress after the migration were re-imported on 2026-10-15: our `dateModified` and headline are the live ones now. |
| `live-redirect-dropped` (80) | `/?p=<id>` | Accepted loss, **not handled in code**: `/` is a prerendered asset, `_redirects` cannot match a query string, and the Free plan has 10 Single Redirects. A zone Single Redirect is F-06 of the runbook. |
| `content-type-changed` (2) | `/feed/`, `/feed/atom/` | The live site serves RSS; the new site has no feed and sends them to `/blog` (F-07). Not an SEO change anyone asked for. |
| info: `og-changed`, `robots-meta-changed`, `jsonld-minor-field-changed`, `h1-text-changed`, `title-suffix-changed` (46 since SAKEM-096; 47 before), `description-added`, `address-moved`, `redirect-shape-changed`, `served-where-live-404`, `live-unreachable` | many | Differences of value that are improvements or identity: the cover instead of the logo as `og:image`, `index, follow, max-image-preview:large` (a superset of the live robots), `id-ID` against `en-US`, the brand name, the 53 live articles without a title suffix. |

### How the 6 articles were imported

The live sitemap lists 86 posts; `content/blog` held 80. The 6 missing are `sakola-kembara-hadirkan-kelas-belajar-tentang-literasi-keuangan-dan-keadilan-ekonomi`, `sakola-kembara-dan-komunitas-baca-tunisia-adakan-webinar`, `ketika-kemiskinan-mengancam-mimpi-seorang-anak`, `sakola-kembara-menyalakan-harapan-pendidikan-di-samarinda`, `jalur-selain-snbt-yang-bisa-jadi-opsi-buat-kamu-coba` and `ptkin-terbaik-di-indonesia-pilihan-kampus-islam-negeri-berkualitas-untuk-masa-depan-cerah` (published 2026-05-28 to 2026-08-21). They were read from the **WordPress REST API** (`/wp-json/wp/v2/posts?slug=<slug>&_embed`, the source the first 80 came from; the recorded HTML has the same posts) with the same pipeline as the first 80 (`scripts/lib/blog-pipeline.mjs`: `transformPost` of `scripts/scrape-blog.mjs`, `htmlToMarkdown`, the image and link rewrites): same front matter, slug identical to WordPress, `featured: false`, the images under `public/blog/images/<yyyy>/<mm>/` where `pnpm assets` derives the ladders. **Live requests: 15 in all** (6 articles, then the 9 images they use that the repository did not have), GET only, **one per second**, User-Agent `SakemSeoParity-Import/1.0`, `robots.txt` honoured (the live one disallows only `/wp-admin/`), no cookie, stopped at the first failure. Two things were corrected by hand in the result: a remote image URL the pipeline left in one body, and a link to the founder story's old slug in two bodies. The one-off importer is not in the repository: the WordPress site is going away, and the pipeline it used is.

### Re-import of the 4 articles edited on WordPress (2026-10-15, SAKEM-096)

Dzul decided on 2026-10-15 to take the **latest live version** of the four articles that were edited on WordPress after the migration snapshot. **Which four:** the recorded live pages of 2026-10-13 (read offline) say, for every article, a `dateModified` (JSON-LD and `article:modified_time`); compared with the `modifiedISO` of all 86 files, exactly four differ, and the WordPress REST `modified` read afterwards is the same to the second, so nothing changed on WordPress between the snapshot and the re-import.

| Article (`content/blog/<slug>.md`) | Our `modifiedISO` | Live modified | What the latest live version changes |
| --- | --- | --- | --- |
| `tanpa-jasa-ahdan-mewujudkan-murid-masuk-perguruan-tinggi` | 2026-05-21 | 2026-05-26 | The headline: "Jasa Ahdan Mewujudkan Murid Masuk Perguruan Tinggi" (was "Tanpa Jasa Ahdan..."). Body, excerpt and cover are the same. The article stays the featured one. |
| `mau-masuk-ptn-ini-tips-persiapan-kuliah-negeri-anti-gagal` | 2025-12-01 | 2026-08-31 | A new cover (`/blog/images/2024/12/Image-3.png`) and the same picture as the first element of the body. The text starts "iapa sih yang tidak ingin..." on the live page (the "S" of "Siapa" is missing there); kept as WordPress has it, in the body and in the excerpt (the live meta description had the same first word already). |
| `pendidikan-untuk-semua-tantangan-dan-solusi-dalam-pemerataan-akses-pendidikan` | 2025-12-01 | 2026-08-31 | A new cover (`/blog/images/2024/06/IMG_0978-1-scaled.jpg`) and a picture at the top of the body. |
| `ironi-aksara-membongkar-kesenjangan-pendidikan-indonesia` | 2025-12-01 | 2026-08-31 | A new cover (`/blog/images/2024/06/IMG_1101-scaled.jpg`) and a picture at the top of the body. |

**How.** The same pipeline as the 6 imported on 2026-10-13: the REST post (`/wp-json/wp/v2/posts?slug=<slug>&_embed`) through the transform of `scripts/scrape-blog.mjs` (title, excerpt, author, category, `modifiedISO`, cover), `htmlToMarkdown`, the image and link rewrites of `scripts/lib/blog-pipeline.mjs`, `writeMarkdownFile` (same front matter keys and order), then `npm run blog:sync` for `lib/blog-posts.json`. Kept from the existing files: the `featured` flag and the `description` (the REST API has none; the existing text equals the meta description of the recorded live page, which is later than the last edit of each of the four). The title suffix is not touched (every article gets " - Yayasan Sakola Kembara Indonesia"). **Live requests: 10 in all**, GET only, one per 1.1 seconds, User-Agent `SakemSeoParity-Import/1.0`, no cookie, stopped at the first failure (none): the 4 REST lookups above, then the 6 images the new versions use that the repository did not have (cover and inline picture of each of the three articles: `2024/06/IMG_1101-scaled.jpg`, `2024/06/IMG_1101-768x1024.jpg`, `2024/12/Image-3.png`, `2024/12/Image-3-1024x689.png`, `2024/06/IMG_0978-1-scaled.jpg`, `2024/06/IMG_0978-1-1024x768.jpg`, under `/wp-content/uploads/`). The other sizes a `srcset` lists were not requested (nothing refers to them). `robots.txt` was honoured from the copy recorded on 2026-10-13 (only `/wp-admin/` is disallowed): no new request for it. The previous covers of the three articles stay in `public/blog/images/` (nothing deletes a file the pipeline mirrored). `cf/admin/src/blog/legacy-images.json` was regenerated (`pnpm blog:legacy-images`, 6 more images): a test compares it with the asset pipeline.

**After**, same tool and same recorded live pages as above (`--live-dir`, no request to the live site; the candidate is the built Worker with the fixture API serving all 86 articles): **298 URLs, 0 blockers, 277 warnings, 21 info only**, the totals of the table above. `jsonld-field-changed` went from 8 to **0**; the four articles no longer differ in `dateModified`. One finding moved: for `tanpa-jasa-ahdan-...` the headline now agrees with the live JSON-LD, but the live `<title>` (the SEO plugin's own field) still says "Tanpa Jasa Ahdan...", so `title-changed` (WARN) is reported instead of `title-suffix-changed` (INFO). **Into D1:** the import script is an upsert by slug, so running it again updates these four rows (title, excerpt, content, cover, `updated_at`) unless an editor changed the row in the admin; nothing was applied anywhere in this change.

### The trailing-slash 307 (F-03)

The cause: for a prerendered page (`dist/client/donasi.html`) the Workers assets layer redirects `/donasi/` to `/donasi` itself with a **307**, and `assets.html_handling` has no setting for the status. The fix is **config only**: a static `_redirects` rule per page. Cloudflare documents `_redirects` as applied to static asset responses and does not say which of the two redirects wins, so it was tried in the local emulation (`wrangler dev`, local mode): **`/donasi/` answers 308**, the query string is kept, the origin is not asked, and `/donasi/` + `?utm_source=...` redirects once. A request with a doubled slash (`/donasi//`) still gets the layer's 307; nothing links to it. The rules are generated from the `.html` files of the build, so a page prerendered later is covered, and a test fails if one is not. **Whether the same wins on a real zone is T-19 of the runbook**: until it is checked there, the old warning (`redirect-temporary`) is the thing to look for. (Since SAKEM-105 `/donasi` is a page the Worker renders, so it folds its own slash and is no longer one of these pages: four are left, and T-19 asks `/gabung-siswa/`.)

### The reports moved into /donasi (SAKEM-105)

Decided by Dzul on 2026-10-16: `/laporan` is no longer a page, its content is the Laporan section of `/donasi` ([`web-skeleton.md`](web-skeleton.md#the-laporan-section-of-donasi-sakem-105)). What it means for search:

- **`/laporan` and `/laporan/` are one permanent hop (308) to `/donasi#laporan`**, answered by the assets layer; `/impact-reports` and below it go to the same place in one hop (they went to `/laporan`, which would have been two). A search engine that has `/laporan` indexed follows the 308 and keeps `/donasi`; the fragment is not sent to a server, so Google sees `/donasi`.
- **The page's `<title>`, description and JSON-LD (the site graph and its Laporan breadcrumb) went with it.** `/donasi` keeps its own, unchanged: title "Donasi", the same description, canonical `https://sakolakembara.org/donasi`, the site graph and the Donasi breadcrumb. The description does not mention reports; a text that does would be new copy and is Dzul's to approve (a proposal is in the pull request of SAKEM-105). Nothing was changed.
- **The sitemap lists `/donasi` and no longer `/laporan`** (a redirect is not a sitemap URL). `/donasi` keeps its priority and frequency.
- **The parity tool** lists `/laporan/` among the redirects of the table (it is a static source of `redirects.config.mjs`, so it is no longer written out in `MAIN_PATHS`), and reads it as a redirect to a page that exists: one 308 to a 200, INFO only (`served-where-live-404` in the local rehearsal, where the stand-in has no such page; on the real site whatever WordPress answers for `/laporan/` is compared the same way). Its local rehearsal checks exactly that: `scripts/seo-parity-local.mjs`, and `tests/seo-parity.test.ts` for the list.
- **`/donasi` is rendered by the Worker now**, so its head is checked on the Worker's answer (e2e group `donasi`) and no longer on a file of `dist/client`.
- **Not verified:** that Google treats the redirect to a section the way it treats any other 308 (it does not index fragments); that a real zone's assets layer keeps the fragment in `Location` (T-37 of the runbook).

### Not verified, and open decisions

- **Nothing on the real zone.** No Cloudflare account was used; everything above is the local Worker (`wrangler dev`, local mode) and the recorded live pages. Nobody opened a page in a browser: layout, the new breadcrumb data's appearance in a search result and the Rich Results Test were not looked at.
- **The migration `0012` and the import were run only against the test D1** (workerd, in the tests) and never against a deployed database. Deploy order: migration, then the API Worker, then the import.
- **The admin form has had a field for the description since SAKEM-094** ("Deskripsi meta", optional, at most 300 characters: [`admin-blog.md`](admin-blog.md#the-meta-description)), so an editor can set it; an article whose editor leaves it empty has none and uses its excerpt.
- **Open decisions for Dzul**: (1) the home, blog and tentang-kami meta descriptions: keep the legacy copy, or take the live text; (2) ~~re-import the 4 articles edited on WordPress since the snapshot~~ decided on 2026-10-15 (take the latest live version) and done, SAKEM-096; (3) the suffix on articles (all with it, as now; or none, as 53 of the live ones); (4) `/who-we-are/` and `/our-partners/` straight to `/tim` (as done) or two hops through `/tentang-kami`; (5) `en-US` was never `id-ID` on the live site: the ticket's premise was wrong, the value chosen stands; (6) the author archives (`/author/<name>/`, not in the live sitemap) and the old sitemap names (F-08) were not added: not in the approved mapping.

### Repeating the proof (no network beyond loopback)

```bash
cd cf/web
pnpm build
E2E_PORT_OFFSET=5100 pnpm serve:candidate      # prints "READY <address>": the built Worker, the fixture API serving all of content/blog
# in another terminal:
node scripts/seo-parity.mjs --live-dir ~/seo-reports-sakola-kembara/2026-10-13/recorded-live-and-candidate/live \
  --candidate-base <the address it printed> --delay-ms 0 --out /some/private/folder
```

`--live-dir` reads the recorded pages (no request to the live site); `--delay-ms 0` is allowed because the candidate is on localhost. The rehearsal against the invented stand-in (`pnpm seo:parity:local`) was updated: the stand-in plants three missing pages, a changed title, a dropped breadcrumb (now on the home page) and a feed, and checks the 86 article redirects (301 URLs, 3 blockers, all planted).

## What it cannot see

- The real WordPress HTML: any assumption about Yoast, AMP, breadcrumbs or hreflang is untested until a real run.
- JavaScript-rendered content (it reads the HTML a crawler gets before rendering), structured-data validity as Google judges it, `Link:` header canonicals, hreflang correctness beyond presence.
- How Google will treat the changes (that is the Search Console plan below), and anything about speed (next section).
- Cache behaviour: a run measures answers, not hits. Cache is the runbook's cache checklist.

## Core Web Vitals plan (PageSpeed Insights)

**Not run. Each run needs Dzul's approval, because it sends the URLs to Google and uses his quota or key.** The plan, for when he agrees:

| Item | Plan |
| --- | --- |
| URLs | home `/`; `/blog`; one long article; one short article; `/tim`; `/kontak`; `/gabung-siswa`; `/donasi`; `/laporan` (a page then; since SAKEM-105 a redirect to `/donasi#laporan`, so measure `/donasi`, which carries the reports); one program page (10 URLs, the same paths on the live site and on the candidate) |
| Strategies | mobile and desktop |
| Budget | 10 URLs x 2 strategies = 20 combinations per site and occasion, three runs each for a median = 60 requests; three occasions (the live site before the cutover, staging, production the week after) and the live site again for comparison at staging time = about 240 requests in all, a small fraction of the free daily allowance of the API; no key is committed, no key in a ticket, results are summarised in SAKEM-084 as numbers |
| Method | the PageSpeed Insights page or API with the URL; three runs per URL and the median, since a single lab run varies; record LCP, INP (field only), CLS, TBT, Speed Index, the performance score |
| Thresholds | the "good" band at the 75th percentile: **LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less**; lab performance score 90 or more on the candidate; **no page worse than live** on LCP or CLS |
| Lab against field | PageSpeed shows field data (CrUX) only for an origin with enough real traffic. **`workers.dev` staging has none, and the new production host starts empty**, so before the cutover only the lab half can be compared, and the field half is read from Search Console's Core Web Vitals report 28 days or so after the cutover |
| Known inputs from the build | the home page ships about 3.9 KB gzip of JavaScript up front and lazy-loads the map ([`web-skeleton.md`](web-skeleton.md)); fonts are self-hosted with no size-adjusted fallback, so a layout shift from the font swap is the thing to watch in CLS |
| Cache | staging on `workers.dev` runs with no cache effect (decided), so its timings are the worst case; the production timings after the cutover are the ones that count |

## Search Console and monitoring plan

All of it needs Dzul's Google account; the agent prepares lists and checks, he clicks.

**Before the cutover.**

1. The property is a **Domain property verified by a DNS TXT record**, not by an HTML file or a plugin meta tag (those die with WordPress). The verification TXT is part of the DNS inventory and must be in the imported Cloudflare zone.
2. **Baseline export** of the Performance report by page and by query for the longest range offered, and the Pages (indexing) report counts, saved privately. Without it nobody can tell a normal post-migration dip from a loss.
3. The list of the **top URLs**: the 20 pages with the most clicks, from that export. They are the URLs inspected after the cutover; the first ten of them are also in the PageSpeed list when they are not already there.

**After the cutover** (the runbook's X-steps): submit `https://sakolakembara.org/sitemap.xml`; leave the old sitemap URLs redirecting to it for a while and then remove the old entry; **URL Inspection on the top URLs**: "Test live URL" must say the page is available, and the declared canonical must be the new address; request indexing for the home page and the most important ten (the tool has a daily quota); then watch.

| When | Look at | Healthy | Act when |
| --- | --- | --- | --- |
| +1 hour and +1 day | Inspect the home page and two articles: live test | available, canonical as declared, no "blocked by robots.txt", no "noindex" | any of these is wrong: that is a rollback trigger in the runbook |
| first week, daily | Pages report: "Page with redirect" rising | rising towards the number of old URLs (about 86 articles plus pages) | it is flat while the "Not found (404)" count rises |
| first week, daily | Pages report: "Not found (404)", "Soft 404", "Server error (5xx)", "Redirect error" | 404s only for URLs that never existed | any 5xx or "Redirect error"; a 404 on a URL the live sitemap listed (add a redirect) |
| weeks 1 to 4, twice a week | Pages report: "Duplicate, Google chose different canonical", "Alternate page with proper canonical tag" | a few | many articles: the canonical or the redirect map is wrong |
| weeks 1 to 4, weekly | Performance against the baseline, by page | a dip in the first two to four weeks is normal for an address change with a correct redirect map | impressions down by more than half for a week with the redirects proven: investigate (the pages that lost the most, their final URLs and canonicals) |
| weeks 2 to 6 | Settings, Crawl stats | crawl requests continue, response time stable, no rise in errors | host errors or a response-time rise |
| week 4 | Core Web Vitals report | URLs in "good" | URLs in "poor" or "needs improvement" at the 75th percentile |
| any time | the SEO parity tool in offline mode against the recorded live corpus (the third command above) | no blocker | a blocker appeared after a deploy |

**Change nothing that moves a ranking address for 30 days after the cutover**: no slug edits (the admin already locks a published slug, [`admin-blog.md`](admin-blog.md)), no change of `SITE_URL`, the trailing-slash policy, the canonical host or the redirect table except to add a missing redirect, no mass title or description rewrite. Bing Webmaster Tools can import the property from Search Console. There is no "Change of address" step: the domain does not change.

**Analytics: replaced (SAKEM-095, decision D-07 of 2026-10-15).** The live WordPress site counts visits with **Google Site Kit (a Google Analytics tag)**. The new site counts them with **Cloudflare Web Analytics** (free, no cookies, no consent banner): one beacon script, rendered only when `WEB_ANALYTICS_BEACON_ID` is set (in the build for the prerendered pages and as a `--var` for the pages the Worker renders), so local runs, tests and staging carry none. It is built and tested locally with an invented id; the real site, its token and the first hit are the owner's steps ([`cutover-runbook.md`](cutover-runbook.md): P-24, T-25, T-26), and how it works is in [`web-skeleton.md`](web-skeleton.md#web-analytics-sakem-095-decision-d-07). The old Google Analytics history stays in the Google account; nothing here exports it, so until Web Analytics has run for a while the only traffic baseline from before the cutover is Search Console's and whatever Dzul exports from Google Analytics himself. The SEO parity tool reads the `<head>` and the JSON-LD, which the beacon (a tag at the end of `<body>`) does not touch.
