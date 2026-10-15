# Cutover and rollback runbook: sakolakembara.org from WordPress to Cloudflare

Ticket: SAKEM-084 (M5), task M5-B. Written for **Dzul on the day**; the agent's part is to prepare lists, commands and checks beforehand and to read results back. Companion documents: the SEO tool and its plans in [`seo-audit.md`](seo-audit.md); the account in [`account-setup.md`](account-setup.md); the routing design in [`portal-architecture.md`](portal-architecture.md#3-d1-how-sakolakembaraorgportal-reaches-the-portal) and [`web-skeleton.md`](web-skeleton.md). M5-A writes `free-plan-audit.md` and `staging-runbook.md` (staging, CPU numbers, the Free-plan audit): this runbook points at them by name and does not repeat them.

**Status: paper.** Nothing in this runbook has been done. No Cloudflare account, DNS provider, registrar or live URL was used to write it; the Cloudflare documentation was read on 2026-10-13 (sources at the end). What is verified by tests today and what is paper is in [section 2](#2-what-is-verified-today-and-what-is-paper).

> **GO-LIVE IS BLOCKED ON M4 (student registration).** `/portal/*`, `/login` and `/register` have **no backend** until M4 (SAKEM-083) resumes: `/login` and `/register` are 308 redirects into `/portal/...`, the navbar's "Masuk" and the "Daftar Sekarang" buttons point there, and in production the web Worker would answer all of them with its 404 page (finding F-02). The cutover cannot happen until M4 is done or Dzul has recorded an explicit decision about what registration does at launch (P-01).

> **PHASE A (decided by Dzul on 2026-10-15) DOES NOT WAIT FOR M4.** The public site and the admin move first and the student portal follows later (Phase B); sign-up goes through the shortlink `/daftar` to the registration form WordPress uses today. [Section 14](#14-cutover-phase-a-the-public-site-and-the-admin-first-sakem-104) is the day's runbook for Phase A and says, step by step, which of the IDs below apply, which are deferred and which change. The sections above it stay as the reference for those IDs.

## 0. How to read this document

- Every step has an ID and a **Who** cell: **needs Dzul** (a real action in an account, DNS, the registrar or a browser: only he does it, or approves it per step) or **agent may prepare** (a list, a script, a command, a text to paste, a read-back of results; the agent never touches an account). Some say both.
- A step in a table is a step to **tick**. Do not skip a hold point (H1, H2).
- No secret, token, account id, resource id or password is written here or goes into a ticket: write "done" or "failed", never the value ([`account-setup.md`](account-setup.md)). The DNS inventory and every report of a real run live **outside the repository**.
- Times are in WIB (UTC+7) unless a step says UTC (Cloudflare's daily limits reset at midnight UTC, 07:00 WIB).

## 1. Decisions this runbook relies on (Dzul, not reopened here)

- The site is **live on WordPress today**; the Next app was never released and the VPS is no longer used. **The rollback target is the WordPress site, reached through DNS and Cloudflare settings.** (`docs/runbook/launch.md` and `docs/roadmap/mvp-roadmap.md` still describe a VPS cutover: they are superseded by this runbook for the Cloudflare plan.)
- New site: Astro on Workers Free (`cf/web`), the API and admin Worker (`cf/admin`), D1, R2, Resend. $0.
- Staging runs on `*.workers.dev`: **no cache behaviour is tested there** (the Cache API is documented to work on custom domains and routes; `workers.dev` is not mentioned). The zone `sakolakembara.org` moves to Cloudflare (nameservers) **only on cutover day**, with every record copied identically and kept DNS-only first. The zone may not be in the organisation account yet: this runbook assumes it is not. (**Updated 2026-10-15:** it is now active in the organisation account with the WordPress site live behind it; see [section 14.1](#141-what-changed-since-sections-1-to-13-were-written).)
- Every real Cloudflare or DNS action needs Dzul's explicit OK, per step.
- Shortlinks of the old Postgres were not migrated: the real ones are recreated in the new admin before cutover (P-07).
- All work lives on the long-lived branch `cloudflare`.
- **2026-10-15: cutover Phase A.** The public site and the admin first, the portal later; the zone is already active in the organisation account. Concrete steps, tests and rollback: [section 14](#14-cutover-phase-a-the-public-site-and-the-admin-first-sakem-104).

## 2. What is verified today and what is paper

| Statement | Status | Evidence |
| --- | --- | --- |
| All 80 WordPress article URLs redirect to `/blog/<slug>` with a 308, with and without the trailing slash; every rule of the table has its status | **verified by tests** (local) | `cf/web/tests/redirects.test.ts`, `scripts/e2e.mjs` group `wp-redirects` |
| `sitemap.xml` (static routes, programs, every article from the API), `robots.txt`, the security headers | **verified by tests** (local) | `tests/headers-sitemap.test.ts`, e2e |
| Title, description, canonical, robots, Open Graph, Twitter, Article, Program and Organization JSON-LD of the pages | **verified by tests** (local) | `tests/seo.test.ts`, the built-page tests, e2e |
| Unknown URLs are a real 404 with noindex; an API outage is a 503, never a 404 | **verified by tests** (local) | e2e groups `404`, `blog` |
| Content cache: 60 s fresh window, stale-if-error, a 503 that is never cached, a 404 remembered 30 s | **verified locally** against workerd's emulation of `caches.default` and against fakes; **not on a real zone** | `tests/content-api*.test.ts`, e2e group `blog` (the `x-blog-source` header says `network`, `cache`, `stale`, `empty` or `not_found`) |
| The SEO parity tool and its rules | **verified**: 126 unit tests on recorded fixtures, a fake fetch and the two documents, no network; a local rehearsal | `tests/seo-parity.test.ts`, `pnpm seo:parity:local` |
| The Web Analytics tag (one script per page and only when configured; the same id on prerendered and rendered pages; none on the admin or the portal; no Content-Security-Policy to extend; an invalid id ignored and never echoed) | **verified by tests** (local, with an invented id) | `tests/web-analytics*.test.ts`, `scripts/e2e.mjs` group `analytics`, `scripts/e2e-analytics.mjs`, `pnpm test:negative:web-analytics` |
| The production command printers and dry runs of the two Phase A Workers, the offline check of a zone export, and the read-only production checker with its Phase A expectations | **verified by tests** (local, recorded and invented answers, no network); **never run against the account, the zone or the live site** | `cf/web/tests/production-scripts.test.ts`, `production-check.test.ts`, `zone-export.test.ts`, `cutover-runbook.test.ts`, `pnpm test:negative:production`; [section 14](#14-cutover-phase-a-the-public-site-and-the-admin-first-sakem-104) |
| Everything involving a zone, nameservers, DNS records, proxy, TLS modes, routes, Custom Domains, redirect and WAF rules, Search Console, Resend, Turnstile, Web Analytics (a real hit in the dashboard), real D1 and R2, real CPU on the Free plan, the real WordPress HTML | **paper** | nothing in this repository exercises it |

## 3. Preconditions

All must be true before the window opens. "Evidence" is what is attached to SAKEM-084 as a comment (names and numbers, no values).

| ID | Precondition | Owner | Evidence | Who |
| --- | --- | --- | --- | --- |
| P-01 | **M4 is done, or the registration decision is recorded.** Options: (a) wait for M4 (recommended); (b) go live with "Daftar Sekarang" and "Masuk" pointing at the registration form WordPress uses today (a small `cf/web` change: the CTA, the navbar link and the `/login`, `/register` redirects), and M4 later; (c) not decided: **do not cut over**. | Dzul, PM | the PR of M4, or a comment with the decision and the PR of the change | needs Dzul |
| P-02 | Staging passed Dzul's visual and interaction QA (nobody has looked at the pages in a browser in this repository) and the staging checklist of SAKEM-084 | Dzul | his sign-off comment | needs Dzul |
| P-03 | The **SEO parity report against staging has no blocker**, every warning is triaged (fixed, or accepted with a written reason), and the live corpus is recorded with `--record` | Dzul runs it, agent reads it | the summary line and the triage list; the files stay private | needs Dzul (agent may prepare) |
| P-04 | **CPU per route on the Free plan recorded** (p50 and p99, no 1102 on any route), from M5-A's measurement | M5-A, Dzul | M5-A's numbers | needs Dzul |
| P-05 | Production D1 has the migrations, the **86 articles** (the 80 migrated and the 6 WordPress had published by 2026-10-13, imported in SAKEM-090) and every article WordPress publishes **after that** (re-scraped, and its `description` from the live page's meta description); the live sitemap and the candidate sitemap list the same set (the tool shows no `url-missing` for a post) | Dzul | counts: D1 rows against the live sitemap | needs Dzul (agent may prepare) |
| P-06 | The **privacy policy page (SAKEM-056) is live** and linked from the contact form, the register page and the wizard | Dzul, PM | the URL answers 200 | needs Dzul |
| P-07 | The **real shortlinks are recreated** in the new admin (list from the old Postgres or from printed material); each answers 307 to its target | Dzul | the list of slugs and a 307 check | needs Dzul |
| P-08 | The **first super_admin** exists in the production D1 ([`first-super-admin.md`](first-super-admin.md)) and a second one is invited; nobody's password went through chat | Dzul | "done" | needs Dzul |
| P-09 | Variables and secrets set, **names only**: `TURNSTILE_SITE_KEY` (web and admin), `TURNSTILE_SECRET_KEY` (API), `UPLOADS_BASE_URL` (web and admin), `SITE_URL` (admin), `ADMIN_URL` (web, and the portal's "this is an admin account" link), `WEB_ANALYTICS_BEACON_ID` (web, public, **both** in the build's shell and as `--var`: P-24), `PORTAL_CONTACT_WHATSAPP` and `PORTAL_WHATSAPP_GROUP_URL` (portal only, OPTIONAL, public: the admissions desk's WhatsApp number as digits with the country code, and the participants' WhatsApp group invitation as an https address; unset or invalid means the wizard shows its "Kontak" fallback and no invitation; the school supplies both values; they are never written in a tracked file), `EMAIL_FROM`, the Resend key, `AUDIT_RETENTION_DAYS`, a **different `BETTER_AUTH_SECRET` for the admin and the portal Worker**; **`LEGACY_ORIGIN_URL`, `CONTENT_API_URL` and `CONTACT_API_URL` NOT set** (a test checks the checked-in config only: Dzul checks the deployed one in the dashboard); the Worker name `sakem-admin` equal in both `wrangler.jsonc` files | Dzul | "done" per name | needs Dzul |
| P-10 | The **Resend domain is verified** and its DNS records are in the DNS inventory (so they exist in the imported zone too) | Dzul | "verified" in the Resend dashboard | needs Dzul |
| P-11 | Turnstile widgets exist for the real host (the hostname list includes `sakolakembara.org`), and the real widget was seen working on a phone | Dzul | "done" | needs Dzul |
| P-12 | **WordPress backups exist and were checked**: the database dump, the whole `wp-content` (uploads, theme, plugins), the plugin list, stored in two places outside the hosting; `wp-config` is not copied around (it holds secrets) | Dzul | sizes and checksums | needs Dzul |
| P-13 | The **DNS inventory is complete** (section 4) and a second person compared it with the provider's dashboard | Dzul + one more | "reviewed by" | needs Dzul (agent may prepare) |
| P-14 | **TTLs lowered** as in section 5, with `dig` showing it | Dzul | the `dig` lines | needs Dzul |
| P-15 | **DNSSEC state known**; if it is on at the registrar, the plan of section 5 is followed | Dzul | "off" or the plan | needs Dzul |
| P-16 | Search Console: **Domain property verified by DNS TXT**; baseline exports saved (section 11); the top-20 URL list made | Dzul | "done" | needs Dzul |
| P-17 | Analytics decision made (D-07). **Decided by Dzul on 2026-10-15: Cloudflare Web Analytics** (free, cookie-free, no consent banner), replacing Google Analytics; the work is P-24 | Dzul | the decision (recorded as D-07) | needs Dzul |
| P-18 | **Production Workers deployed with no route and no Custom Domain**, D1 and R2 created, migrations applied (the deploy changes no traffic until S-33) | Dzul | worker names listed | needs Dzul |
| P-19 | The code decisions of section 12 are **merged**: HSTS value (F-01), the empty pass-through list (F-10), and the redirect additions Dzul accepted (F-03 to F-08) | agent prepares the PRs | merged PR links | agent may prepare |
| P-20 | Account safety nets: a **usage or billing notification** on the organisation account; the fail mode of the route decided (D-06) | Dzul | "done" | needs Dzul |
| P-21 | **The window**: a weekday morning, away from a registration or announcement campaign, Dzul reachable for at least four hours after the switch, not the day before a holiday; Rommy and the team told ([section 10](#10-what-to-keep-of-wordpress-and-communication)) | Dzul | the date | needs Dzul |
| P-22 | The **rollback was rehearsed** on the throwaway hostname (S-21) in this window or on an earlier day of zone activity, with its timing noted | Dzul | the timing | needs Dzul |
| P-23 | **Log retention and URL-token exposure decided.** Workers Logs keeps the full request URL of every invocation (the verification-link and OAuth-callback tokens in the query string included) for 3 days, and from 2026-12-01 for 7 days under a 0.5 GB daily allowance ([`free-plan-audit.md`](free-plan-audit.md#5-observability)). `invocation_logs` stays on during M5, because the CPU record needs it. Before the switch decide: accept as it is, or turn invocation logs off once the CPU numbers are recorded, and who may open Workers Logs in the account | Dzul, PM | the decision | needs Dzul |
| P-24 | **Cloudflare Web Analytics is set up (D-07, SAKEM-095).** (a) In the Cloudflare dashboard of the **organisation** account, Web Analytics, **Add a site** for the hostname `sakolakembara.org` (the manual setup: a JS snippet). Once the zone is on Cloudflare, the zone's **automatic injection stays off** for that hostname: Cloudflare reads one snippet per page, and the site already carries its own. (b) Copy the **site token**, the 32 hexadecimal characters of `"token"` in the snippet. It is a public value (it is in every page), but it is still not written in the repository, a ticket or a chat; "done" is the evidence. (c) **Build** the production site with it on the command line, `WEB_ANALYTICS_BEACON_ID=<token> pnpm build` (never `export`ed: a staging build in the same shell would pick it up; this reaches the prerendered pages: `/`, `/donasi`, `/gabung-siswa`, `/program/<id>`), and **deploy** with `--var WEB_ANALYTICS_BEACON_ID:<token>` (the pages the Worker renders: the blog, `/tim`, `/laporan`, `/gabung-siswa/docs`, `/kontak`, the 404 page). The same value in both, or half the pages have no beacon (T-25). Never a `.dev.vars` entry for it. (d) The staging Worker does not get it. (e) **Note for the privacy policy page (SAKEM-056, P-06):** visits are counted with Cloudflare Web Analytics, which uses **no cookies** (Cloudflare says the beacon stores and reads nothing in the browser, sends page-load timings and discards the IP address), so there is no consent banner (D-07); the wording is Dzul's. Details and sources: [`web-skeleton.md`](web-skeleton.md#web-analytics-sakem-095-decision-d-07) | Dzul | "done" (no value) | needs Dzul |

## 4. DNS inventory procedure

Goal: a table of **every** DNS record of the zone, exported from where the zone lives **today**, before anything moves. The inventory is private (a password manager note or an encrypted file; **not the repository, not a ticket**). A record that is missing from it is a record that will be missing after the move: Cloudflare's own import is a "quick scan" and is documented as **not guaranteed to find all existing records**.

1. **Find out where the zone is served and where the domain is registered** (they can differ): `dig NS sakolakembara.org +short` names the DNS provider; `whois sakolakembara.org` names the registrar. Note both, and who holds the logins. [needs Dzul]
2. **Export the zone** from the DNS provider's dashboard (a BIND zone file if it offers one) and take a screenshot of every page of records as a second source. Store both privately. [needs Dzul]
3. **Cross-check with queries** for each name below and each record type, and write what you get next to the export (a list of commands the agent may prepare: `dig +noall +answer <name> <type>` over the names and types below). Names to try: the apex, `www`, `mail`, `smtp`, `imap`, `pop`, `ftp`, `cpanel`, `webmail`, `autodiscover`, `autoconfig`, `_dmarc`, `_domainkey` selectors you know (`default`, `google`, `k1`, `selector1`, `selector2`, `resend`), `_acme-challenge`, `staging`, `admin`, and every subdomain on the export. [agent may prepare, needs Dzul to run or approve]
4. **Types to look for**, on the apex and on each name: A, AAAA, CNAME, MX (with priority), TXT (SPF `v=spf1`, DKIM, DMARC, every verification string such as `google-site-verification`), CAA, SRV, NS (a delegated subdomain), HTTPS or SVCB, wildcard `*` records, and **DS** (DNSSEC, `dig DS sakolakembara.org +short`, and the registrar's DNSSEC page).
5. **Fill the table below** (one row per record, no value is written in this document). Mark the proxy default for the new zone: **every record DNS-only**, and only the apex and `www` become proxied later (S-31).
6. **Record how WordPress identifies itself** in a response (one or two distinctive headers or the `generator` meta) and its response headers on the apex, including whether it sends `Strict-Transport-Security`: used by RB-2 to tell WordPress from the new site, and by F-01.
7. **Second reviewer** compares the table with the dashboard and ticks "reviewed". [needs Dzul]

Blank template (copy it into the private note; do not fill it here):

| Name | Type | Content or target | Priority | TTL now | Proxied at old provider | What it is for and who owns it | Where I got it (export, dig, dashboard) | Present in the Cloudflare import | Identical in Cloudflare | Proxy setting in Cloudflare on the day | Reviewed by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | | | |

Where to look, by type:

| Type | Where it hides | What breaks if it is lost or proxied |
| --- | --- | --- |
| A, AAAA on the apex and `www` | the provider's records page | the site (WordPress today, the Worker after S-33) |
| CNAME (`www`, `mail`, `ftp`, `cpanel`, `webmail`, `autodiscover`) | same | hosting tools, webmail, mail client setup |
| MX and its priorities | same | **inbound mail**; MX cannot be proxied |
| TXT: SPF | the apex | outgoing mail lands in spam or is rejected |
| TXT: DKIM (`<selector>._domainkey`) | one per mail sender (hosting, Google, Resend) | outgoing mail unsigned |
| TXT: DMARC (`_dmarc`) | `_dmarc` | policy lost, reports stop |
| TXT: verification strings | the apex | Search Console, Google Workspace, Bing and others lose verification |
| CAA | the apex | a certificate authority is refused (or allowed when it should not be) |
| SRV, HTTPS, SVCB | rare | autodiscover, protocol hints |
| NS for a subdomain | a delegated subdomain | the subdomain disappears |
| DS | the registrar (and `dig DS`) | **the whole domain fails to resolve after the nameserver change** if it is not handled (section 5) |

## 5. TTL schedule

TTLs matter where something can still be undone slowly. Inside Cloudflare a change takes effect globally within about five minutes, and a proxied record always has the automatic TTL of five minutes. The slow part is the **nameserver delegation at the registry**, whose TTL nobody here controls (plan for up to 24 to 48 hours; look at `dig NS sakolakembara.org` for the number the resolvers see). So this runbook is built so that **nothing is ever rolled back by changing nameservers back**: the zone moves with identical records, and every later change, including the rollback, is made inside Cloudflare.

| When | What | Who |
| --- | --- | --- |
| T-72 h | Read every TTL in the inventory; check DNSSEC | needs Dzul |
| T-48 h | If DNSSEC is on: **remove the DS record at the registrar**, then wait for the old DS TTL to expire (commonly 24 to 48 hours: `dig DS` shows the TTL) **before** changing nameservers. Changing nameservers first makes validating resolvers return SERVFAIL | needs Dzul |
| T-48 h | Lower the TTL of the apex and `www` records (and any record that will change) to **300 seconds** at the current provider. It only takes effect after the old TTL has expired, so do it at least one old TTL before the window | needs Dzul |
| T-24 h | Check with `dig` that resolvers now see 300; fix anything still on a long TTL | needs Dzul (agent may prepare) |
| T-0 | Nameserver change (S-14) | needs Dzul |
| T+7 days | Raise TTLs back where the provider allows it; re-enable DNSSEC **in Cloudflare** (then add the new DS at the registrar), only after resolution has been stable for a full DS TTL | needs Dzul |

## 6. Order of operations on the day

### 6.1 Routes or Custom Domains (read once, decide in D-02)

What the documentation says today (read 2026-10-13):

| | Route `sakolakembara.org/*` over a **proxied** DNS record | Custom Domain `sakolakembara.org` |
| --- | --- | --- |
| Documented role | the Worker runs **in front of** an existing origin; a proxied record for the hostname is required (a placeholder `AAAA 100::` if there is no origin) | the Worker **is** the origin; Cloudflare creates the DNS record and the certificate; all paths of the exact hostname |
| Why it fits here | **WordPress stays behind the same hostname**: rollback is removing the route, and the proxied record serves WordPress again within minutes; on the Free plan the route has a **fail open or closed** switch for the day the 100,000-request limit is spent | the simplest end state, no origin to keep alive |
| What it costs | the proxied record must keep pointing at a working WordPress origin while the route is the fallback; the SSL/TLS mode must suit that origin; `fetch()` of the same hostname from the Worker reaches the origin | cannot be created on a hostname that has a CNAME (an A record: verify what the dashboard does); `www` is **not** covered (exact host match); rollback means deleting the domain and **re-creating the WordPress record** |
| Precedence | a route beats a Custom Domain on the same hostname, so the portal's `apex/portal` and `apex/portal/*` routes work with either | |

**Recommendation (D-02):** a **route over the proxied record** for the cutover, because it makes rollback a one-click, seconds-to-minutes action and keeps WordPress as the fallback. When WordPress is retired (section 10), convert to a Custom Domain with the documented migration (delete the record, add the domain, delete the route). `wrangler.jsonc` already says the production Worker is attached by a route; the portal design holds in both modes.

**To verify on the real zone** (each is a line of this runbook's smoke tests): the route pattern matches `/`, deep paths and queries; `www` is not matched by it and is handled by the redirect rule; the most specific route wins when `sakem-portal` is attached (and the documented bug about `images/*` against `images*` does not apply to `/*` against `/portal/*`); prerendered pages, `_redirects` and `_headers` answers cost **no Worker request** (the Workers metrics show it); the route's fail mode; `workers_dev` is off in production (adding `routes` to the config turns it off on the next deploy); the SSL/TLS mode and Always Use HTTPS do not loop.

### 6.2 The steps

| ID | When | Step | Who |
| --- | --- | --- | --- |
| S-01 | T-7 d | Choose the window; tell the team and Rommy (section 10); ask for a WordPress content freeze from T-1 d 18:00 | needs Dzul |
| S-02 | T-72 h | DNS inventory (section 4); DNSSEC check | needs Dzul (agent may prepare the template and the command list) |
| S-03 | T-48 h | TTL schedule (section 5); DS removal if needed | needs Dzul |
| S-04 | T-24 h | **Record the live corpus**: `pnpm seo:parity -- --live-base https://sakolakembara.org --candidate-base <staging origin> --allow-network --record <private dir>` (about 700 requests, 6 to 8 minutes, one per second per host). This is a run against the live site: **needs Dzul's explicit approval for this run** | needs Dzul (agent may prepare the exact command) |
| S-05 | T-24 h | Everything of P-05 to P-12 and P-18 is done; the second reviewer has ticked the inventory | needs Dzul |
| S-06 | T-1 d 18:00 | WordPress content freeze; **final WordPress backup** (database and `wp-content`), checksums noted | needs Dzul |
| S-10 | T-0 | Window opens; tell the team. Save a baseline: `dig` of every inventory name and type, and the response headers of the apex (private) | needs Dzul (agent may prepare the commands) |
| S-11 | T-0 | **Add the zone** `sakolakembara.org` to the **organisation** Cloudflare account (the account is pinned; check the plan is Free). Adding a zone changes nothing until the nameservers move | needs Dzul |
| S-12 | T-0 | **Compare the imported records with the inventory, one by one.** Add what is missing, correct what differs (TTL, priority, quoting of long TXT strings). Pay particular attention to MX, SPF, DKIM, DMARC, CAA and verification TXT | needs Dzul (agent may prepare the checklist from the inventory) |
| S-13 | T-0 | Set **every record DNS-only** (grey cloud), including the apex and `www`. No record may be proxied now, and none may point at a `workers.dev` name | needs Dzul |
| S-14 | T-0 | **Change the nameservers at the registrar** to the two Cloudflare gives for the zone. Copy them exactly | needs Dzul |
| S-15 | T-0 + up to 24 h | Wait for the zone to be **Active** (email and dashboard). Check `dig NS sakolakembara.org @1.1.1.1` and `@8.8.8.8` show the Cloudflare nameservers. Re-run the S-10 queries: **every answer must equal the baseline**. Open the WordPress site and send one test mail each way (section 7.4) | needs Dzul (agent may prepare the commands) |
| H1 | after S-15 | **Hold point 1.** Zone active, nothing changed for visitors, mail works. If anything differs from the baseline, fix the record inside Cloudflare (never by moving nameservers back) and re-check. Continue only on "all equal" | needs Dzul |
| S-20 | after H1 | **Cache rehearsal on a throwaway name.** Attach the **staging** web Worker to `cache-test.sakolakembara.org` as a Custom Domain (a new name: no live traffic is touched) and run the cache checklist of section 7.3, including the stale-if-error test with the **staging** API Worker broken on purpose. Nothing production is touched | needs Dzul (agent may prepare the commands) |
| S-21 | after S-20 | **Rehearse the rollback** on that hostname: remove the Custom Domain, confirm the name stops serving the Worker, and **write down how long it took**. Then delete the throwaway record | needs Dzul |
| S-22 | after S-21 | New names the production site needs, none of which carries today's traffic: `admin.sakolakembara.org` (Custom Domain on the admin Worker, then `ADMIN_URL`), `files.sakolakembara.org` (R2 custom domain, then `UPLOADS_BASE_URL` on web and admin, then redeploy), the Turnstile hostnames, the Resend records if they were not in the import | needs Dzul |
| S-23 | after S-22 | Mail and email checks of section 7.4 (Resend sends a real test; the first super_admin signs in at the admin host) | needs Dzul |
| H2 | after S-23 | **Hold point 2.** Cache rehearsal passed, rollback timing known, admin and files work. If the stale-if-error or cache checks failed, **stop**: the cache is only testable here, and a failing cache means the site would call the API on every view. Continue only on "all passed" | needs Dzul |
| S-30 | after H2 | **TLS settings**: SSL/TLS mode **Full (strict)** if the WordPress origin presents a valid certificate for the hostname, otherwise the strongest mode it supports; **never Flexible if WordPress redirects HTTP to HTTPS** (a redirect loop). Always Use HTTPS **on**. HSTS: the value decided in D-04 at the zone is **off** (the Worker sends its own header). Wait until the edge certificate is Active | needs Dzul |
| S-31 | after S-30 | **Turn the proxy on** (orange cloud) for the apex and `www` records, still pointing at the WordPress origin. WordPress is now served through Cloudflare and nothing else has changed. Run the WordPress smoke checks (T-01, T-02) and a page load: no redirect loop, no certificate error, no 52x error. If one appears, turn the proxy off again (grey cloud, 300 seconds) and fix the mode | needs Dzul |
| S-32 | after S-31 | Zone rules, prepared by the agent as text for Dzul to paste: (1) **`www` to apex**, one Single Redirect, 301, path and query kept; (2) the redirect additions of findings F-03 to F-08 that are better made at the zone than in the Worker; (3) the optional WAF custom rule for WordPress probe paths (F-09). Free limits: 10 Single Redirects, 5 WAF custom rules. Redirect and WAF rules are evaluated before a request reaches a Worker, so they cost no Worker request (the documented order of the Rules products; **verify** with the Workers metrics) | needs Dzul (agent may prepare the rule texts) |
| S-33 | after S-32 | **THE SWITCH.** Attach the **route** `sakolakembara.org/*` to the production web Worker (the fail mode of D-06, **decided: OPEN for this public route**, so past the 100,000-request limit visitors get the WordPress origin instead of an error page; the admin host's route and `sakem-portal`'s are **CLOSED**). If M4 is done, attach `sakolakembara.org/portal` and `sakolakembara.org/portal/*` to `sakem-portal` first, with **fail closed**. Note the time to the second | needs Dzul |
| S-34 | S-33 + 0 min | **Smoke tests T-01 to T-30 of section 7**, in order, by Dzul and the agent's script. Apply the decision rule of section 9.2 at each failure | needs Dzul (agent may prepare the script) |
| S-35 | S-33 + 15 min | **SEO parity against production**: `pnpm seo:parity -- --live-dir <private dir>/live --candidate-base https://sakolakembara.org --allow-network` (the live site is the recorded corpus; the network side is the new site). No blocker is the pass criterion; the report is read with Dzul | needs Dzul (agent may prepare, reads the report) |
| S-36 | S-33 + 60 min | **Watch**: the first-hour list of section 8. No trigger of section 9.1 fired | needs Dzul |
| S-37 | S-33 + 60 min | **Announce** internally (section 10). Start the 48-hour plan | needs Dzul |

## 7. Smoke tests

Run in order after S-33 (T-01 to T-30), and parts of it after H1 and H2. "Failure means" says what to do. The commands are plain `curl -sI` and `curl -s`; the agent may prepare a script that prints a table, and it reads the results; Dzul runs it. Replace `<slug>` with real article slugs.

### 7.1 Addresses, redirects, content (T-)

| ID | Check | Expected | A failure means | Who |
| --- | --- | --- | --- | --- |
| T-01 | `https://sakolakembara.org/` | 200, HTML, `strict-transport-security` as decided (D-04), `x-content-type-options: nosniff` | the Worker or the TLS mode is wrong: RB trigger 1 if 5xx, a Cloudflare error page, or WordPress still answering | needs Dzul (agent may prepare) |
| T-02 | `http://sakolakembara.org/` | one permanent redirect to `https://sakolakembara.org/` (no loop) | Always Use HTTPS or the SSL mode: loop means turn the proxy off and fix | needs Dzul |
| T-03 | `https://www.sakolakembara.org/blog?x=1` | one 301 to `https://sakolakembara.org/blog?x=1`; `http://www...` ends on the apex in at most two hops | the www rule or the www record is missing (R-03) | needs Dzul |
| T-04 | `/robots.txt` | 200, `text/plain`, `Disallow` for `/admin`, `/api`, `/login`, `/portal`, **no `Disallow: /`**, a `Sitemap:` line with `https://sakolakembara.org/sitemap.xml` | trigger 4 if it blocks the site | needs Dzul |
| T-05 | `/sitemap.xml` | 200, `application/xml`, about 90 URLs or more, an `x-blog-source` header of `network` or `cache` | a 503 with `Retry-After` means the API is not reachable through the binding: check the service binding and the API Worker | needs Dzul |
| T-06 | `/blog` and `/blog?page=2` | 200, `cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`, an article list | the API binding, D1, or the import (P-05) | needs Dzul |
| T-07 | `/blog/<slug>` for three articles, one with images | 200, canonical is itself (no `workers.dev`, no `www`), `og:image` absolute, Article JSON-LD, the images load from `https://files.sakolakembara.org` or `/blog/images` | `UPLOADS_BASE_URL` wrong, or SITE_URL wrong: trigger 4 | needs Dzul |
| T-08 | `/cerita/<slug>/` for five WordPress URLs and `/education/`, `/news/`, `/tips/` examples | **308** to `/blog/<slug>`, then 200 (the tool proves all 80 at S-35) | the redirect table: trigger 5 if more than five fail | needs Dzul |
| T-09 | `/wp-content/uploads/2026/05/<an image of an article>` | 308 to `/blog/images/...`, then 200 with an image content type | a missing image file (R-07) | needs Dzul |
| T-10 | `/no-such-page` and `/no-such/page/x` | **404**, the site's 404 page, `<meta name="robots" content="noindex">` | a soft 404 or a Worker error | needs Dzul |
| T-11 | `/tim`, `/laporan`, `/gabung-siswa/docs` | 200 with content (the API through the binding) | the binding, D1 or the data | needs Dzul |
| T-12 | `/kontak` in a **real browser on a phone** | the Turnstile widget renders; a test message is accepted and shows in the admin's Pesan; the page's own text appears (the form needs JavaScript in production) | Turnstile hostname or keys (P-11): the contact form is down but the site is not: not a rollback trigger alone | needs Dzul |
| T-13 | a recreated shortlink `/<slug>` | 307 to its target, the click counter in the admin goes up by one | the API binding or D1 | needs Dzul |
| T-14 | `POST https://sakolakembara.org/api/public/contact` and `GET /api/public/blog` | **404** JSON `{"error":"not_found"}` (the public face of the API Worker is empty by design) | an exposed endpoint: fix at once | needs Dzul (agent may prepare) |
| T-15 | `/admin` and `/admin/blog` | 308 to `ADMIN_URL` with the path kept; the admin host's login works for the first super_admin | `ADMIN_URL` unset or wrong | needs Dzul |
| T-16 | `/login`, `/register` | 308 to `/portal/login`, `/portal/register`; **200 only if M4 is done** | M4 missing: F-02; do not go live with a dead sign-in | needs Dzul |
| T-17 | `/portal` and `/portal/status` | the portal Worker's page (M4); not the web Worker's 404 | route precedence wrong, or M4 missing | needs Dzul |
| T-18 | `/api/anything` | 404 JSON `{"error":"not_found"}`, `no-store` | the middleware | needs Dzul |
| T-19 | `/donasi/`, `/gabung-siswa/`, `/program/prapembinaan/` (with the trailing slash) | **308** to the slashless address (the F-03 fix has been in the code since SAKEM-090, and wins locally); **307** would mean that on the real zone the assets layer's own redirect wins over `_redirects`: then accept it as a warning with the reason written, or fold the slash at the zone (S-32) | the assets layer's own slash redirect | needs Dzul |
| T-20 | `/_img/<a hashed image>`, `/images/...`, `/files/<a pdf>` | 200, the `cache-control` of `_headers` (`immutable` for `/_img/`), no `set-cookie` | `_headers` not applied | needs Dzul |
| T-21 | Security headers on one HTML answer from the Worker and on one static asset | the same five headers on both | the middleware or `_headers` | needs Dzul |
| T-22 | the old sitemap names `/sitemap_index.xml`, `/post-sitemap.xml`, `/wp-sitemap.xml` | 308 to `/sitemap.xml` if the F-08 fix is in; 404 otherwise (accepted, written) | F-08 | needs Dzul |
| T-23 | `/?p=<a wpId>` | 301 or 308 to the article if the F-06 rule is in; the home page otherwise (accepted, written) | F-06 | needs Dzul |
| T-24 | the contact form posted without JavaScript | the page says "Aktifkan JavaScript untuk mengirim pesan." (by design in production) | none: expected | needs Dzul |
| T-25 | The beacon on **both kinds of page**: `curl -s https://sakolakembara.org/` (prerendered) and `curl -s https://sakolakembara.org/blog` (rendered by the Worker), each piped to `grep -o '<script[^>]*beacon.min.js[^>]*>'`; then the same for `/donasi`, `/program/pembinaan`, `/tim` and `/kontak` | **exactly one** tag on each, `type="module"`, `src="https://static.cloudflareinsights.com/beacon.min.js"`, and **the same** `data-cf-beacon` value everywhere; **none** on the admin host or under `/portal`; no `set-cookie` on any of these answers | a tag on one kind only: the build or the `--var` of P-24 (c) was missed, so rebuild and redeploy with both; two tags on a page: the zone's automatic injection is on, turn it off in the dashboard; another id: a wrong value in one of the two places. Not a rollback trigger | needs Dzul (agent may prepare the curl lines) |
| T-26 | **One hit arrives.** Open the home page in a normal browser window, then wait a few minutes and open Web Analytics for `sakolakembara.org` in the dashboard | the visit shows as a page view; the browser's network tab shows `beacon.min.js` answered 200 and a `POST` to `cloudflareinsights.com/cdn-cgi/rum`; no cookie is set by either | nothing after 30 minutes: the id belongs to another site or hostname, an ad blocker is on (try a clean window), or two snippets are on the page (T-25). Not a rollback trigger | needs Dzul |

### 7.2 The monitoring snapshot after the switch (T-)

| ID | Check | Expected | Who |
| --- | --- | --- | --- |
| T-30 | In the Workers dashboard: invocations, errors, CPU time by Worker for the first 15 minutes; **no "Exceeded resources" (1102)**; the request count is of the order the traffic baseline predicts | no 1102, no 1101, requests far below 100,000 a day pace | needs Dzul (agent may prepare the query) |

### 7.3 Cache checklist

The cache is `caches.default` inside the web Worker, keyed by synthetic API URLs; **it exists only on a custom domain or a route**, which is why it is first checked on the throwaway hostname (S-20) and checked again in production (S-34). The `x-blog-source` header of `/blog`, `/blog/<slug>` and `/sitemap.xml` says what happened: `network` (fetched now), `cache` (fresh copy), `stale` (an old copy served because the API failed), `empty` (nothing to show), `not_found`. The Cache API is **per data center**: requests must reach the same one (compare the suffix of the `cf-ray` header), so use one machine and one connection point, and expect a different location to start cold.

| ID | Check | Expected | A failure means | Who |
| --- | --- | --- | --- | --- |
| C-01 | `/blog` for the first time after a deploy or a long pause | `x-blog-source: network` | none | needs Dzul |
| C-02 | `/blog` again within 60 seconds, five times, with `curl -w '%{time_total}'` | `cache` each time and **faster than the first** (note both numbers) | the cache does not work on this hostname: no fresh copy means an API call and a D1 read on every view (the budget: section 8) | needs Dzul |
| C-03 | wait more than 60 seconds, request again, then again | `network`, then `cache` | the 60 s window is wrong | needs Dzul |
| C-04 | **stale-if-error** (throwaway host only, staging API Worker broken on purpose): after a copy older than 60 s exists, request `/blog` | **200** with `x-blog-source: stale` and `s-maxage=30` in `cache-control` | the site would show errors during an API outage | needs Dzul (agent may prepare the break and the restore) |
| C-05 | the same on a path that was never cached, API still broken | **503**, `retry-after: 30`, `cache-control: no-store`, the site's shell and notice; never a 500, never a 404 | a crawler could be told "gone" during an outage | needs Dzul |
| C-06 | an unknown slug `/blog/does-not-exist` twice within 30 seconds | 404 both times, `x-blog-source: not_found`, the second from the cache | probing could hammer the API | needs Dzul |
| C-07 | edit a title in the (staging) admin, then reload the article | the new title within about a minute (60 s plus the API's own window; there is no purge hook) | the admin's save is not visible | needs Dzul |
| C-08 | restore the staging API Worker; request `/blog` | back to `network`, then `cache` | recovery is not automatic | needs Dzul |

### 7.4 Email delivery

| ID | Check | Expected | Who |
| --- | --- | --- | --- |
| M-01 | `dig` MX, TXT (SPF, DMARC) and the DKIM selectors of the inventory on `@1.1.1.1` | equal to the baseline of S-10 | needs Dzul (agent may prepare) |
| M-02 | A message **from an outside address to a domain mailbox**, and **from a domain mailbox to an outside address** | both arrive within a few minutes; in the received message's "show original", SPF, DKIM and DMARC say **pass** | needs Dzul |
| M-03 | The Resend domain status; the first super_admin requests a password reset | "verified"; the email arrives, signed (DKIM pass), the link opens the admin host | needs Dzul |
| M-04 | The Resend dashboard: sent today (limit 100 a day, 3,000 a month) | the test messages only | needs Dzul |

## 8. Monitoring plan

Every limit below is the Free plan's. **D1 now enforces the daily limits**: since 2026-09-01 queries fail until midnight UTC once the account has spent its rows read or written, so reaching a limit is an outage of every page that reads D1 (the API answers errors; the site falls back to stale copies and then to 503). **The Workers daily request limit is shared by every Worker of the account.** Workers Logs keep a short history (documented as up to seven days: check the dashboard): copy the numbers into SAKEM-084 daily.

| What | Where | Limit | Warn at | Act at | Action |
| --- | --- | --- | --- | --- | --- |
| Worker requests per day, all Workers | Workers metrics (per Worker and the account total) | 100,000 (resets 00:00 UTC) | 60,000 | 80,000 | find the top paths (bots on `/wp-*`, a loop, the navbar calls); add the WAF rule (F-09); decide D-06 (fail mode) or the paid plan |
| "Exceeded resources" (error 1102) and "Worker threw exception" (1101) | Workers metrics, invocation statuses | 10 ms CPU per request | any 1102 | a 1102 on a page route twice in an hour | profile the route (a long article, the first PBKDF2 sign-in); the route's CPU numbers are in M5-A's measurement |
| Error 1027 | Workers metrics, or a visitor report | the daily limit | any | any | the limit is spent: see requests above |
| D1 rows read per day | D1 metrics | 5,000,000 | 2,500,000 | 4,000,000 | find the heavy reader (a missing cache, a loop) |
| D1 rows written per day | D1 metrics | 100,000 | 50,000 | 80,000 | the likely writer is the **shortlink click counter** (counted without a limit, by decision) or audit rows: find the slug; a rate limit rule on that path |
| D1 storage | D1 metrics | 5 GB | 3 GB | 4 GB | the audit retention |
| R2 Class A and Class B operations per month | R2 metrics | 1,000,000 and 10,000,000 | 500,000 and 5,000,000 | 800,000 and 8,000,000 | uploads from a stuck client; the admin's rate limit exists |
| R2 storage | R2 metrics | 10 GB | 7 GB | 9 GB | clean the bucket |
| Resend emails | Resend dashboard | 100 a day, 3,000 a month | 60 a day, 1,800 a month | 90 a day | the registration rush: the daily counter (M4) or the paid plan |
| WAF events and probe volume | Security events | | a sudden rise | | the WAF rule |
| External uptime on `/`, `/blog`, `/sitemap.xml` | an uptime service on Dzul's account (needs Dzul to open one) | | one failure | two in a row | the rollback triggers |
| Search Console | the plan in [`seo-audit.md`](seo-audit.md) | | | | |

**First 48 hours.** At S-33 + 15, 30, 60 minutes, then +3 h, +6 h, +12 h, +24 h and +48 h: the Worker metrics (errors, 1102, requests so far), the D1 and R2 counters, `curl -I` of `/`, one article and `/sitemap.xml`, a mail test at +24 h, the Search Console inspection of the home page at +1 h and +24 h, and the contact messages that arrived. Record each check in SAKEM-084 as one line.

**Days 3 to 30.** Daily for the first week, then twice a week: the same counters, the 80 and 60 per cent thresholds, the Search Console reports of [`seo-audit.md`](seo-audit.md), the parity tool in offline mode after every deploy that touches routing, redirects, headers or SEO, a weekly look at `Not found (404)` for a URL that should have been redirected, and the WordPress backup still intact.

## 9. Rollback

### 9.1 Triggers (a numbered list; any one is enough)

1. **The site or its entry point is broken for more than 5 minutes**: `/` or `/blog` answers 5xx, a Cloudflare error page (1101, 1102, 1027, 52x) or a redirect loop, for visitors or for the uptime check.
2. **A smoke test T-01 to T-12, T-14 or T-18 fails and the cause is not fixed within 30 minutes** of S-33.
3. **Mail stopped** (M-01 or M-02 fail) and a record cannot be corrected within 60 minutes. (First correct the record; this is a trigger only when that fails.)
4. **A wrong canonical, a `noindex` or a robots block is live** on pages that rank (canonical on `workers.dev` or `www`, `Disallow: /`), not fixable within 15 minutes.
5. **The redirect map fails**: more than five of the 80 WordPress URLs are not a single 308 to a 200 in S-35, or any loop.
6. **A daily limit is spent early on the first day** (Worker requests or D1 rows past 80 per cent before 18:00 WIB) and rising, with no quick mitigation.
7. **A decision of Dzul's or Rommy's**, for any reason.
8. If registration was opened at the launch (D-03 b): **sign-ups or uploads fail and cannot be fixed within 30 minutes**.
9. After 72 hours a rollback is no longer a window action: it becomes a decision for Dzul and Rommy with the Search Console evidence (a drop of more than half in impressions that persists for a week with the redirect map proven is a reason to **investigate first**, not to roll back).

### 9.2 Who decides and how fast

**Dzul decides, and he is the one running the window.** The PM advises. From the moment a trigger is confirmed, **the decision is made within 10 minutes**: a trigger of 1 or 4 is **roll back first, diagnose afterwards**; triggers 2, 3, 5, 6 get the stated time to fix, then roll back. If Dzul cannot decide, the rollback is done. Rommy is told as soon as the rollback starts, not after.

### 9.3 Steps (the route model of 6.1)

| ID | Step | Time to take effect | Who |
| --- | --- | --- | --- |
| RB-1 | In the Cloudflare dashboard, Workers & Pages, the **web Worker**, Domains & Routes: **remove the route** `sakolakembara.org/*` (and the portal routes if M4 was attached). The proxied record still points at WordPress, which serves again | seconds to about five minutes (changes inside Cloudflare take effect globally within five minutes) | needs Dzul |
| RB-2 | Confirm: `curl -sI https://sakolakembara.org/` shows WordPress's own signature (the headers you noted in section 4, step 6), and a WordPress article URL answers 200 at its old address | immediately after RB-1 | needs Dzul |
| RB-3 | If the **proxy itself** is the problem (a certificate error, a loop): set the apex and `www` records to **DNS-only** (grey cloud). The TTL you set (300 seconds) is how long resolvers may keep the old answer | up to the record's TTL | needs Dzul |
| RB-4 | If a **record** is wrong (mail, verification): correct it inside Cloudflare | within five minutes | needs Dzul |
| RB-5 | **Nameservers are not rolled back** unless the zone itself is unusable. If it must be done: restore the old nameservers at the registrar; the old zone at the old provider has to be **untouched for at least 7 days after the move** for this to work; DNSSEC must be consistent with the provider you return to (the DS stays removed). **Recovery time is the registry's NS delegation TTL: plan for up to 24 to 48 hours**, which is why everything above avoids it | 24 to 48 hours | needs Dzul |
| RB-6 | Tell the team and Rommy (section 10); write the time, the trigger and the evidence in SAKEM-084 | | needs Dzul |
| RB-7 | Handle the **data written in the window** (next table), then diagnose with the new site running on its Worker URL | | needs Dzul (agent may prepare the exports) |

### 9.4 Data written during the window

The new site has a database; WordPress does not. What is written there while the new site is live is **not visible to WordPress after a rollback**.

| What | Where it is | Lost or kept | What to do on rollback |
| --- | --- | --- | --- |
| Contact messages | D1 (`contact_messages`), read in the admin's Pesan | kept in D1, invisible to WordPress | export the messages written since S-33 and **forward them to the team** |
| Edits in the new admin (blog, team, reports, announcements, shortlinks) | D1, the Aktivitas log lists them | kept in D1 | list them from Aktivitas and re-apply what matters in WordPress |
| New shortlinks and their click counts | D1 | WordPress has no shortlinks: **every shortlink 404s after a rollback** | do not print or announce a new shortlink in the window; if one was shared, tell its recipients |
| Student accounts and applications (M4, **children's documents in a private bucket**) | D1 and R2 | cannot be copied into WordPress | **do not open registration until the window is over** (D-03), or export and contact each applicant before a rollback |
| Sent emails | Resend | kept | none |
| Uploaded files | R2 | kept | none |
| Counters (Workers, D1, R2) | the metrics | gone with the day | none |

A D1 export needs `wrangler d1 export <database> --remote` with Dzul's approval; the file is private (it holds messages with names and emails) and never goes into the repository or a ticket.

## 10. What to keep of WordPress, and communication

**Keep, and for how long** (proposal D-08):

| Item | For |
| --- | --- |
| The **hosting plan with WordPress untouched and reachable** (this is the rollback target and the origin behind the proxied record) | **at least 90 days** after S-33, and until Search Console shows the old URLs settled and Dzul and Rommy agree; then take a last backup |
| The two **backups** of P-12 (database and `wp-content`) | at least 12 months, in two places; the uploads folder permanently (it is the only copy of every media file not yet in the new site: see R-07) |
| The **old DNS zone at the previous provider**, unmodified | at least 7 days after S-14 (RB-5 depends on it) |
| The **DNS inventory** and the baseline `dig` output | as long as the domain lives |
| The recorded live corpus of S-04 (`--record`) | at least 6 months: the offline parity run needs it |

While WordPress is the fallback: **do not update or edit it** (a new post would never appear on the new site), keep it from being indexed under another address (a password or a `noindex` at the host for any direct address of the origin), and **reach its admin without DNS**: put a line in your own machine's hosts file that maps `sakolakembara.org` to the origin's address (WordPress redirects any other hostname to its configured address, so a different hostname would only send you back to the new site). After the retention period: convert the route to a Custom Domain, delete the WordPress record, end the hosting plan, and close the loop on the VPS key of SAKEM-023.

**Communication.**

| When | To whom | What |
| --- | --- | --- |
| T-7 d | the team (Anggara, Faishal), Rommy | the window, that nothing should be published in WordPress from T-1 d 18:00, who to call |
| window start | the team | "Jendela migrasi dimulai. Jangan ubah apa pun di WordPress sampai ada kabar." |
| after the switch | the team, Rommy | "Situs baru sudah aktif di sakolakembara.org. Laporkan apa pun yang aneh ke Dzul." |
| a rollback | the team, Rommy at once | "Kami kembali ke situs lama sementara. Tidak ada data hilang; pesan yang masuk ke situs baru akan diteruskan." (and the contact-message handover of 9.4) |
| the weekly update | Rommy | one line on the migration: state, any incident, the Search Console picture |

No public announcement is needed: the address does not change.

## 11. After the cutover

Details and thresholds are in [`seo-audit.md`](seo-audit.md#search-console-and-monitoring-plan).

| ID | When | Step | Who |
| --- | --- | --- | --- |
| X-01 | before S-33 | **Baseline exports** from Search Console (Performance by page and by query, the Pages report counts) and the **top-20 URL list**; saved privately | needs Dzul |
| X-02 | S-33 + 15 min | Search Console, Sitemaps: submit `https://sakolakembara.org/sitemap.xml` | needs Dzul |
| X-03 | S-33 + 30 min | **URL Inspection, "Test live URL"** on the home page, `/blog`, five articles and the top-20 list: available to Google, canonical as declared, not blocked; **request indexing** for the home page and the ten most important | needs Dzul (agent may prepare the list) |
| X-04 | day 1 | Confirm in Bing Webmaster Tools (import from Search Console) | needs Dzul |
| X-05 | days 1 to 30 | **Watch the 301 map**: the Pages report's "Page with redirect" should rise towards the old URL count; every "Not found (404)" on a URL that the live sitemap listed gets a redirect; every "Duplicate, Google chose different canonical" on an article is investigated | needs Dzul (agent may prepare the weekly read-back) |
| X-06 | days 1 to 30 | **Freeze**: no slug edits, no change of `SITE_URL`, the trailing-slash policy, the canonical host or the redirect table except adding a missing redirect, no mass title rewrite | needs Dzul |
| X-07 | day 7 | Raise the TTLs; re-enable DNSSEC in Cloudflare and add the new DS at the registrar if it was on; consider raising the HSTS max-age (F-01) | needs Dzul |
| X-08 | day 28 | Core Web Vitals report of Search Console; PageSpeed Insights production runs (approval needed) | needs Dzul |
| X-09 | day 7 (the beacon is live from S-33, checked by T-25 and T-26) | Analytics: the first week's numbers noted from Web Analytics (a floor: ad blockers hide some visits), next to Search Console's. The old Google Analytics history stays in the Google account; nothing is migrated | needs Dzul |
| X-10 | day 90 | Retire WordPress (section 10): route to Custom Domain, delete the record, end the hosting, rotate the SAKEM-023 key | needs Dzul |

## 12. Findings from this audit

Found by reading the code and the existing documents, and by running the parity tool's rehearsal against the built local Worker. **No application code was changed in this task.** Severity is about the live site's search ranking or availability. "Proposed fix" is a suggestion for a separate PR that Dzul approves.

| ID | Finding | Evidence | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| F-01 | **HSTS is `max-age=31536000; includeSubDomains; preload`** on every response (copied from the VPS Caddyfile). It commits every subdomain of the domain to HTTPS for a year in each browser that has seen it, including hosting subdomains such as webmail and cPanel, and it **blocks a rollback to anything without a valid certificate for the apex**. `preload` is only a token until the domain is submitted, but `includeSubDomains` and the year apply at once | `cf/web/public/_headers`, `src/lib/security-headers.ts`, pinned equal to the Caddyfile by `tests/headers-sitemap.test.ts` | **High** (availability, rollback), not ranking | ship `max-age=300` without `includeSubDomains` and `preload` for the first week, raise it in steps (X-07); update the pinned test and `docs/` in the same PR; decide D-04 before S-33 |
| F-02 | **`/login`, `/register`, `/portal/*`, "Masuk" and "Daftar Sekarang" have no backend until M4**: the first two are 308s into `/portal/...`, and in production the web Worker would render its 404 page for them (the navbar's session call `/portal/api/auth/get-session` too, once per visitor session) | `redirects.config.mjs`, `src/middleware.ts`, [`web-skeleton.md`](web-skeleton.md) | **Go-live blocker** (conversion), not ranking | P-01 (wait for M4, or the interim change) |
| F-03 | **Fixed in code by SAKEM-090 (local emulation only; T-19 settles the real zone).** **Five prerendered pages answer a trailing-slash request with a 307** (temporary): `/donasi/`, `/gabung-siswa/`, `/program/prapembinaan/`, `/program/pembinaan/`, `/program/pasca-pembinaan/`. WordPress URLs end in a slash, so these are the likely incoming spellings. Pages rendered by the Worker fold the slash with a 308 | the parity rehearsal (`redirect-temporary` on exactly these five); [`web-skeleton.md`](web-skeleton.md) says the assets layer's 307 is not configurable | **Medium** (a temporary redirect tells Google to keep the old address for a while) | add static `_redirects` rules `/<page>/  /<page>  308` for the five (Cloudflare documents that the `_redirects` rules are applied to static asset responses and win over `_headers`, but **not** which of them wins over the assets layer's own slash redirect: **verify on the real zone**, T-19), plus a test |
| F-04 | **Fixed for `/category/*` and `/tag/*` by SAKEM-090 (308 to `/blog`, the live sitemap listed 7 and 77); `/author/*` is not in the live sitemap and was not added.** `/category/<x>/`, `/tag/<x>/`, `/author/<x>/` (WordPress archives) **are not redirected**: a 404. `redirects.config.mjs` has `/<category>` at the root but not under `/category/` | the rehearsal (`url-missing` on `/category/cerita/` and `/category/news/`, planted by the stand-in; the candidate's behaviour is real) | **Medium** if the live sitemap lists them (Yoast usually does for categories) | `_redirects`: `/category/*`, `/tag/*`, `/author/*` to `/blog` (authors may go to `/tim`); confirm from the live sitemap first |
| F-05 | `/wp-content/uploads/<path>` redirects to `/blog/images/<path>`, but **only the 235 files the 80 articles use were mirrored** (WordPress's size variants included); any other media file (older posts, pages, thumbnails) is a 404. Five files with a literal `@` in the name take **two hops, 308 then 307** | `public/blog/images` (235 files), the rehearsal (`redirect-chain` on the `@` file) | **Medium** (image search, hot-linked images on other sites) | run the tool with `--include-images` on the live sitemaps and list the WordPress media API; copy what is missing into the asset set (limit 20,000 files, 25 MiB each) or R2; write the `@` files as direct `%40` rules |
| F-06 | **`/?p=<id>` shortlinks are not redirected** (the roadmap already lists it as "not yet covered"): the home page answers with a 200 and a canonical to `/`. `/` is a prerendered asset, so the Worker never sees the query, and `_redirects` cannot match a query string | the rehearsal (`live-redirect-dropped` x80) | **Low to medium** | one zone Single Redirect: path `/` with a query `p=<digits>` to `/blog` (Bulk Redirects cannot match a query string; Free has 10 Single Redirects, so 80 per-article rules do not fit): **verify the wildcard syntax in the dashboard**; the WordPress ids are in `wpId` if Search Console ever shows real `?p=` traffic |
| F-07 | `/feed` and `/feed/*` redirect to `/blog` (HTML), so a feed reader gets a page; `/comments/feed/` and category feeds are 404 | the rehearsal (`content-type-changed` on `/feed/`) | **Low** | serve a real RSS from the blog (a small route) or answer 410; decide with Dzul |
| F-08 | The **old sitemap addresses are 404**: `/sitemap_index.xml`, `/post-sitemap.xml`, `/page-sitemap.xml`, `/wp-sitemap.xml` | the catch-all and the redirect table | **Low** (Search Console shows a fetch error for the old sitemap) | `_redirects` to `/sitemap.xml` (308) for those names, remove the old entry in Search Console later |
| F-09 | **WordPress probe traffic costs Worker requests**: `/wp-login.php`, `/xmlrpc.php`, `/wp-admin/...` and `/wp-json/...` reach the Worker; each is a 404 page render, and a one-segment slug-shaped name (`/wp-admin`, `/wp-json`) also costs an API call and a D1 read for the shortlink lookup. A WordPress site is probed all the time, and the limit is 100,000 requests a day for the whole account | the catch-all (`src/pages/[...path].astro`), `src/lib/shortlink.ts` | **Medium** (availability: R-17) | one WAF custom rule (Free has 5; WAF rules are evaluated before the Worker, to be verified in the metrics) that blocks `/wp-login.php`, `/xmlrpc.php` and paths starting `/wp-admin`, `/wp-json`, `/wp-includes`; never `/wp-content/uploads` (those are redirected on purpose) |
| F-10 | **The pass-through list has no origin after the cutover.** `LEGACY_PATHS` (`/_next`, `/images`, `/blog/images`, `/files`, `/reports`, `/resources`) forwards with `fetch()` of the same URL. The VPS is gone; with a route that reaches the **WordPress origin** (a WordPress 404 and a wasted Worker request each), with a Custom Domain it would re-enter. Team photos, reports and resources now come from R2 through `UPLOADS_BASE_URL` | `src/lib/legacy-paths.ts`, `src/lib/legacy-proxy.ts` | **Medium** | at cutover make the list empty (a plain 404 from the Worker), keep the assets that exist in the repo; one PR with its tests |
| F-11 | **Every visitor session spends two Worker requests on nothing useful**: `GET /api/announcements/current` is a JSON 404 of the web Worker (the endpoint does not exist on the apex yet, listed in [`web-skeleton.md`](web-skeleton.md)), and `GET /portal/api/auth/get-session` is a request to the portal Worker (or, before M4, the web Worker's 404 page) | `src/components/Navbar.astro` | **Low** (budget) | the small `/api/announcements/current` endpoint in front of the public API, cached; until M4 skip the session call |
| F-12 | `/blog?page=999` answers 200 with the last page (clamped); WordPress answers 404 for a page out of range | e2e group `pages` | **Low** | none needed; mention if Search Console shows duplicate archive pages |
| F-13 | **The address of every article changes** (`/<category>/<slug>/` to `/blog/<slug>`). Safe with the tested 308 map, but it is the largest single ranking risk of the whole cutover and the reason for the 30-day freeze | `lib/blog-posts.json`, `redirects.config.mjs` | **High** (ranking, if the map or the canonicals are wrong) | D-01: accept, or keep the WordPress paths |
| F-14 | **Staging on `workers.dev` is public and indexable** (`Allow: /`), with canonicals pointing at the production host | the built `robots.txt` | **Low** | do not link to it; Cloudflare Access can protect the hostname if wanted |
| F-15 | **`docs/runbook/launch.md`, `docs/roadmap/mvp-roadmap.md` and parts of `docs/current-state/` still describe a VPS cutover** and say the Next app is live | those files | **Info** | this runbook supersedes them for the Cloudflare plan; the files are not edited here |

## 13. Risk register

Likelihood and impact: **H** high, **M** medium, **L** low. "Owner" is who acts. "Paper" means nothing here is tested on a real zone.

| ID | Risk | L | I | Mitigation | Owner | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | WordPress article URLs change address and Google consolidates slowly | H | M | the tested 308 map, the new URLs in the sitemap, the 30-day freeze, the Search Console plan, the baseline export | Dzul | F-13 |
| R-02 | A WordPress URL **disappears** (a page, category, tag, author, image not in the map) | M | M | the parity tool over the live sitemap with `--include-images` before and after; redirects for what it finds | agent prepares, Dzul approves | F-04, F-05 |
| R-03 | **`www` versus apex**: the new canonical is the apex; a Custom Domain or `/*` route does not receive `www`; without the rule the www links die or WordPress answers on `www` | M | H | the www proxied record plus one 301 rule, T-03, the tool's `canonical-host` check | Dzul | |
| R-04 | **Trailing-slash and case policy**: WordPress slash, the new site no slash; five pages get a 307; `/Blog` is a 404 (paths are case sensitive) | H | M | the 308 rules of F-03, the middleware fold for the rest, the tool's `redirect-temporary` | agent prepares | F-03 |
| R-05 | **Soft 404s**: the new site answers real 404s (tested); only `?page=` out of range clamps | L | L | T-10, the tool's `soft-404-suspect` | | F-12 |
| R-06 | **Redirect chains** (http to https to www to apex, the `@` image files) | M | L | one rule for www, Always Use HTTPS, direct `%40` rules, the tool's `redirect-chain` | Dzul | F-05 |
| R-07 | **`/wp-content/uploads` hot-linked images** that were not mirrored are 404 | M | M | `--include-images`; copy the missing media; keep the WordPress uploads for ever (section 10) | agent prepares, Dzul approves | F-05 |
| R-08 | `/feed` readers and other feeds break | M | L | a real feed or a 410 | Dzul decides | F-07 |
| R-09 | `/wp-json`, `/xmlrpc.php`, `/wp-login.php` probes eat the daily request budget | H | H | the WAF rule, monitoring at 60 and 80 per cent | Dzul | F-09 |
| R-10 | `/category/*`, `/tag/*`, `/author/*` 404 | M | L | the redirects of F-04 | agent prepares | F-04 |
| R-11 | **Pagination**: `/blog/page/N/` is redirected (tested), category pagination is not | L | L | covered by F-04 | | |
| R-12 | **AMP** pages exist on WordPress and 404 here | L | L | the tool's `amp-link-live` shows it; redirect the AMP address to the article | agent prepares | |
| R-13 | **Old sitemap URLs** are 404, Search Console complains | H | L | the redirects of F-08, submit the new sitemap | Dzul | F-08 |
| R-14 | **Cache behaviour is untested before the real domain** (hit, stale-if-error, the 60 s window); a failing cache means an API call and a D1 read on every view | M | H | the throwaway-host rehearsal (S-20), the cache checklist at S-34, H2 | Dzul | |
| R-15 | **The rollback is slow or impossible**: HSTS lock-in, nameserver rollback takes up to 48 hours, WordPress hosting ended early | M | H | the route model (rollback in minutes), the HSTS change, 90 days of WordPress, the rehearsal S-21, the 7-day old zone | Dzul | F-01 |
| R-16 | **Email breaks** (MX, SPF, DKIM, DMARC lost, or a mail record proxied) | M | H | the inventory, every record DNS-only, the line-by-line comparison, M-01 to M-03, H1 | Dzul | |
| R-17 | **The Worker limit of 100,000 requests a day is spent** (bots, a campaign, the navbar calls); the route fails open (WordPress, where the new URLs 404) or closed (an error page) | M | H | monitoring, the WAF rule, F-11, a decision D-06, the paid plan as the escape | Dzul | F-09, F-11 |
| R-18 | **D1 daily limits are enforced**: a bot on the shortlinks spends the 100,000 writes and every page that reads D1 fails | M | H | the 50,000 warning, a rate-limit rule on the shortlink path, stale copies keep pages up | Dzul | |
| R-19 | **DNSSEC** left on at the registrar: the domain stops resolving after the nameserver change | L | H | the DS removal and wait of section 5 | Dzul | |
| R-20 | **Search Console loses verification** (HTML tag or plugin) and nobody can see the migration | M | M | a DNS TXT Domain property before the cutover | Dzul | |
| R-21 | **No analytics** after WordPress goes: no traffic baseline except Search Console | H | M | D-07 decided (Cloudflare Web Analytics, SAKEM-095); P-24, T-25, T-26 | Dzul | |
| R-22 | **M4 is not done**: registration and sign-in are dead links | H | H | P-01 | Dzul, PM | F-02 |
| R-23 | **The pass-through list points at nothing** after the VPS | H | L | the empty list | agent prepares | F-10 |
| R-24 | **The DNS import misses a record** (a quick scan, documented as incomplete) | M | H | the inventory from two sources and a second reviewer | Dzul | |
| R-25 | **TLS mode loops or errors** with the WordPress origin behind the proxy (Flexible against an origin that redirects to HTTPS; Strict against a certificate that does not match) | M | H | S-30 and S-31 with the proxy turned on before the route; T-02 | Dzul | |
| R-26 | **Route precedence** between the web route `/*` and the portal routes `/portal*` behaves differently than documented | L | M | attach the portal routes first; T-17 | Dzul | |
| R-27 | **Data written in the window is lost on a rollback** | M | M | section 9.4; no registration in the window | Dzul | |
| R-28 | **The WordPress site is edited or updated during the fallback** and diverges | L | L | the freeze, the 90 days without edits | Dzul | |
| R-29 | **Staging is indexed** | L | L | no links to it, canonical to production | | F-14 |
| R-30 | **`_redirects` limits** (2,000 static and 100 dynamic rules on Cloudflare; the generated file has 96 lines today, 75 static and 21 dynamic, after SAKEM-090) | L | L | the F-04 to F-08 rules stay small; `tests/redirects.test.ts` | agent | |

## 14. Cutover Phase A: the public site and the admin first (SAKEM-104)

**Decision (Dzul, 2026-10-15): cutover Phase A.** The public site (`sakolakembara.org`) and the admin (`admin.sakolakembara.org`) move to the new Workers first; the student portal (M4) follows later as Phase B. This section is the concrete version of sections 3 to 11 for Phase A: it points at the existing P, S, H, T, C, M, RB and X steps by ID and says which apply, which are deferred and which change. **Where it disagrees with an earlier section, this section wins for Phase A.** The earlier sections are not rewritten: SAKEM-102 owns the DNS lessons in sections 4 and 5, and the portal's part (Phase B) will reuse them.

**Status: paper, with code.** Everything this section needs on the repository side is built and tested locally (the production command printers, the dry runs, the zone-export check, the read-only production checker: [14.5](#145-production-resources-variables-and-the-printed-commands), [14.4](#144-zone-pre-flight-read-only-pa-1), [14.7](#147-smoke-tests-of-phase-a)). **Nothing was run against the account, the zone or the live site.** What only the real zone can settle is marked **(real zone)** and collected in [14.11](#1411-what-is-not-verified-needs-the-real-zone). IDs of this section: `PA-` preconditions, `SA-` steps, `TA-` smoke tests, `RBA-` rollback steps, `F-16` and later findings, `R-31` and later risks, `DA-` decisions.

### 14.1 What changed since sections 1 to 13 were written

| Then | Now (2026-10-15) |
| --- | --- |
| The zone is not in the organisation account; it moves on cutover day (S-11 to S-15, H1, P-13 to P-15) | **The zone `sakolakembara.org` is ACTIVE in the organisation account (Free plan).** The live WordPress site runs behind it: the apex `A` record is proxied to the cPanel/LiteSpeed server, `www` is a proxied CNAME to the apex. The zone also holds the Microsoft 365 mail records, the LMS CNAME, the cPanel hostnames and a **broken wildcard record**. S-11 to S-15, S-31 and H1 are **done** (by Dzul, in the dashboard); P-13 to P-15 are replaced by the zone pre-flight of [14.4](#144-zone-pre-flight-read-only-pa-1) |
| One full switch, the portal included; go-live blocked on M4 (P-01, F-02) | **Two Workers**: the site (`sakola-kembara-web`) and the API and admin (`sakem-admin`). The portal Worker, its routes, its Resend mails, the private bucket's use and the registration decision are Phase B. Sign-up goes through the shortlink `/daftar` to the registration form WordPress uses today |
| The admin and the files host are new names added at S-22, after a cache rehearsal | Same, but built before the switch and tested at their own hosts, so the day itself changes one thing: the route on the apex |
| Rollback by removing the route (RB-1 to RB-7) | Unchanged in model; the Phase A steps and the timing to record are in [14.8](#148-rollback-phase-a) |

**The incident of 2026-10-15 and what it changed.** The DNS scan that came with the zone's onboarding copied Cloudflare's **own proxy addresses** as the content of A and AAAA records, and the live site answered **error 1000 for about 1 h 40** until Dzul corrected the records in the dashboard. Three rules came out of it (summarised from the SAKEM-077 comment; SAKEM-102 writes the full version): (1) **export the OLD zone first** (at the previous DNS provider) and compare the new zone with it **record by record**; (2) **never trust the scan** for a site that is already behind Cloudflare: it resolves names and gets Cloudflare's addresses back; (3) after **any** zone change, **check for Cloudflare-range addresses** as the content of A and AAAA records and for **proxied Microsoft 365 records**. An address of that kind is invisible from outside (`dig` shows Cloudflare's addresses for a proxied record either way), so the check reads the dashboard's export: [14.4](#144-zone-pre-flight-read-only-pa-1).

### 14.2 The route model

| Host | Attached how | To what | When the 100,000-request day is spent | Notes |
| --- | --- | --- | --- | --- |
| `sakolakembara.org/*` | a **Route** over the proxied apex record (D-02, unchanged) | the web Worker `sakola-kembara-web`, with the WordPress pass-through of SAKEM-103 | **OPEN** (D-06): the Worker is bypassed and WordPress answers, where the new URLs are a 404 | WordPress stays behind the same hostname: a `fetch()` of the incoming URL from the Worker reaches the origin (documented for routes; **real zone**). **Rollback is removing the route** |
| `www.sakolakembara.org` | **no Worker**: the proxied CNAME stays; a zone **Single Redirect** to the apex, 301, path and query kept (SA-23) | the zone rule | not applicable | The route pattern is not matched by `www` (exact host), which is why the rule is needed (R-03) |
| `admin.sakolakembara.org` | a **Custom Domain** of the admin Worker `sakem-admin` (Workers, Settings, Domains & Routes) | the admin Worker: the admin app and `/api/*` | **CLOSED** by construction: the documentation describes the fail mode as a property of a route, so a Custom Domain has none to set and a spent limit is error 1027 (**real zone**: confirm in the dashboard that no toggle exists) | Cloudflare creates the DNS record (it points directly at the Worker) and an Advanced Certificate. The hostname must have **no existing CNAME** (Cloudflare refuses). A wildcard record is not supported by Custom Domains: sort it out first |
| `files.sakolakembara.org` | a **custom domain of the PUBLIC R2 bucket** `sakem-files` (R2, the bucket, Settings, Custom Domains), then `UPLOADS_BASE_URL` | R2, no Worker | R2 has no daily request limit of the Workers kind | Removing the domain removes its CNAME. The `r2.dev` address stays **disabled**. Cloudflare's cache serves it (by default only some file types are cached: images and PDFs are) |
| not attached | the portal Worker and its routes `sakolakembara.org/portal` and `/portal/*`; any domain on the private bucket `sakem-private` | nothing | | The private bucket gets **no** domain, ever |

The commands are dashboard steps, written for Dzul:

- **Admin domain.** Workers & Pages, `sakem-admin`, Settings, Domains & Routes, Add, **Custom Domain**, `admin.sakolakembara.org`, Add Custom Domain. First `dig +short CNAME admin.sakolakembara.org @1.1.1.1` must print nothing. Wait for the domain to be **Active** and the certificate to be issued (SSL/TLS, Edge Certificates).
- **Files domain.** R2, `sakem-files`, Settings, Custom Domains, Add, `files.sakolakembara.org`, Continue, **Connect Domain**; wait for **Active** (a few minutes; "Retry connection" if not). The bucket's **Public Development URL** must read Disabled.
- **The route** (the switch, SA-24). Workers & Pages, `sakola-kembara-web`, Settings, Domains & Routes, Add, **Route**; zone `sakolakembara.org`; route `sakolakembara.org/*`; failure mode **fail open** (the dialog's own wording is not in the documentation: look for "fail open" or "proceed"). Note the time to the second.
- **Nothing is attached by `wrangler deploy`.** Both production configurations have `workers_dev: false` and no `routes` (a test pins both): a deploy creates a Worker nobody can reach until the dashboard attaches it. That is deliberate: wrangler turns the `workers.dev` address of a Worker on at every deploy unless the configuration says otherwise, and a production Worker there would be a public second copy of the site whose pass-through calls itself.

### 14.3 What Phase A needs, and what it does not

**Does NOT need** (all of it is Phase B or later):

| Item | Why it stays out | Caveat |
| --- | --- | --- |
| The portal Worker `sakem-portal`, its routes, its SPA, its secrets and `PORTAL_*` variables | the portal is deferred | there is **no production printer or dry run for it** on purpose |
| The private bucket's **use** (applicants' documents) | no uploads from the public in Phase A | **the resource must still exist**: the admin Worker's configuration binds `sakem-private`, and a deploy that finds none creates it without the location hint. Create it empty and private (14.5) and never give it a domain |
| Resend **for the portal** (registration, verification, status mails, `email_daily`) | no student accounts | Resend for the **admin** is a separate question: DA-2 |
| The privacy policy page (SAKEM-056, P-06) | it was a blocker because of the portal's uploads and registration | **Dzul's decision (DA-1).** Phase A still collects names, emails and messages through `/kontak`, and the staff accounts of the admin; the page is not needed for uploads because there are none |
| T-16, T-17, D-03, M4 | no portal | replaced by TA-07 (what `/login`, `/register` and `/portal` do is observed, not asserted) |
| P-01 (A) | the registration decision is taken | recorded 2026-10-15: portal later; sign-up through `/daftar` |

**Still needs:**

| Item | Step | Notes |
| --- | --- | --- |
| A **real Turnstile widget** for the real hostnames, for `/kontak` and the admin's sign-in | P-11, SA-04 | list `sakolakembara.org` **and** `admin.sakolakembara.org` (and the throwaway name of SA-12) as hostnames; Cloudflare's always-pass test keys are refused by the printers. Seen working on a phone (T-12) |
| A **WordPress backup that was checked**, and the content freeze | P-12, S-06 | WordPress is the rollback target and the only copy of the media that was never mirrored (R-07) |
| The **real shortlinks**, `daftar` included | P-07, SA-09 | `daftar` cannot be created while the admin reserves the name and a static rule answers it: F-17 |
| The **first production super_admin** in the production D1 | P-08, SA-07 | [`first-super-admin.md`](first-super-admin.md); a second one can be invited only with email (DA-2) |
| The **production D1 with the 86 articles** and every article WordPress publishes before the switch | P-05, SA-09, SA-13 | counts compared with the live sitemap |
| Content of the other admin-managed pages (team, reports, documents) | SA-09 | they read D1 too: an empty production database shows their empty states at launch (DA-6) |
| The **Web Analytics site** for `sakolakembara.org` and its **beacon id** | P-24, SA-04 | automatic injection off for the hostname; the id goes in the build **and** the `--var` (T-25) |
| `PAGE_CACHE_SECONDS` | SA-05 | `30`. The staging probe put `/blog` at 13 ms CPU a request without the page copy, above the 10 ms limit ([`free-plan-audit.md`](free-plan-audit.md#10-cpu-on-the-hot-routes-sakem-091)); the printer refuses a site deploy without it |
| A **Resend key** | P-10, SA-04 | **only if** the admin's invitation, verification and reset emails are wanted at launch (DA-2) |
| Account safety nets, the window, the rollback rehearsal, log retention | P-20 to P-23 | unchanged |

### 14.4 Zone pre-flight (read-only), PA-1

**PA-1: before anything is attached, and again at the hold point HA1 (SA-21), the zone is exported and read.** None of it changes anything.

1. **Export** the zone from the dashboard (DNS, Records, Import and Export, **Export**) and save it **outside the repository** (a password manager note, an encrypted folder): it holds the origin's address. Compare it **record by record** with the export of the OLD zone that Dzul kept at the previous provider (rule 1 of 14.1), and tick "reviewed by" with a second person (P-13).
2. **Run the check** over the export (`cf/scripts/check-zone-export.mjs`; offline: it reads one file, uses no network, writes nothing, and refuses a file inside the repository):

   ```bash
   cd cf/web
   pnpm check:zone-export -- <the export file>
   ```

   It prints one line per rule and exits 1 on a failure. **Z-01**: no A or AAAA record has a Cloudflare address as its content (the incident). **Z-02**: no wildcard record (`--allow-wildcard` only once a wildcard is intended and its content was read by hand). **Z-03**: no mail, autodiscover, DKIM, hosting-panel or Microsoft 365 record is **proxied** (grey cloud for all of them). **Z-04**: nothing points at `workers.dev`. **Z-05**: the apex has a proxied record (a route needs one) and `www` too. **Z-06**: what Microsoft 365 holds (MX, SPF include, autodiscover, the two DKIM selectors). **Z-07**: every proxied name. Anything it fails is fixed **in the dashboard**, then the zone is exported and checked again until it exits 0. The ranges it uses are Cloudflare's published lists (read 2026-10-15); a test pins them.
3. **Read-only queries** that the export cannot answer. They use `dig` against a public resolver and send nothing to the account:

   ```bash
   # a wildcard answers for a name nobody made: empty output (NXDOMAIN) is the right answer for every type
   for t in A AAAA CNAME MX TXT; do echo "$t: $(dig +short $t zz-check-$(date +%s).sakolakembara.org @1.1.1.1)"; done
   # the Microsoft 365 names must answer as CNAMEs to Microsoft's hosts; Cloudflare addresses instead mean the record is proxied.
   # Only names the export lists are expected to answer; an empty line for a name the export lists is a failure
   for n in autodiscover lyncdiscover sip enterpriseregistration enterpriseenrollment msoid selector1._domainkey selector2._domainkey; do
     printf '%-28s ' $n; dig +short CNAME $n.sakolakembara.org @1.1.1.1 | tr '\n' ' '; echo; done
   dig +short MX sakolakembara.org @1.1.1.1                      # ends in .mail.protection.outlook.com.
   dig +short TXT sakolakembara.org @1.1.1.1 | grep spf1        # includes spf.protection.outlook.com
   dig +short NS sakolakembara.org @1.1.1.1                      # the two Cloudflare nameservers
   dig +short DS sakolakembara.org @1.1.1.1                      # empty, or the DS that DNS, Settings, DNSSEC shows (P-15)
   curl -sI https://sakolakembara.org/ | head -30               # WordPress's signature headers (SA-20 records them)
   curl -sI https://www.sakolakembara.org/ | head -10           # the canonical host of WordPress: it must NOT redirect the apex to www
   ```

   The last line matters for SA-23: a zone rule that sends `www` to the apex, over a WordPress that sends the apex to `www`, is a redirect loop.
4. **Record** the result in SAKEM-084 as "done" or the failing rule's ID, never a value.

### 14.5 Production resources, variables and the printed commands

**One rule for every command of the day:** `CLOUDFLARE_ENV` must be **unset** (`echo "[$CLOUDFLARE_ENV]"` prints `[]`; the staging runbook sets it for its session). Wrangler and `pnpm build` obey it, so a shell left on staging deploys or builds the staging Worker silently. The printers refuse to run while it is set, the production build (`pnpm build:prod`) unsets it, and every production command below carries `--env=""`, which selects the top level whatever the variable says (tested with wrangler's dry run on 2026-10-15). Pin the organisation account in the shell (`export CLOUDFLARE_ACCOUNT_ID=...`, never written anywhere). Every real command below needs Dzul's explicit OK, as in the staging runbook, and `git status --short` is checked after each one (it must stay clean: no id may land in a tracked file).

**The resources the top-level configurations expect** (names, read from the files; the printers print the same list so Dzul can compare it with the dashboard):

| Kind | Name | Notes |
| --- | --- | --- |
| Worker | `sakem-admin` | the API and admin; the site's service binding names it |
| Worker | `sakola-kembara-web` | the public site (**the name is the identity of its routes and analytics: DA-7 before the first deploy**) |
| D1 | `sakem-admin` | one database for the admin (and later the portal); location hint `apac` |
| R2 | `sakem-files` | PUBLIC through `files.sakolakembara.org`; location hint `apac` |
| R2 | `sakem-private` | PRIVATE, empty, no `r2.dev`, no domain; created only because the admin Worker binds it |
| attached in the dashboard | `admin.sakolakembara.org`, `files.sakolakembara.org`, the route `sakolakembara.org/*` | 14.2 |

```bash
cd cf/admin
pnpm exec wrangler d1 list                                         # read-only: the organisation's databases only
CI=1 pnpm exec wrangler d1 create sakem-admin --location apac      # CI=1: wrangler must not offer to write the id into wrangler.jsonc
CI=1 pnpm exec wrangler r2 bucket create sakem-files --location apac
CI=1 pnpm exec wrangler r2 bucket create sakem-private --location apac
pnpm exec wrangler r2 bucket dev-url get sakem-files               # must NOT show a public address
pnpm exec wrangler r2 bucket dev-url get sakem-private             # must NOT show a public address
pnpm exec wrangler r2 bucket domain list sakem-private             # must list no custom domain, now and after every change to R2
pnpm exec wrangler d1 migrations list  sakem-admin --env="" --remote   # fourteen not yet applied, 0000 to 0013
pnpm exec wrangler d1 migrations apply sakem-admin --env="" --remote   # shows them, asks you to confirm
pnpm exec wrangler d1 execute sakem-admin --env="" --remote --command \
  "SELECT type, name FROM sqlite_master WHERE name IN ('signable_super_admins', 'users_keep_one_super_admin')"   # two rows
git status --short                                                 # clean
```

**Variables and secrets, names only.** A value of a `--var` is public; a secret is typed into wrangler's own prompt. A deploy **deletes every variable it does not pass** (wrangler's `--keep-vars` is deliberately not used) and never deletes a secret, which is why the values live in one untracked file per Worker, `.production.vars` (copy `production.vars.example`; git-ignored), and the printer prints the whole command from it.

| Name | Worker | Kind | Value |
| --- | --- | --- | --- |
| `TURNSTILE_SITE_KEY` | admin and site | public var, required | the real widget's site key (not a test key) |
| `UPLOADS_BASE_URL` | admin and site | public var, required | exactly `https://files.sakolakembara.org` |
| `SITE_URL` | admin | public var, required | exactly `https://sakolakembara.org` |
| `EMAIL_FROM` | admin | public var, optional | on `sakolakembara.org`, only with a Resend key (DA-2) |
| `ADMIN_URL` | site | public var, required | exactly `https://admin.sakolakembara.org` |
| `WEB_ANALYTICS_BEACON_ID` | site | public var, required | 32 hexadecimal characters; **also** in the shell of the build (below) |
| `PAGE_CACHE_SECONDS` | site | public var, required | `30` (1 to 120) |
| `CONTENT_CACHE_FRESH_SECONDS`, `TEAM_CACHE_FRESH_SECONDS` | site | public var, optional | seconds, default 60 and 300 |
| the variables of SAKEM-103 (the Phase A pass-through) | site | to be added | **one entry in `SPECS.web` of `cf/scripts/production-deploy-command.mjs`**; a test fails for any variable of the site's `env.d.ts` that is neither printable nor refused, so none can be forgotten |
| `BETTER_AUTH_SECRET` | admin | secret | `openssl rand -base64 32`, **a new value** (never one used on another Worker or environment) |
| `TURNSTILE_SECRET_KEY` | admin | secret | the widget's secret key |
| `RESEND_API_KEY` | admin | secret, optional | only with DA-2 |
| `LEGACY_ORIGIN_URL`, `CONTENT_API_URL`, `CONTACT_API_URL`, `COOKIE_DOMAIN`, `TRUSTED_ORIGINS`, `ENVIRONMENT`, every `PORTAL_*` | none | **never set** | refused by the printers; `ENVIRONMENT` is `production` in the configuration |

The printers refuse (with the line number): a secret name; an API URL; a placeholder (`<...>`); an `http://` origin; a path or a trailing slash; anything that looks like staging (a `workers.dev` or `r2.dev` host, Cloudflare's always-pass Turnstile test keys `1x00...`, `no-legacy-origin.invalid`, `resend.dev`, the word "staging"); an origin that is not the host of its role; an empty required value; a required value that is missing. The three origins are fixed to the plan's hostnames.

```bash
# the admin (cf/admin), then the site (cf/web): the site's binding names the admin, so the admin goes first
cd cf/admin
cp production.vars.example .production.vars            # git-ignored; fill in the public values
pnpm deploy:prod:dry                                   # no account (cf/scripts/production-dry-run.mjs): "production dry-run ok: sakem-admin, ..."
pnpm deploy:prod:command                               # prints the build line and the command, and the resources it expects: read them
pnpm build:spa
pnpm exec wrangler deploy --env="" --var '...'         # the printed line (your OK): the Worker exists but nobody can reach it
openssl rand -base64 32 | pbcopy                       # then paste at the hidden prompt and clear the clipboard
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env=""
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --env=""
pnpm exec wrangler secret put RESEND_API_KEY --env=""  # only with DA-2
pnpm exec wrangler secret list --env=""                # NAMES only

cd ../web
cp production.vars.example .production.vars
pnpm deploy:prod:dry                                   # builds the production site with no beacon and dry-runs it: "production dry-run ok: sakola-kembara-web, ..."
pnpm deploy:prod:command                               # refuses the build the dry run just made (no beacon) and prints the build line to use
WEB_ANALYTICS_BEACON_ID=<the id> pnpm build:prod       # on the command line, never exported: a later staging build in this shell would pick it up
pnpm deploy:prod:command                               # now it checks dist/ (the production build, the id in the prerendered home page) and prints
pnpm exec wrangler deploy -c dist/server/wrangler.json --var '...'   # the printed line (your OK): still no route, still unreachable
```

The beacon id is needed twice because the site has two kinds of page: the prerendered ones (`/`, `/donasi`, `/gabung-siswa`, `/program/<id>`) take it from the shell of the build, the pages the Worker renders from the `--var` ([`web-skeleton.md`](web-skeleton.md#web-analytics-sakem-095-decision-d-07)). The printer prints the build line with the id from the same file, refuses to print while `dist/` was built without it or with another one, and T-25 checks the result on the live site.

### 14.6 The Phase A day

"Replaces" says which step of section 6.2 the row stands for. **Who**: *Dzul* needs Dzul (a real action in an account, DNS or the dashboard, or his approval per step); *agent* prepares (text, commands, a read-back).

| ID | When | Step | Replaces or uses | Who |
| --- | --- | --- | --- | --- |
| SA-01 | T-7 d | Choose the window, tell the team and Rommy, ask for the WordPress freeze from T-1 d 18:00; name a second person with dashboard access (DA-4); the window rules of [14.9](#149-the-rules-of-the-window) | S-01, P-21 | Dzul |
| SA-02 | T-7 d to T-3 d | **The code is ready**: SAKEM-103 merged into `cloudflare` and deployed from there; **HSTS `max-age=300`** (F-01, D-04, F-18); `daftar` can be created as a shortlink (F-17); the redirect additions of D-05 (F-03 to F-08); the answer for unknown and WordPress paths documented. Without these TA-01 and TA-02 cannot pass | P-19 | agent prepares, Dzul approves |
| SA-03 | T-72 h | **Zone pre-flight** ([14.4](#144-zone-pre-flight-read-only-pa-1)): export, compare with the old zone, `pnpm check:zone-export`, the `dig` queries; sort out the wildcard and any proxied Microsoft 365 record; DNSSEC state (P-15) | S-02, S-03, P-13 to P-15 | Dzul runs, agent reads |
| SA-04 | T-72 h | **Objects in the account**: the real Turnstile widget (hostnames in 14.3); the Web Analytics site for `sakolakembara.org` with the automatic injection off, and its beacon id; Resend only with DA-2 (domain verified; its records added **without touching the Microsoft 365 SPF**; run `pnpm check:zone-export` again); the usage notification (P-20); the analytics and Turnstile steps in P-11, P-24 | P-10, P-11, P-20, P-24 | Dzul |
| SA-05 | T-48 h | **Production resources and variables** ([14.5](#145-production-resources-variables-and-the-printed-commands)): D1, the two buckets, the 14 migrations, both `.production.vars`, both dry runs. `workers_dev` is off in the configurations | P-09, P-18 | Dzul (agent prepares the text) |
| SA-06 | T-48 h | **Deploy the admin Worker**, then its secrets (14.5). It is unreachable until SA-07 | P-18 | Dzul |
| SA-07 | T-48 h | **Attach `admin.sakolakembara.org`** (14.2). Then `curl -s https://admin.sakolakembara.org/api/config`: the real site key, `uploadsBaseUrl`, `siteUrl`; `/api/me` is a 401. **First super_admin**: `pnpm first-admin --database sakem-admin --remote` ([`first-super-admin.md`](first-super-admin.md)), sign in with the real widget, check Aktivitas. The zone rules of SA-23 that protect the admin host (F-16, F-19) are added now, not on the day | P-08, S-22 | Dzul |
| SA-08 | T-48 h | **Attach `files.sakolakembara.org`** to `sakem-files` (14.2), upload a small image through the admin, open it at the files host (`cache-control: public, max-age=31536000, immutable`, the right `content-type`), delete it. `pnpm exec wrangler r2 bucket dev-url get sakem-files` shows no public address | S-22, [`uploads.md`](uploads.md#owner-steps-bucket-domain-variable) | Dzul |
| SA-09 | T-48 h to T-24 h | **Content**: the 86 articles imported into the production D1 (migration `0012` is among the 14; `pnpm blog:import:local -- --out <file outside the repo>`, then `wrangler d1 execute sakem-admin --env="" --remote --file <it>`, then `SELECT count(*) FROM blog_posts` is 86; Time Travel bookmark written down first); the real shortlinks including `daftar`; team, reports and documents (DA-6) | P-05, P-07 | Dzul |
| SA-10 | T-24 h | **Record the live corpus** with `--record` (needs Dzul's approval for the run) | S-04 | Dzul (agent prepares the command) |
| SA-11 | T-24 h | **Deploy the production site Worker** (14.5): dry run, the build with the beacon id, the printed command. No route yet | P-18 | Dzul |
| SA-12 | T-24 h | **Rehearsals on the throwaway name** `cache-test.sakolakembara.org`: first S-20 and S-21 unchanged (the **staging** pair, which must still be deployed: cache checklist C-01 to C-08, stale-if-error with the staging API broken on purpose, the rollback rehearsal, the timing written down); then, recommended, the **production site Worker** on the same name as a Custom Domain: `/`, `/blog` twice (`x-blog-source` network then cache), `/tim`, `/laporan`, `/kontak` (the widget carries the production key), `/sitemap.xml` (about 96 URLs); delete the domain. Do not browse it (the beacon matches by suffix and would count the visits). Pass-through paths cannot be tested there (a Custom Domain re-enters itself) | S-20, S-21, P-22 | Dzul |
| SA-13 | T-1 d 18:00 | **WordPress freeze**, final backup with checksums, the **final article re-import** and the count against the live sitemap; WordPress auto-updates switched off at the host | S-06, P-05, P-12 | Dzul |
| SA-20 | T-0 | **Window opens.** Baseline, private: `curl -sI` of the apex, `www`, `/wp-login.php`, `/wp-admin`, `/daftar` and one old article URL; the `dig` list of 14.4; write down WordPress's signature headers (they are the checker's `--legacy-header` input and what RBA-2 looks for) and what `/daftar` is on WordPress today (that is what a rollback restores) | S-10 | Dzul (agent prepares the lines) |
| SA-21 | after SA-20 | **Hold point HA1 (replaces H1 and H2).** The zone pre-flight is run again and is clean (`pnpm check:zone-export` exits 0, the `dig` queries as before); the admin and files hosts are Active and checked; the rehearsal timing is known; the production site Worker is deployed; the cache and rollback rehearsals passed. Continue only on "all of this is true" | H1, H2 | Dzul |
| SA-22 | after SA-21 | **TLS: verify, do not change.** The SSL/TLS mode and Always Use HTTPS stay as they are (WordPress works through them today); the zone's HSTS stays off (the Worker sends its own header). Record `curl -sI http://sakolakembara.org/` | S-30, S-31 | Dzul |
| SA-23 | after SA-22 | **Zone rules**, text below: the `www` redirect, the `?p=` rule, the WAF rules | S-32 | Dzul (agent prepares the rule texts) |
| SA-24 | after SA-23 | **THE SWITCH.** Attach the route `sakolakembara.org/*` to `sakola-kembara-web`, fail open (14.2). Note the time to the second | S-33 | Dzul |
| SA-25 | SA-24 + 0 min | **Smoke tests**: `pnpm check:production -- --allow-network` ([14.7](#147-smoke-tests-of-phase-a); about 40 requests, a minute; Dzul's approval for the run) and the manual tests. Apply the decision rule of 9.2 at each failure | S-34 | Dzul runs, agent reads |
| SA-26 | SA-24 + 15 min | SEO parity against production, Search Console (X-02, X-03) | S-35, X-02, X-03 | Dzul (agent reads the report) |
| SA-27 | SA-24 + 60 min | The first-hour watch (section 8), the announcement (section 10), the 48-hour plan | S-36, S-37 | Dzul |

**Zone rules (SA-23).** Free limits: 10 Single Redirects, 5 WAF custom rules. Redirect rules run first in the Rules order, before the Worker and the origin (the documented order of the Rules products; **real zone**: confirm in the Workers metrics that a redirected request is not a Worker request).

| Rule | Where | Text | Notes |
| --- | --- | --- | --- |
| `www` to the apex | Rules, Redirect Rule, wildcard pattern | request URL `https://www.*`, target `https://${1}`, status **301**, **preserve query string** | the documented example of Cloudflare; with Always Use HTTPS on, `http://www...` takes one more hop (T-03 allows two). Only after the 14.4 check that WordPress does not send the apex to `www` |
| `/?p=<id>` (F-06) | Rules, Redirect Rule, custom filter | `(http.request.uri.path eq "/" and starts_with(http.request.uri.query, "p="))`, static target `https://sakolakembara.org/blog`, 301, preserve query **off** | Free has no regex, so this matches any `p=` query; **verify the expression in the dashboard** (F-06). **Disable it at a rollback** (RBA-4): WordPress resolves `?p=` itself |
| the admin's student registration (F-16) | Security, WAF, Custom rules | `(http.host eq "admin.sakolakembara.org" and http.request.uri.path eq "/api/auth/register")`, action **Block** | added at SA-07, with the test below |
| the admin's security headers (F-19) | Rules, Transform Rules, Modify Response Header | when `(http.host eq "admin.sakolakembara.org")` set `X-Frame-Options` to `DENY`, `X-Content-Type-Options` to `nosniff`, `Referrer-Policy` to `strict-origin-when-cross-origin` | the admin app's pages carry none of their own; TA-05 warns until this exists |
| `/xmlrpc.php` (F-09, changed) | Security, WAF, Custom rules | `(http.request.uri.path eq "/xmlrpc.php")`, **Block** | **only after** the plugin list of P-12 shows nothing that uses it (Jetpack, the mobile app, a payment callback). Unchanged risk R-09 |
| `/wp-login.php`, `/wp-admin/` (F-09, **changed**) | Security, WAF, Custom rules, optional | `(http.request.uri.path eq "/wp-login.php") or (starts_with(http.request.uri.path, "/wp-admin/") and http.request.uri.path ne "/wp-admin/admin-ajax.php")`, **Managed Challenge** | **not blocked**: Phase A keeps them reaching WordPress. Optional (DA-3). With it, TA-03 prints a warning, not a pass, because a script meets the challenge |

The registration block is tested once by hand: `curl -si -X POST https://admin.sakolakembara.org/api/auth/register -H 'content-type: application/json' -d '{}'` must be a **Cloudflare block page (403, HTML)**, not the API's JSON error.

### 14.7 Smoke tests of Phase A

The checker is `cf/scripts/check-production-site.mjs` (`pnpm check:production` in `cf/web`). **It asks the four hosts of the plan and no other** (there is no option to name a host and a URL outside the four is refused before any request), sends **GET and nothing else**, no cookie, no credential, no token, **one request per second** (it cannot be made faster), and **writes nothing** (`--json` prints to standard output). It needs Dzul's approval for the run (`--allow-network` is the reminder; `--plan` prints what it would ask). Exit codes: 0 all passed, 1 a check failed, 2 refused or bad arguments, 3 nothing answered. Every output line starts with the ID of the test it answers.

```bash
cd cf/web
pnpm check:production -- --plan                                        # what it would ask; nothing is sent
pnpm check:production -- --allow-network                               # the real run (Dzul's approval)
pnpm check:production -- --allow-network --only admin,files            # at SA-07 and SA-08, before the switch, and after a rollback
pnpm check:production -- --allow-network --daftar-target <the form's URL> --legacy-header 'x-some-header=value'   # what SA-20 recorded
```

Of the Phase A tests the plan asked for, `www` to the apex is **T-03** (strict 301), HSTS `max-age=300` is **TA-01**, the old WordPress URLs are **T-08** and **T-09** (the checker asks two; the parity run asks all 86), `/daftar` is **TA-02**, WordPress's own paths are **TA-03** and "new-site paths never reach the origin" is **TA-04**.

| ID | Check | Expected in Phase A | By |
| --- | --- | --- | --- |
| T-01 (A) | `https://sakolakembara.org/` | **changed**: 200 html, `lang="id-ID"`, canonical itself, no cookie, no `wp-content`; the HSTS value is TA-01 | checker |
| TA-01 | **HSTS and the security headers** on `/` and on a static asset | `strict-transport-security: max-age=300` **exactly** (no `includeSubDomains`, no `preload`: D-04, F-01), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. **The code still sends the one-year value (F-18)** | checker |
| T-02 (A) | `http://sakolakembara.org/` | one permanent redirect to https | checker |
| T-03 (A) | `https://www.sakolakembara.org/blog?x=1` | one **301** to `https://sakolakembara.org/blog?x=1` (the zone rule; a WordPress `x-redirect-by` header is a TA-04 failure) | checker |
| T-04 to T-06 | robots, sitemap, `/blog` | as written; the sitemap lists about 96 URLs all on the apex; `/blog` twice shows `x-blog-source` network then cache (C-02, a warning if not: another data center) | checker |
| T-07 (A) | an article | canonical itself, absolute `og:image`, BlogPosting, **no image from `r2.dev`**; the images load from `files.sakolakembara.org` or `/blog/images` | checker (one article), Dzul (the rest) |
| T-08, T-09 | the old WordPress URLs | `/cerita/<slug>/` and `/education/` are a 308 (the checker); every one of the 86 is proved by the parity run (SA-26); `/wp-content/uploads/...` redirects to `/blog/images/...` then 200 | checker, parity tool, Dzul |
| T-10 (A) | an unknown path | the new site's 404 with noindex. **Depends on SAKEM-103**: if unknown paths are meant to fall through to WordPress, the checker prints a warning that says so | checker |
| T-11, T-12, T-13 | `/tim`, `/laporan`, `/gabung-siswa/docs` have the entered content; `/kontak` on a **phone**: the real widget, a test message in the admin's Pesan; a shortlink's click counter | as written | Dzul |
| T-14 (A) | `/api/public/*` | a 404 JSON on the apex **and** on the admin host (the checker asks GET; the POST half of the contact route by hand) | checker, Dzul |
| T-15 (A) | `/admin` | **changed**: `/admin/blog?x=1` is a 308 to `https://admin.sakolakembara.org/blog?x=1`; the first super_admin signs in at the admin host (Dzul) | checker, Dzul |
| T-16, T-17 | `/login`, `/register`, `/portal` | **deferred with the portal**; replaced by TA-07 | |
| T-18 to T-21 | `/api/anything`, the trailing slash, assets, security headers | as written (T-19 is a 308 on the real zone or a warning with the reason) | checker |
| T-22, T-23 | the old sitemap names, `/?p=<id>` | only if the F-08 and F-06 rules are in | Dzul |
| T-24 to T-26, T-30 | no-JavaScript form, the beacon on both kinds of page, one hit in the dashboard, the Workers metrics | as written, for the production host | Dzul |
| C-01 to C-03, C-06 | the cache checklist | on production at SA-25 (the checker asks `/blog` twice: C-02); C-04, C-05, C-07 and C-08 need the staging API broken on purpose and are SA-12 only | checker (C-02), Dzul |
| C-09 | the cache status of static assets and files | **new**: `cf-cache-status` is noted (MISS then HIT is the sign it works), never judged | checker (the run needs Dzul's approval) |
| M-01 to M-04 | mail | as written; M-03 only with DA-2 | Dzul |
| TA-02 | **`/daftar`** | a **307** to the registration form (a shortlink: the old static rule is a 308 to `/gabung-siswa`, F-17); `--daftar-target` pins the form's URL | checker |
| TA-03 | **`/wp-login.php` and `/wp-admin` still reach WordPress** | the login form (200); `/wp-admin` a 301 or 302 to `/wp-admin/` or the login. A challenge rule makes it a warning | checker |
| TA-04 | **new-site paths never reach the origin** | no WordPress, PHP or LiteSpeed header on any answer of the apex, `www`, admin or files host except the two WordPress paths (the old stack's names are built in; `--legacy-header` adds what SA-20 recorded) | checker |
| TA-05 | **the admin host** | `/` 200 html; `/api/config` has a real site key, `uploadsBaseUrl` and `siteUrl` equal to the production hosts (so the `--var` values were deployed); `/api/me` 401; a warning if the admin sends no `X-Frame-Options` or `nosniff` (F-19) | checker |
| TA-06 | **the files host** | `/` does not list the bucket; a missing object is a 404; an uploaded file is a 200 with `cache-control: public, max-age=31536000, immutable`, a file `content-type` and no cookie | checker |
| TA-07 | `/login`, `/register`, `/portal`, `/portal/status` | **observed, never failed** (what they do is SAKEM-103's); the status and target are written in SAKEM-084 | checker |

### 14.8 Rollback (Phase A)

**Triggers.** Section 9.1 applies, with these changes: trigger 2's list is "T-01 to T-12, T-14, T-18 and TA-01 to TA-04"; **trigger 8 is replaced**: *the sign-up path is dead* (`/daftar` does not reach the registration form, or the form itself fails) and cannot be fixed within 30 minutes (a shortlink is edited in the admin: minutes); **new trigger 10**: *WordPress does not answer behind the route* (`/wp-login.php`, a page or a file WordPress serves answers an error) and it is not fixed within 30 minutes. Not triggers on their own: a problem of the admin host (fix forward, or detach its Custom Domain: nothing public depends on it except the `/admin` redirect), of the files host (a wrong `UPLOADS_BASE_URL` is a redeploy of minutes; T-07 failing for 30 minutes is trigger 2), or of a zone rule (disable the rule). Who decides and how fast is 9.2 unchanged: Dzul, within 10 minutes; if he cannot be reached, the second person of SA-01 removes the route (DA-4).

| ID | Step | Time to take effect | Who |
| --- | --- | --- | --- |
| RBA-1 | **Remove the route**: Workers & Pages, `sakola-kembara-web`, Settings, Domains & Routes, the route `sakolakembara.org/*`, delete it (the routes page of the documentation describes adding a route, not removing one: **real zone**). The proxied apex record still points at WordPress | seconds to about five minutes | Dzul |
| RBA-2 | **Confirm WordPress is back** with the loop below: every 15 seconds until the headers recorded at SA-20 appear; one old article URL answers 200 at its old address | immediately after RBA-1 | Dzul |
| RBA-3 | **Record the timing**: the time of the click, the time of the first WordPress answer, the time of five in a row. Compare with the rehearsal of S-21 and write all three in SAKEM-084 | | Dzul |
| RBA-4 | **Disable the zone rules that only make sense with the new site**: the `?p=` rule (WordPress resolves `?p=<id>` itself). Keep the `www` redirect and the WAF rules | five minutes | Dzul |
| RBA-5 | **Leave the admin and files hosts up** (no public traffic uses them); detach `admin.sakolakembara.org` only if the admin itself is the problem | | Dzul |
| RBA-6 | RB-3 (the proxy itself) and RB-4 (a record) apply as written. **RB-5 does not apply**: the nameservers are never rolled back, the zone stays | | Dzul |
| RBA-7 | Tell the team and Rommy (section 10) and handle the data written in the window (9.4, below); write the time, the trigger and the evidence in SAKEM-084 | | Dzul (agent prepares the exports) |

```bash
for i in $(seq 1 20); do
  printf '%s ' "$(date +%T)"; curl -s -o /dev/null -w '%{http_code} ' https://sakolakembara.org/
  curl -sI https://sakolakembara.org/ | grep -i -E '^(x-powered-by|x-litespeed|link:)' | head -2 | tr '\n' ' '; echo; sleep 15
done
```

**What a rollback leaves behind in Phase A** (9.4 with the portal removed): the contact messages written since SA-24 stay in D1, invisible to WordPress: export and forward them. Shortlinks, **`daftar` included, stop working** (WordPress has none: record at SA-20 what `/daftar` is on WordPress today, that is what a rollback restores), so do not print or announce a new one in the window. Edits and uploads in the admin stay in D1 and R2. There are **no student accounts**, unless someone used the admin's `/api/auth/register` (F-16). A browser that was sent through a **308** during the window may keep the new address and meet a WordPress 404 on `/blog/<slug>` until it asks again: the reason to keep the window short.

### 14.9 The rules of the window

- **Dzul and one more person are reachable together** from SA-20 until four hours after SA-24, phones on, nobody else touching the account or the zone; the second person has dashboard access (DA-4).
- **No deploy after the switch** except a fix both agree on or the rollback; no zone change except the rollback steps.
- **Do not edit or update WordPress** (R-28): auto-updates off, no plugin changes, from the freeze (SA-13) until the 48 hours are over.
- **A weekday morning in WIB, from 08:00**, so the first day has 23 hours before the daily limits reset at 00:00 UTC (07:00 WIB); not a Friday, not the day before a holiday, not within a week of an announced admissions or donation campaign (the `/daftar` link is the WordPress form).
- Times are written to the second; every check is one line in SAKEM-084, no values.

### 14.10 Who does what

| Dzul (needs the account, the zone or his approval) | The agent prepares or reads |
| --- | --- |
| Every dashboard action: Custom Domains, the route, the zone and WAF rules, the Turnstile widget, the Web Analytics site, R2, Resend; every real wrangler command (the resources, the migrations, the deploys, the secrets, the first admin, the import); the approval of each run of `pnpm check:production`, `pnpm seo:parity` and the exports; the decision at a trigger | The printers and dry runs, the example files, the zone-export check, the production checker, this section and its rule texts; reading the checker's, the parity tool's and the zone check's output with Dzul; the exports of the data written in a window; the follow-up PRs of F-16 to F-19 |

### 14.11 What is not verified (needs the real zone)

- **Everything in 14.2 that is a dashboard behaviour**: that a route over the proxied apex lets the Worker's `fetch()` reach WordPress and not re-enter; that no fail-mode toggle exists for a Custom Domain (and that a spent limit is a 1027 there); the dialog's wording of the route's failure mode; how a route is deleted; that Custom Domain creation works with the existing records of the zone (the wildcard); that a Turnstile hostname covers subdomains (the printers' advice is to list `admin.` explicitly).
- **That redirect rules do not reach the Worker**, and the `?p=` expression and the `www` rule in the dashboard.
- **The cache on the real zone** (C-01 to C-08), the real CPU per route (T-30), the Worker request count per page view, the R2 domain's caching of images and PDFs (C-09 is only a note).
- **The checker against the live site**: its header and body markers follow answers recorded from the built Worker on loopback and invented answers for WordPress, the admin and the files host (`cf/web/tests/production-site-fixture.ts`). What WordPress really sends through Cloudflare (which headers survive), R2's answer for `/`, the admin's real `/api/config`, and what a challenge page looks like are guesses until the first run; each guess is a line of the checker that fails or warns visibly rather than passing quietly.
- **The zone-export check against a real export**: the format is Cloudflare's documented one (`cf_tags=cf-proxied:...` after each record); a long TXT record split over lines and the exact SOA layout were not seen.
- **Wrangler's behaviour on a real account** for `--env=""`, `--var`, `d1 migrations apply --env=""`, `secret put --env=""` (tested with `--dry-run` and local commands only), and that `workers_dev: false` leaves a deployed Worker unreachable.
- Visual and interaction QA of any page (nobody opened a browser for this).

### 14.12 Findings, risks and decisions of Phase A

| ID | Finding | Evidence | Severity | What to do |
| --- | --- | --- | --- | --- |
| F-16 | **The admin Worker serves the student registration route** `POST /api/auth/register` on the admin host (the route was mounted before the portal got its own Worker). With Turnstile and rate limits, but anyone can create student accounts in the shared D1 and trigger verification mails against Resend's 100 a day, which also carry the admins' invitations and resets. Without a Resend key it answers 503 | `cf/admin/src/worker.ts` (`registerStudent`), `src/auth/gate.ts` | **Medium** | the WAF block of SA-23 now; a ticket to remove the route from the admin app (it belongs to the portal) |
| F-17 | **`daftar` cannot be a shortlink today**: `redirects.config.mjs` answers `/daftar` with a **308 to `/gabung-siswa`** (the assets layer, before the Worker), and the admin reserves the name | `redirects.config.mjs`, `cf/admin/src/shortlinks/reserved.ts`, `tests/shortlink-reserved.test.ts` | **High for Phase A** (TA-02, trigger 8) | SAKEM-103 or a follow-up removes the rule and the reserved name; SA-02 |
| F-18 | **HSTS is still `max-age=31536000; includeSubDomains; preload`** in `public/_headers` and `src/lib/security-headers.ts`, pinned by a test. Phase A needs `max-age=300` (F-01, D-04): P-19 is **not met** | the two files | **High** (rollback) | the change is not made here (`cf/web/src` is SAKEM-103's); SA-02 |
| F-19 | **The admin app's pages carry no security headers** (the assets layer serves them with no `_headers` file, unlike the portal's): no `X-Frame-Options`, no `nosniff`, no `Referrer-Policy` | `cf/admin/dist/spa` has no `_headers` | **Medium** (clickjacking of the admin) | the response header rule of SA-23 now; a `_headers` file in the admin SPA build later; TA-05 warns until one exists |
| R-31 | **Every request of the apex is a Worker request in Phase A**, WordPress probes included (`/wp-login.php`, `/xmlrpc.php`); at 100,000 the route fails open and the new URLs become WordPress 404s | 14.2, F-09 | H likelihood on a WordPress site, H impact | monitoring at 60,000 and 80,000 (section 8); the optional rules of SA-23; DA-3 |
| R-32 | **A browser may keep a 308** from the window and meet a WordPress 404 after a rollback | RFC behaviour of 308 | L | a short window |
| R-33 | **A DNS or proxy change by someone else** inside the window (the incident came from one) | 14.1 | M | the window rules; the second person; PA-1 at SA-21 |

Open decisions for Dzul:

| ID | Decision | Recommendation |
| --- | --- | --- |
| DA-1 | **The privacy policy page in Phase A**: launch without it (no uploads, but names, emails and messages through `/kontak`), or write the short version first | Dzul's call; the facts are above |
| DA-2 | **Resend at launch**: the admin's invitation, verification and reset mails need a key and a verified domain. Without it a lost password cannot be reset by mail (the break-glass of [`first-super-admin.md`](first-super-admin.md) is a direct database write) and a second admin cannot be invited | yes, before launch; Resend's free plan is enough |
| DA-3 | **WordPress-only paths** (`/wp-login.php`, `/wp-admin/*`, `/wp-json/*`): through the Worker's pass-through (SAKEM-103), or **routes with no Worker** (documented: a route with no Worker attached overrides less specific ones and skips Workers entirely: zero Worker requests), or a managed challenge | decide with SAKEM-103; the budget (R-31) argues for the bypass routes |
| DA-4 | **A second person with dashboard access** who may remove the route if Dzul cannot be reached | yes |
| DA-5 | **F-16**: the WAF block now, and a ticket to remove the route from the admin app | yes |
| DA-6 | **Content of team, reports and documents** in the production D1: entered before launch, or launched empty | enter before launch |
| DA-7 | **The site Worker's name**: `sakola-kembara-web` in the configuration, `sakem-web` in the portal architecture's placeholders, `sakem-web-staging` on staging. The name is what the route, the dashboard and the logs show; renaming after the first deploy means deploying a new Worker and moving the route | decide before SA-11 |

## Open decisions for Dzul

| ID | Decision | Recommendation |
| --- | --- | --- |
| D-01 | **Article addresses**: accept `/blog/<slug>` (the current design, 80 redirects) or keep WordPress's `/<category>/<slug>/` as the canonical addresses (new routes for seven categories, the table inverted) | accept, with the freeze and the monitoring of X-05 |
| D-02 | **Route over the proxied record** at cutover and Custom Domain after WordPress is retired, or a Custom Domain at once | route first |
| D-03 | **Registration at go-live**: (a) wait for M4, (b) go live pointing the sign-up buttons at the current WordPress form and bring M4 later, (c) undecided means no cutover | (a); never open registration inside the cutover window |
| D-04 | **The HSTS value** at the Worker (F-01) | `max-age=300`, no `includeSubDomains`, no `preload`; raise in steps |
| D-05 | **Which redirect additions** of F-03 to F-08 to make, and where (`_redirects` in the Worker, or zone rules) | the five slash rules, the category/tag/author rules and the sitemap names in `_redirects`; the `?p=` rule at the zone |
| D-06 | **The route's fail mode** at the 100,000-request limit | **Decided (PM, 2026-10-13): the public production route fails OPEN to the old origin (WordPress, behind the same hostname); the admin host's route fails CLOSED.** Treat the limit as an incident either way |
| D-07 | **Analytics** to replace WordPress's, and whether it needs a consent notice | **Decided (Dzul, 2026-10-15): Cloudflare Web Analytics**: free, cookie-free, no consent notice, replacing Google Analytics (Site Kit); the old history stays in the Google account. Built in SAKEM-095 (our own tag and the variable `WEB_ANALYTICS_BEACON_ID`, not the zone's automatic injection); steps P-24, T-25, T-26 |
| D-08 | **How long WordPress is kept** | 90 days, backups 12 months |
| D-09 | **The WAF probe rule** (F-09) | yes |
| D-10 | **The date and time of the window**, and who is reachable | a weekday morning WIB, outside a campaign |
| D-11 | **The real runs**: S-04 (about 700 GET requests to the live site) and the PageSpeed runs of [`seo-audit.md`](seo-audit.md) | approve once Dzul has read the dry-run plan |
| D-12 | **Phase A** (2026-10-15): the privacy page, Resend at launch, the WordPress-only paths, a second person with dashboard access, the admin's registration route, the content of team, reports and documents, the Worker's name | listed as DA-1 to DA-7 in [section 14.12](#1412-findings-risks-and-decisions-of-phase-a) |

## Sources

Cloudflare documentation read on 2026-10-13 (no account was used): Workers Custom Domains and Routes (`developers.cloudflare.com/workers/configuration/routing/custom-domains/`, `.../routes/`, Workers best practices); the Workers platform limits and errors (`.../workers/platform/limits/`, `.../workers/observability/errors/`, `.../metrics-and-analytics/`, Workers Logs); the Cache API (`.../workers/runtime-apis/cache/`, `.../workers/reference/how-the-cache-works/`); static assets redirects and headers (`.../workers/static-assets/redirects/`, `.../headers/`); DNS full setup, update nameservers, DNSSEC, the DNS FAQ (`.../dns/zone-setups/full-setup/setup/`, `.../dns/nameservers/update-nameservers/`, `.../dns/dnssec/`, `.../dns/faq/`); SSL/TLS modes, Always Use HTTPS and the redirect-loop troubleshooting page (`.../ssl/...`); Rules: Single and Bulk Redirects, their limits and execution order (`.../rules/url-forwarding/`); WAF custom rules limits (`.../waf/custom-rules/`); the D1 free-tier enforcement notice of 2026-09-01 (changelog). Cloudflare Web Analytics documentation read on 2026-10-15 (no account was used): `developers.cloudflare.com/web-analytics/faq/` (the snippet, `type="module"`, hostname matching, one snippet per page, Content-Security-Policy entries), `.../web-analytics/get-started/` (manual and automatic setup) and `.../speed/observatory/rum-beacon/` (what is collected, privacy, the EEA/EU option). Phase A, read on 2026-10-15 (no account was used): Workers Custom Domains and Routes (`developers.cloudflare.com/workers/configuration/routing/custom-domains/` and `.../routes/`: the Custom Domain conditions, the proxied record a route needs, a route with no Worker as a bypass), the Workers limits page (the fail mode as a property of a route), R2 public buckets (custom domain steps, removing the domain deletes its CNAME, only some file types cached by default, disabling `r2.dev`), the DNS import and export page (`cf_tags=cf-proxied:true|false`), Rules: Single Redirects and the `www` to root example (wildcard `https://www.*` to `https://${1}`, 301, preserve query string), the Rules execution order, and Cloudflare's published address lists `https://www.cloudflare.com/ips-v4` and `/ips-v6`. `wrangler deploy --help` of the installed 4.149 (`--env`, `--var`, `--keep-vars`, no workers.dev flag) and a dry run showing that `--env=""` selects the top level whatever `CLOUDFLARE_ENV` says. Repository documents: [`web-skeleton.md`](web-skeleton.md), [`portal-architecture.md`](portal-architecture.md), [`public-api.md`](public-api.md), [`content-api.md`](content-api.md), [`account-setup.md`](account-setup.md), [`uploads.md`](uploads.md), [`admin-blog.md`](admin-blog.md), [`admin-konten.md`](admin-konten.md), [`first-super-admin.md`](first-super-admin.md).
