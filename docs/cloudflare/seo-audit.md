# SEO audit: the parity tool, the Core Web Vitals plan, the Search Console plan

Ticket: SAKEM-084, task M5-B. The cutover steps that use these tools are in [`cutover-runbook.md`](cutover-runbook.md); the risks they are meant to catch are in its risk register.

**Status.** The tool is built and unit-tested with recorded fixtures and no network (`cf/web/tests/seo-parity.test.ts`), and rehearsed on this machine against the built Worker and a WordPress-shaped stand-in ([Rehearsal](#rehearsal-on-this-machine)). **It has not been run against the real site, against staging, or against any Cloudflare resource**: that needs Dzul's approval, one run at a time. **Nobody has seen the real WordPress site's HTML in this repository**: the stand-in is invented from what WordPress and its usual SEO plugin typically produce, so a clean rehearsal proves the tool and the local candidate, never the live site. No PageSpeed Insights run and no Search Console step has been done.

## What "parity" means here

The live site `sakolakembara.org` runs on WordPress today. The new site (Astro on Workers, [`web-skeleton.md`](web-skeleton.md)) has to hold the ranking the old one earned. Three facts shape the audit:

- **The address of every article changes.** WordPress serves `/<category>/<slug>/` (all 80 source URLs in `lib/blog-posts.json` have that shape); the new site serves `/blog/<slug>`. Parity for an article is therefore a **proven permanent redirect to a page that says the same things**, not the same URL. All 80 are redirected with a 308 (Google treats 308 like 301) and that is tested ([`redirects.test.ts`](../../cf/web/tests/redirects.test.ts) and the e2e group `wp-redirects`).
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

1. The main pages and the legacy entry points (`MAIN_PATHS`: `/`, `/blog/`, `/tim/`, `/kontak/`, `/donasi/`, `/laporan/`, `/gabung-siswa/`, the three program pages, and the static sources of `redirects.config.mjs`), in WordPress spelling (trailing slash).
2. The **80 WordPress article URLs** (`sourceUrl` of `lib/blog-posts.json`) and their **80 `/?p=<wpId>` shortlinks** (WordPress answers those with a redirect to the post; `--no-wp-ids` leaves them out).
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
- **Titles**: the site name and its separator are ignored (`X - Sakola Kembara` against `X | Sakola Kembara` is info); any other difference is a warning.
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

It starts the built Worker under `wrangler dev` (local mode, with the stub origin and the fixture API, as `pnpm test:e2e` does) as the candidate, and a stand-in (`scripts/lib/wp-stub.mjs`) as the live side: invented WordPress-shaped pages built from the candidate's own content (so the baseline is "the same words in WordPress clothes"), a Yoast-style `sitemap_index.xml`, 80 article pages at `/<category>/<slug>/`, `?p=<id>` redirects, a feed, and **differences planted on purpose**: three pages only the live side has (a BLOCKER each), a changed title, a BreadcrumbList the candidate does not render, an RSS feed, a page the candidate moves. It runs the real tool with `--include-images`, writes `.seo-parity/local/report.md`, and checks that everything planted was found, that all 80 article redirects came out as one permanent hop to a 200 with no blocker, that the stand-in saw GET only with no cookie, and that the tool's own verdict is FAIL (because of the planted blockers). Exit 0 means the tool behaved.

Result of the rehearsal run for this task (2026-10-13): 268 URLs compared, 3 blockers (the planted ones), the rest warnings and info; the eight checks passed. What it found **in the local candidate itself**, independent of any guess about WordPress, is findings F-03 to F-08 of the runbook ([`cutover-runbook.md`](cutover-runbook.md#12-findings-from-this-audit)): five prerendered pages answer a trailing-slash request with a **307**; `/category/*` is a 404 (the stand-in listed those URLs, the candidate's answer is real); `/?p=<id>` is not redirected; `/feed/` becomes HTML; an image name with a literal `@` makes a 308 then 307 chain.

## What it cannot see

- The real WordPress HTML: any assumption about Yoast, AMP, breadcrumbs or hreflang is untested until a real run.
- JavaScript-rendered content (it reads the HTML a crawler gets before rendering), structured-data validity as Google judges it, `Link:` header canonicals, hreflang correctness beyond presence.
- How Google will treat the changes (that is the Search Console plan below), and anything about speed (next section).
- Cache behaviour: a run measures answers, not hits. Cache is the runbook's cache checklist.

## Core Web Vitals plan (PageSpeed Insights)

**Not run. Each run needs Dzul's approval, because it sends the URLs to Google and uses his quota or key.** The plan, for when he agrees:

| Item | Plan |
| --- | --- |
| URLs | home `/`; `/blog`; one long article; one short article; `/tim`; `/kontak`; `/gabung-siswa`; `/donasi`; `/laporan`; one program page (10 URLs, the same paths on the live site and on the candidate) |
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
| first week, daily | Pages report: "Page with redirect" rising | rising towards the number of old URLs (about 80 articles plus pages) | it is flat while the "Not found (404)" count rises |
| first week, daily | Pages report: "Not found (404)", "Soft 404", "Server error (5xx)", "Redirect error" | 404s only for URLs that never existed | any 5xx or "Redirect error"; a 404 on a URL the live sitemap listed (add a redirect) |
| weeks 1 to 4, twice a week | Pages report: "Duplicate, Google chose different canonical", "Alternate page with proper canonical tag" | a few | many articles: the canonical or the redirect map is wrong |
| weeks 1 to 4, weekly | Performance against the baseline, by page | a dip in the first two to four weeks is normal for an address change with a correct redirect map | impressions down by more than half for a week with the redirects proven: investigate (the pages that lost the most, their final URLs and canonicals) |
| weeks 2 to 6 | Settings, Crawl stats | crawl requests continue, response time stable, no rise in errors | host errors or a response-time rise |
| week 4 | Core Web Vitals report | URLs in "good" | URLs in "poor" or "needs improvement" at the 75th percentile |
| any time | the SEO parity tool in offline mode against the recorded live corpus (the third command above) | no blocker | a blocker appeared after a deploy |

**Change nothing that moves a ranking address for 30 days after the cutover**: no slug edits (the admin already locks a published slug, [`admin-blog.md`](admin-blog.md)), no change of `SITE_URL`, the trailing-slash policy, the canonical host or the redirect table except to add a missing redirect, no mass title or description rewrite. Bing Webmaster Tools can import the property from Search Console. There is no "Change of address" step: the domain does not change.

**Analytics.** WordPress very likely has a visitor-statistics plugin or tag, and the new site has none (the footer year and the navbar are its only scripts). Which tool replaces it, and whether it needs a consent banner, is an open decision for Dzul ([runbook, open decisions](cutover-runbook.md#open-decisions-for-dzul)); until it is decided there is no traffic baseline except Search Console's.
