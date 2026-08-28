# Shortlinks

Admin-managed vanity redirects served straight off the site root:

```
https://sakolakembara.org/<slug>  →  any target URL
```

Built for links that get printed, read aloud, or pasted into an Instagram bio —
where `sakolakembara.org/daftar-2026` beats a 90-character Google Forms URL,
and where the destination needs to change without reprinting anything.

## Pieces

| Concern | File |
| --- | --- |
| Table | `lib/db/schema/shortlinks.ts` (migration `drizzle/0012_harsh_stone_men.sql`) |
| Validation + queries | `lib/shortlinks.ts` |
| Public redirect | `app/(public)/[slug]/page.tsx` |
| Admin list | `app/(admin)/admin/shortlinks/page.tsx` |
| Admin create/edit | `app/(admin)/admin/shortlinks/{new,[id]/edit}/page.tsx` + `_editor-form.tsx` |
| Server actions | `app/(admin)/admin/shortlinks/actions.ts` |

## Route precedence — the thing to understand

The resolver is a **root-level dynamic segment**, `app/(public)/[slug]`. Next.js
matches static routes and `public/` files *before* dynamic ones, so
`/donasi`, `/tim`, `/robots.txt` and `/images/hero-team.png` never reach it.
That is what makes the feature safe to add at the root at all.

The same precedence is also the trap: a shortlink saved as `donasi` would look
completely fine in the admin list and **never once fire**, because the real page
wins every time. Nothing in Next reports this — it is silent.

So `RESERVED_SLUGS` in `lib/shortlinks.ts` rejects those slugs at write time.
**When you add a top-level route or a `public/` directory, add it to that set**,
or the next admin to claim the name gets a dead link. `__tests__/shortlinks.test.ts`
asserts the current top-level routes are present, which catches a careless trim
of the list but cannot know about a route you add tomorrow.

The resolver runs the slug through `validateSlug` *before* querying Postgres, so
the DB is not touched for the malformed paths that make up most 404 traffic.

## Behavior

- **Redirects are 307, not 308.** A slug can be repointed at any time; a
  permanent redirect would be cached by browsers long past that edit.
- **Inactive links 404** rather than reporting themselves as disabled — a
  retired campaign link should not confirm it ever existed. The slug stays
  reserved, so it cannot be silently reused for something unrelated.
- **Clicks are counted** on the way through (`click_count`, `last_clicked_at`).
  The write is best-effort and swallows its own errors: a redirect must not
  fail because a counter could not be incremented. It is a popularity signal,
  not analytics — there is no per-click row, no referrer, no dedupe.

## Validation

`validateSlug` — lowercase letters, digits, single inner hyphens, ≤64 chars,
not reserved. Input is trimmed, lowercased, and stripped of surrounding
slashes, so pasting `/Daftar-2026/` works.

`validateTarget` — an absolute `http(s)` URL or a site-internal path starting
with `/`. This rejects `javascript:` and `data:` targets, and rejects
protocol-relative `//evil.com`, which would otherwise read as a local path
while resolving off-site. A target pointing at its own shortlink (either
`/slug` or the canonical domain plus `/slug`) is rejected as a redirect loop.

Uniqueness is checked in the action *and* enforced by a unique index, because
two admins can pass the check concurrently and only one insert may survive; the
action maps SQLSTATE `23505` back to a field error rather than a 500.

## Notes for later

- Everything is admin-gated by `requireAdmin()` in the page and in every
  action, on top of the `/admin/:path*` matcher in `proxy.ts`. The open-redirect
  surface is therefore limited to people who can already edit the site.
- Every mutation writes an audit row (`shortlink.create` / `.update` /
  `.delete`); a slug rename records `previousSlug` in the metadata.
- There is no bulk import and no QR generation. Both are easy to add on top of
  this table if the team asks.
