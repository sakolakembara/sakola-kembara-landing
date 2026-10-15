# Cutover and rollback runbook: sakolakembara.org from WordPress to Cloudflare

Ticket: SAKEM-084 (M5), task M5-B. Written for **Dzul on the day**; the agent's part is to prepare lists, commands and checks beforehand and to read results back. Companion documents: the SEO tool and its plans in [`seo-audit.md`](seo-audit.md); the account in [`account-setup.md`](account-setup.md); the routing design in [`portal-architecture.md`](portal-architecture.md#3-d1-how-sakolakembaraorgportal-reaches-the-portal) and [`web-skeleton.md`](web-skeleton.md). M5-A writes `free-plan-audit.md` and `staging-runbook.md` (staging, CPU numbers, the Free-plan audit): this runbook points at them by name and does not repeat them.

**Status: paper.** Nothing in this runbook has been done. No Cloudflare account, DNS provider, registrar or live URL was used to write it; the Cloudflare documentation was read on 2026-10-13 (sources at the end). What is verified by tests today and what is paper is in [section 2](#2-what-is-verified-today-and-what-is-paper).

> **GO-LIVE IS BLOCKED ON M4 (student registration).** `/portal/*`, `/login` and `/register` have **no backend** until M4 (SAKEM-083) resumes: `/login` and `/register` are 308 redirects into `/portal/...`, the navbar's "Masuk" and the "Daftar Sekarang" buttons point there, and in production the web Worker would answer all of them with its 404 page (finding F-02). The cutover cannot happen until M4 is done or Dzul has recorded an explicit decision about what registration does at launch (P-01).

## 0. How to read this document

- Every step has an ID and a **Who** cell: **needs Dzul** (a real action in an account, DNS, the registrar or a browser: only he does it, or approves it per step) or **agent may prepare** (a list, a script, a command, a text to paste, a read-back of results; the agent never touches an account). Some say both.
- A step in a table is a step to **tick**. Do not skip a hold point (H1, H2).
- No secret, token, account id, resource id or password is written here or goes into a ticket: write "done" or "failed", never the value ([`account-setup.md`](account-setup.md)). The DNS inventory and every report of a real run live **outside the repository**.
- Times are in WIB (UTC+7) unless a step says UTC (Cloudflare's daily limits reset at midnight UTC, 07:00 WIB).

## 1. Decisions this runbook relies on (Dzul, not reopened here)

- The site is **live on WordPress today**; the Next app was never released and the VPS is no longer used. **The rollback target is the WordPress site, reached through DNS and Cloudflare settings.** (`docs/runbook/launch.md` and `docs/roadmap/mvp-roadmap.md` still describe a VPS cutover: they are superseded by this runbook for the Cloudflare plan.)
- New site: Astro on Workers Free (`cf/web`), the API and admin Worker (`cf/admin`), D1, R2, Resend. $0.
- Staging runs on `*.workers.dev`: **no cache behaviour is tested there** (the Cache API is documented to work on custom domains and routes; `workers.dev` is not mentioned). The zone `sakolakembara.org` moves to Cloudflare (nameservers) **only on cutover day**, with every record copied identically and kept DNS-only first. The zone may not be in the organisation account yet: this runbook assumes it is not.
- Every real Cloudflare or DNS action needs Dzul's explicit OK, per step.
- Shortlinks of the old Postgres were not migrated: the real ones are recreated in the new admin before cutover (P-07).
- All work lives on the long-lived branch `cloudflare`.

## 2. What is verified today and what is paper

| Statement | Status | Evidence |
| --- | --- | --- |
| All 80 WordPress article URLs redirect to `/blog/<slug>` with a 308, with and without the trailing slash; every rule of the table has its status | **verified by tests** (local) | `cf/web/tests/redirects.test.ts`, `scripts/e2e.mjs` group `wp-redirects` |
| `sitemap.xml` (static routes, programs, every article from the API), `robots.txt`, the security headers | **verified by tests** (local) | `tests/headers-sitemap.test.ts`, e2e |
| Title, description, canonical, robots, Open Graph, Twitter, Article, Program and Organization JSON-LD of the pages | **verified by tests** (local) | `tests/seo.test.ts`, the built-page tests, e2e |
| Unknown URLs are a real 404 with noindex; an API outage is a 503, never a 404 | **verified by tests** (local) | e2e groups `404`, `blog` |
| Content cache: 60 s fresh window, stale-if-error, a 503 that is never cached, a 404 remembered 30 s | **verified locally** against workerd's emulation of `caches.default` and against fakes; **not on a real zone** | `tests/content-api*.test.ts`, e2e group `blog` (the `x-blog-source` header says `network`, `cache`, `stale`, `empty` or `not_found`) |
| The SEO parity tool and its rules | **verified**: 126 unit tests on recorded fixtures, a fake fetch and the two documents, no network; a local rehearsal | `tests/seo-parity.test.ts`, `pnpm seo:parity:local` |
| Everything involving a zone, nameservers, DNS records, proxy, TLS modes, routes, Custom Domains, redirect and WAF rules, Search Console, Resend, Turnstile, real D1 and R2, real CPU on the Free plan, the real WordPress HTML | **paper** | nothing in this repository exercises it |

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
| P-09 | Variables and secrets set, **names only**: `TURNSTILE_SITE_KEY` (web and admin), `TURNSTILE_SECRET_KEY` (API), `UPLOADS_BASE_URL` (web and admin), `SITE_URL` (admin), `ADMIN_URL` (web, and the portal's "this is an admin account" link), `PORTAL_CONTACT_WHATSAPP` and `PORTAL_WHATSAPP_GROUP_URL` (portal only, OPTIONAL, public: the admissions desk's WhatsApp number as digits with the country code, and the participants' WhatsApp group invitation as an https address; unset or invalid means the wizard shows its "Kontak" fallback and no invitation; the school supplies both values; they are never written in a tracked file), `EMAIL_FROM`, the Resend key, `AUDIT_RETENTION_DAYS`, a **different `BETTER_AUTH_SECRET` for the admin and the portal Worker**; **`LEGACY_ORIGIN_URL`, `CONTENT_API_URL` and `CONTACT_API_URL` NOT set** (a test checks the checked-in config only: Dzul checks the deployed one in the dashboard); the Worker name `sakem-admin` equal in both `wrangler.jsonc` files | Dzul | "done" per name | needs Dzul |
| P-10 | The **Resend domain is verified** and its DNS records are in the DNS inventory (so they exist in the imported zone too) | Dzul | "verified" in the Resend dashboard | needs Dzul |
| P-11 | Turnstile widgets exist for the real host (the hostname list includes `sakolakembara.org`), and the real widget was seen working on a phone | Dzul | "done" | needs Dzul |
| P-12 | **WordPress backups exist and were checked**: the database dump, the whole `wp-content` (uploads, theme, plugins), the plugin list, stored in two places outside the hosting; `wp-config` is not copied around (it holds secrets) | Dzul | sizes and checksums | needs Dzul |
| P-13 | The **DNS inventory is complete** (section 4) and a second person compared it with the provider's dashboard | Dzul + one more | "reviewed by" | needs Dzul (agent may prepare) |
| P-14 | **TTLs lowered** as in section 5, with `dig` showing it | Dzul | the `dig` lines | needs Dzul |
| P-15 | **DNSSEC state known**; if it is on at the registrar, the plan of section 5 is followed | Dzul | "off" or the plan | needs Dzul |
| P-16 | Search Console: **Domain property verified by DNS TXT**; baseline exports saved (section 11); the top-20 URL list made | Dzul | "done" | needs Dzul |
| P-17 | Analytics decision made (open decision D-07) | Dzul | the decision | needs Dzul |
| P-18 | **Production Workers deployed with no route and no Custom Domain**, D1 and R2 created, migrations applied (the deploy changes no traffic until S-33) | Dzul | worker names listed | needs Dzul |
| P-19 | The code decisions of section 12 are **merged**: HSTS value (F-01), the empty pass-through list (F-10), and the redirect additions Dzul accepted (F-03 to F-08) | agent prepares the PRs | merged PR links | agent may prepare |
| P-20 | Account safety nets: a **usage or billing notification** on the organisation account; the fail mode of the route decided (D-06) | Dzul | "done" | needs Dzul |
| P-21 | **The window**: a weekday morning, away from a registration or announcement campaign, Dzul reachable for at least four hours after the switch, not the day before a holiday; Rommy and the team told ([section 10](#10-what-to-keep-of-wordpress-and-communication)) | Dzul | the date | needs Dzul |
| P-22 | The **rollback was rehearsed** on the throwaway hostname (S-21) in this window or on an earlier day of zone activity, with its timing noted | Dzul | the timing | needs Dzul |
| P-23 | **Log retention and URL-token exposure decided.** Workers Logs keeps the full request URL of every invocation (the verification-link and OAuth-callback tokens in the query string included) for 3 days, and from 2026-12-01 for 7 days under a 0.5 GB daily allowance ([`free-plan-audit.md`](free-plan-audit.md#5-observability)). `invocation_logs` stays on during M5, because the CPU record needs it. Before the switch decide: accept as it is, or turn invocation logs off once the CPU numbers are recorded, and who may open Workers Logs in the account | Dzul, PM | the decision | needs Dzul |

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
| X-09 | after D-07 | Analytics in place; the first week's numbers noted | needs Dzul |
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
| R-21 | **No analytics** after WordPress goes: no traffic baseline except Search Console | H | M | D-07 | Dzul | |
| R-22 | **M4 is not done**: registration and sign-in are dead links | H | H | P-01 | Dzul, PM | F-02 |
| R-23 | **The pass-through list points at nothing** after the VPS | H | L | the empty list | agent prepares | F-10 |
| R-24 | **The DNS import misses a record** (a quick scan, documented as incomplete) | M | H | the inventory from two sources and a second reviewer | Dzul | |
| R-25 | **TLS mode loops or errors** with the WordPress origin behind the proxy (Flexible against an origin that redirects to HTTPS; Strict against a certificate that does not match) | M | H | S-30 and S-31 with the proxy turned on before the route; T-02 | Dzul | |
| R-26 | **Route precedence** between the web route `/*` and the portal routes `/portal*` behaves differently than documented | L | M | attach the portal routes first; T-17 | Dzul | |
| R-27 | **Data written in the window is lost on a rollback** | M | M | section 9.4; no registration in the window | Dzul | |
| R-28 | **The WordPress site is edited or updated during the fallback** and diverges | L | L | the freeze, the 90 days without edits | Dzul | |
| R-29 | **Staging is indexed** | L | L | no links to it, canonical to production | | F-14 |
| R-30 | **`_redirects` limits** (2,000 static and 100 dynamic rules on Cloudflare; the generated file has 96 lines today, 75 static and 21 dynamic, after SAKEM-090) | L | L | the F-04 to F-08 rules stay small; `tests/redirects.test.ts` | agent | |

## Open decisions for Dzul

| ID | Decision | Recommendation |
| --- | --- | --- |
| D-01 | **Article addresses**: accept `/blog/<slug>` (the current design, 80 redirects) or keep WordPress's `/<category>/<slug>/` as the canonical addresses (new routes for seven categories, the table inverted) | accept, with the freeze and the monitoring of X-05 |
| D-02 | **Route over the proxied record** at cutover and Custom Domain after WordPress is retired, or a Custom Domain at once | route first |
| D-03 | **Registration at go-live**: (a) wait for M4, (b) go live pointing the sign-up buttons at the current WordPress form and bring M4 later, (c) undecided means no cutover | (a); never open registration inside the cutover window |
| D-04 | **The HSTS value** at the Worker (F-01) | `max-age=300`, no `includeSubDomains`, no `preload`; raise in steps |
| D-05 | **Which redirect additions** of F-03 to F-08 to make, and where (`_redirects` in the Worker, or zone rules) | the five slash rules, the category/tag/author rules and the sitemap names in `_redirects`; the `?p=` rule at the zone |
| D-06 | **The route's fail mode** at the 100,000-request limit | **Decided (PM, 2026-10-13): the public production route fails OPEN to the old origin (WordPress, behind the same hostname); the admin host's route fails CLOSED.** Treat the limit as an incident either way |
| D-07 | **Analytics** to replace WordPress's, and whether it needs a consent notice | a cookie-free option, decided before the window |
| D-08 | **How long WordPress is kept** | 90 days, backups 12 months |
| D-09 | **The WAF probe rule** (F-09) | yes |
| D-10 | **The date and time of the window**, and who is reachable | a weekday morning WIB, outside a campaign |
| D-11 | **The real runs**: S-04 (about 700 GET requests to the live site) and the PageSpeed runs of [`seo-audit.md`](seo-audit.md) | approve once Dzul has read the dry-run plan |

## Sources

Cloudflare documentation read on 2026-10-13 (no account was used): Workers Custom Domains and Routes (`developers.cloudflare.com/workers/configuration/routing/custom-domains/`, `.../routes/`, Workers best practices); the Workers platform limits and errors (`.../workers/platform/limits/`, `.../workers/observability/errors/`, `.../metrics-and-analytics/`, Workers Logs); the Cache API (`.../workers/runtime-apis/cache/`, `.../workers/reference/how-the-cache-works/`); static assets redirects and headers (`.../workers/static-assets/redirects/`, `.../headers/`); DNS full setup, update nameservers, DNSSEC, the DNS FAQ (`.../dns/zone-setups/full-setup/setup/`, `.../dns/nameservers/update-nameservers/`, `.../dns/dnssec/`, `.../dns/faq/`); SSL/TLS modes, Always Use HTTPS and the redirect-loop troubleshooting page (`.../ssl/...`); Rules: Single and Bulk Redirects, their limits and execution order (`.../rules/url-forwarding/`); WAF custom rules limits (`.../waf/custom-rules/`); the D1 free-tier enforcement notice of 2026-09-01 (changelog). Repository documents: [`web-skeleton.md`](web-skeleton.md), [`portal-architecture.md`](portal-architecture.md), [`public-api.md`](public-api.md), [`content-api.md`](content-api.md), [`account-setup.md`](account-setup.md), [`uploads.md`](uploads.md), [`admin-blog.md`](admin-blog.md), [`admin-konten.md`](admin-konten.md), [`first-super-admin.md`](first-super-admin.md).
