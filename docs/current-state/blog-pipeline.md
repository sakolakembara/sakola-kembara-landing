# Blog Pipeline

The blog is **file-based, not CMS-backed (yet)**. Markdown files in `content/blog/` are the source of truth; `lib/blog-posts.json` is a generated cache that the Next pages read at build time.

## Three files to know

| File / dir | Role |
| --- | --- |
| `content/blog/<slug>.md` | One markdown file per post, with YAML frontmatter. **Source of truth for edits.** |
| `lib/blog-posts.json` | Generated index — array of `BlogArticle` objects. Read by `lib/blog.ts` at build time. |
| `public/blog/images/<wp-year>/<wp-month>/...` | Images mirrored from the WordPress install. Referenced as `/blog/images/...` paths in the markdown. |

## Reader API (`lib/blog.ts`)

```ts
export interface BlogArticle {
  id: string;            // URL slug — used in /blog/[id]
  wpId: number;
  category: string;
  date: string;          // Indonesian display date, e.g. "7 Desember 2025"
  dateISO: string;
  title: string;
  excerpt: string;
  contentMarkdown: string; // markdown source — preferred
  content: string;         // HTML fallback (generated from markdown)
  featured: boolean;
  image: string;
  author: string;
  sourceUrl: string;
  modifiedISO: string;
}

blogPosts                          // full BlogPostsData wrapper
blogArticles                       // = blogPosts.articles
getBlogArticleBySlug(slug)         // find by `id`
getBlogArticlesSorted()            // newest first by dateISO
cleanExcerpt(excerpt)              // strip [&hellip;] / trailing ellipsis
toNewsArticleShape(article)        // compat shape for legacy `newsArticles` consumers
```

`getBlogArticlesSorted()` powers both the `/blog` index (featured + grid) and `NewsSection` on the homepage (top 3).

## Renderer (`components/blog/BlogPostContent.tsx`)

Used by `app/blog/[id]/page.tsx`. Prefers `markdown` over `html`:

- If `markdown` is non-empty → `<ReactMarkdown remarkPlugins={[remarkGfm]}>` with custom `img`/`a` components.
- Local images (`/blog/images/...`) render via `next/image` with `unoptimized`.
- Remote images fall back to a plain `<img loading="lazy">`.
- Anchor links open in a new tab if `href` starts with `http`.
- Otherwise falls back to dangerously rendering pre-generated `html`.

Styling is provided by `.blog-content` rules in `app/globals.css` (h2/h3 sizes, paragraph spacing, blockquote with yellow left border, table, code, etc.).

## Pipeline scripts

Defined in `scripts/lib/blog-pipeline.mjs` and the two CLIs:

### `npm run scrape:blog` — initial / refresh from WordPress

`scripts/scrape-blog.mjs`. Pulls everything from `https://sakolakembara.org/wp-json/wp/v2`:

1. Fetch all posts (paginated) + categories + media.
2. Download each image referenced by `wp-content/uploads/...` into `public/blog/images/...` (preserving WP path).
3. Convert post HTML → markdown via `turndown` + `turndown-plugin-gfm`.
4. Rewrite image URLs from `https://sakolakembara.org/wp-content/uploads/...` → `/blog/images/...`.
5. Write `content/blog/<slug>.md` with YAML frontmatter (id, wpId, title, category, date, dateISO, excerpt, image, author, sourceUrl, modifiedISO).
6. Re-derive HTML from markdown via `marked` and write the consolidated `lib/blog-posts.json`.

Category IDs are mapped to Indonesian names via `CATEGORY_MAP` (Career, Cerita, Education, Kiat kiat, News, Testimonials, Tips, Uncategorized).

### `npm run blog:sync` — re-sync after editing markdown

`scripts/blog-sync-from-markdown.mjs`. Doesn't touch WordPress:

1. Read every `.md` in `content/blog/` (skipping `README.md`).
2. Parse frontmatter via `gray-matter`.
3. Convert `contentMarkdown` → HTML via `marked`.
4. Sort newest first by `dateISO`.
5. If no post is marked `featured: true`, the newest post is promoted to featured.
6. Write `lib/blog-posts.json`.

Run this after every manual edit to a `.md` file — without it, the JSON cache (and therefore the published pages) won't reflect your change.

## Slugs

Slugs are the markdown filename without `.md` (e.g. `content/blog/sejarah-sakola-kembara.md` → `id: "sejarah-sakola-kembara"`). They're also stored in the frontmatter `id` field for redundancy.

Slugs are auto-derived from the WordPress slug on scrape; on manual creation, set the filename to your desired slug.

> **MVP item #6** ("Blog with automatic slug generation") is already satisfied at the file level. The dashboard, when it ships, should generate slugs from the title and write the file accordingly.

## Editing a post

1. Open `content/blog/<slug>.md`.
2. Update frontmatter (`title`, `date`, `image`, `featured`, etc.) and/or the body.
3. Run `npm run blog:sync`.
4. Verify with `npm run dev` and commit both the `.md` change and the updated `lib/blog-posts.json`.

## Adding a new post

Same as editing, but create a fresh `content/blog/<new-slug>.md`. Required frontmatter at minimum:

```yaml
---
id: new-slug
wpId: 0
title: 'Judul Artikel'
category: News
date: 15 Januari 2026
dateISO: '2026-01-15'
excerpt: >-
  Ringkasan artikel...
featured: false
image: /blog/images/2026/01/cover.jpg
author: Sakola Kembara
sourceUrl: ''
modifiedISO: '2026-01-15'
---
```

Place any new images under `public/blog/images/...` and reference them with absolute paths.

## What this enables, and what it doesn't

- ✅ Static generation: `app/blog/[id]/page.tsx` uses `generateStaticParams()` over `blogArticles`, so every post is pre-rendered at build time.
- ✅ Related-posts logic: same-category-or-within-6-months heuristic in `app/blog/[id]/page.tsx`.
- ✅ Per-post Open Graph image: `generateMetadata` reads `article.image`.
- ❌ No draft state — every file in `content/blog/` is published.
- ❌ No admin UI — edits require a git commit. The dashboard MVP will change this.
- ❌ No search or category filter on `/blog` — to be added when the post count makes it useful.
