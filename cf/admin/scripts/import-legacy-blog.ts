// Imports the articles of the legacy blog (content/blog/*.md at the repo root: the 80 migrated and the 6 imported on
// 2026-10-13) into the new admin's D1
// (docs/cloudflare/admin-blog.md#import-of-the-80-migrated-articles).
//
//   pnpm blog:import:local                 apply to the LOCAL D1 (the one `wrangler dev` and the tests use)
//   pnpm blog:import:local -- --out FILE   only write the SQL, apply nothing
//
// What it writes, per article, as one idempotent upsert by slug:
//
//   - the meta description of the WordPress page (front matter `description`, SAKEM-090) when the file has one;
//   - the markdown as it is (`content.trim()`), and the HTML rendered with the SAME function the admin uses on a
//     save (src/blog/render.ts), with the size, `srcset` and `@`-safe URL of every inline image taken from the
//     public site's image manifest, so the 80 articles render as the build rendered them (a test compares them
//     byte for byte, and every API answer with cf/web's fixture API);
//   - published, dated at 00:00 in Jakarta on `dateISO`; last edited on `modifiedISO`; featured as in the file;
//   - the cover path as it was, with its size from the manifest; the WordPress id and source URL (internal).
//
// Rows are inserted oldest first and, within one day, by slug descending: the public list orders by publication
// time and then by row order, newest row first, so that is what reproduces the build's order for articles
// of the same day (slug ascending).
//
// Idempotent and safe to run again: a row is updated only while it still has the imported WordPress id and has not
// been edited in the admin (`updated_by` is empty). An article an editor changed is never overwritten.
//
// LOCAL ONLY. This script never talks to Cloudflare: it refuses `--remote`, and the only place it applies the SQL
// is `wrangler d1 execute sakem-admin --local`. To import into a deployed database, with the owner's explicit
// approval, see "Running the import against staging or production" in the doc: write the SQL with `--out` and
// apply that file.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import matter from "gray-matter";
import type { ImageLookup } from "../src/blog/images";
import { renderArticle } from "../src/blog/render";
import { isIsoDay, startOfIsoDayJakarta } from "../src/blog/rules";
import { blogCategories } from "../src/db/schema/blog";
import { longDateJakarta } from "../src/public/dates";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, "..");
const repoRoot = path.resolve(adminRoot, "../..");
const webRoot = path.join(repoRoot, "cf/web");

export const DEFAULT_CONTENT_DIR = path.join(repoRoot, "content/blog");
export const DEFAULT_MANIFEST = path.join(webRoot, "src/generated/image-manifest.json");

/** D1 refuses a statement above 100 KB; the longest article is far below this. */
const MAX_STATEMENT_CHARS = 95_000;
/** The `database_name` of wrangler.jsonc. */
const DATABASE = "sakem-admin";

export interface LegacyArticle {
  slug: string;
  title: string;
  excerpt: string;
  /** The meta description of the WordPress page (front matter `description`), or null when the file has none. */
  description: string | null;
  markdown: string;
  html: string;
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  category: string;
  author: string;
  featured: boolean;
  dateISO: string;
  modifiedISO: string;
  wpId: number | null;
  sourceUrl: string | null;
}

interface ManifestEntry {
  width: number;
  height: number;
  hash: string;
  variants: { width: number; height: number }[];
}

/** What the plugin of cf/web does with an image: its size, ladder and URL come from the manifest. */
async function manifestLookup(manifestFile: string): Promise<{ lookup: ImageLookup; entryOf: (src: string) => ManifestEntry | null }> {
  const { srcsetFor, assetUrl } = (await import(/* @vite-ignore */ pathToFileURL(path.join(webRoot, "assets.config.mjs")).href)) as {
    srcsetFor: (entry: ManifestEntry) => string;
    assetUrl: (path: string) => string;
  };
  const images = (JSON.parse(readFileSync(manifestFile, "utf8")) as { images: Record<string, ManifestEntry> }).images;
  const entryOf = (src: string): ManifestEntry | null => {
    if (!src.startsWith("/")) return null;
    const key = src.split(/[?#]/)[0]!;
    return Object.hasOwn(images, key) ? images[key]! : null;
  };
  const lookup: ImageLookup = (src) => {
    const entry = entryOf(src);
    return entry ? { width: entry.width, height: entry.height, srcset: srcsetFor(entry), src: assetUrl(src) } : null;
  };
  return { lookup, entryOf };
}

/** Reads and renders every article, sorted the way they are inserted (oldest first, slug descending within a day). */
export async function readLegacyArticles(options: { contentDir?: string; manifestFile?: string } = {}): Promise<LegacyArticle[]> {
  const contentDir = options.contentDir ?? DEFAULT_CONTENT_DIR;
  const manifestFile = options.manifestFile ?? DEFAULT_MANIFEST;
  const { lookup, entryOf } = await manifestLookup(manifestFile);

  const files = readdirSync(contentDir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort();
  const articles: LegacyArticle[] = files.map((file) => {
    const { data, content } = matter(readFileSync(path.join(contentDir, file), "utf8"));
    const slug = String(data.id ?? file.replace(/\.md$/, ""));
    const problem = (what: string) => new Error(`${file}: ${what}`);
    const dateISO = String(data.dateISO ?? "");
    if (!isIsoDay(dateISO)) throw problem(`dateISO "${dateISO}" is not a day`);
    const modifiedISO = String(data.modifiedISO ?? dateISO);
    if (!isIsoDay(modifiedISO)) throw problem(`modifiedISO "${modifiedISO}" is not a day`);
    // The site shows `date` derived from the instant; a file whose text says something else would change on the site.
    const derived = longDateJakarta(startOfIsoDayJakarta(dateISO).getTime());
    if (data.date !== undefined && data.date !== derived) throw problem(`date "${String(data.date)}" is not what dateISO gives ("${derived}")`);
    const category = String(data.category ?? "Uncategorized");
    if (!(blogCategories as readonly string[]).includes(category)) throw problem(`category "${category}" is not in the fixed list`);

    const markdown = content.trim();
    const image = typeof data.image === "string" && data.image !== "" ? data.image : null;
    const entry = image ? entryOf(image) : null;
    const wpId = typeof data.wpId === "number" && data.wpId > 0 ? data.wpId : null;
    return {
      slug,
      title: String(data.title ?? "(untitled)"),
      excerpt: String(data.excerpt ?? ""),
      description: typeof data.description === "string" && data.description.trim() !== "" ? data.description.trim() : null,
      markdown,
      html: renderArticle(markdown, { images: lookup }).html,
      image,
      imageWidth: entry?.width ?? null,
      imageHeight: entry?.height ?? null,
      category,
      author: String(data.author ?? "Sakola Kembara"),
      featured: Boolean(data.featured),
      dateISO,
      modifiedISO,
      wpId,
      sourceUrl: typeof data.sourceUrl === "string" && data.sourceUrl !== "" ? data.sourceUrl : null,
    };
  });
  return articles.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0));
}

/** A marker that is not in `value`, to stand for a character that cannot be written inside a one-line literal. */
function freeMarker(value: string, label: string): string {
  for (let n = 0; ; n++) {
    const marker = `~${label}${n.toString(16)}~`;
    if (!value.includes(marker)) return marker;
  }
}

/**
 * A text literal on ONE physical line: `D1Database.exec` and the importers treat each line as a statement, so a
 * newline inside a string cannot be written as it is. It is written as a marker that `replace()` turns into
 * `char(10)` (a carriage return the same way). Not `'a'||char(10)||'b'`: D1 refuses an expression tree deeper than
 * 100, and a long article has hundreds of lines. Quotes are doubled; nothing else needs escaping in SQLite.
 */
export function sqlText(value: string): string {
  let text = value;
  const wrap: string[] = [];
  if (text.includes("\r")) {
    const marker = freeMarker(value, "cr");
    text = text.replaceAll("\r", marker);
    wrap.push(`, '${marker}', char(13))`);
  }
  if (text.includes("\n")) {
    const marker = freeMarker(value, "nl");
    text = text.replaceAll("\n", marker);
    wrap.push(`, '${marker}', char(10))`);
  }
  let literal = `'${text.replaceAll("'", "''")}'`;
  // The newline marker is replaced last, after the carriage return's.
  for (const closing of wrap.reverse()) literal = `replace(${literal}${closing}`;
  return literal;
}

const sqlNullableText = (value: string | null) => (value === null ? "NULL" : sqlText(value));
const sqlNullableInt = (value: number | null) => (value === null ? "NULL" : String(Math.trunc(value)));

/** One upsert per article, in insertion order. Each is a single line ending with `;`. */
export function importStatements(articles: readonly LegacyArticle[], newId: () => string = () => crypto.randomUUID()): string[] {
  return articles.map((article) => {
    const publishedAt = startOfIsoDayJakarta(article.dateISO).getTime();
    const updatedAt = startOfIsoDayJakarta(article.modifiedISO).getTime();
    const columns = ["id", "slug", "title", "excerpt", "meta_description", "content_markdown", "content_html", "image", "image_width", "image_height", "category", "author", "featured", "status", "published_at", "wp_id", "source_url", "created_at", "updated_at"];
    const values = [
      sqlText(newId()),
      sqlText(article.slug),
      sqlText(article.title),
      sqlText(article.excerpt),
      sqlNullableText(article.description),
      sqlText(article.markdown),
      sqlText(article.html),
      sqlNullableText(article.image),
      sqlNullableInt(article.imageWidth),
      sqlNullableInt(article.imageHeight),
      sqlText(article.category),
      sqlText(article.author),
      article.featured ? "1" : "0",
      "'published'",
      String(publishedAt),
      sqlNullableInt(article.wpId),
      sqlNullableText(article.sourceUrl),
      String(publishedAt),
      String(updatedAt),
    ];
    // The id, the WordPress id and the creation time are never rewritten; an edited row (`updated_by` set) is left alone.
    const updates = columns.filter((column) => !["id", "slug", "wp_id", "created_at"].includes(column)).map((column) => `${column} = excluded.${column}`);
    const statement = `INSERT INTO blog_posts (${columns.join(", ")}) VALUES (${values.join(", ")}) ON CONFLICT(slug) DO UPDATE SET ${updates.join(", ")} WHERE blog_posts.updated_by IS NULL AND blog_posts.wp_id IS excluded.wp_id;`;
    if (statement.length > MAX_STATEMENT_CHARS) throw new Error(`${article.slug}: the statement is ${statement.length} characters, above the ${MAX_STATEMENT_CHARS} D1 allows per statement`);
    return statement;
  });
}

export function importSql(articles: readonly LegacyArticle[], newId?: () => string): string {
  return `${importStatements(articles, newId).join("\n")}\n`;
}

// ------------------------------------------------------------------------------------------------ the command line

function usage(): string {
  return [
    "Import the legacy blog (content/blog) into the LOCAL D1 of cf/admin.",
    "",
    "  pnpm blog:import:local                  apply to the local database (run `pnpm db:migrate:local` first)",
    "  pnpm blog:import:local -- --out FILE    write the SQL to FILE and apply nothing",
    "",
    "Never touches Cloudflare. Importing into a deployed database needs the owner's approval: docs/cloudflare/admin-blog.md.",
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }
  if (argv.some((arg) => arg === "--remote" || arg.startsWith("--remote=") || arg === "--preview")) {
    console.error("import-legacy-blog: this script only imports into the LOCAL database. To import into a deployed one, write the SQL with --out and apply it with the owner's approval (docs/cloudflare/admin-blog.md).");
    return 2;
  }
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  if (outIndex >= 0 && !out) {
    console.error("import-legacy-blog: --out needs a file name");
    return 2;
  }

  const articles = await readLegacyArticles();
  const sql = importSql(articles);
  console.log(`import-legacy-blog: ${articles.length} articles, ${sql.length} characters of SQL, ${articles.filter((a) => a.imageWidth !== null).length} covers with a size`);

  if (out) {
    writeFileSync(out, sql);
    console.log(`written to ${out}; nothing was applied.`);
    return 0;
  }

  const stateDir = path.join(adminRoot, ".wrangler");
  mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, "import-legacy-blog.sql");
  writeFileSync(file, sql);
  // `--local` is spelled out: without it wrangler would reach for the account.
  const run = spawnSync("pnpm", ["exec", "wrangler", "d1", "execute", DATABASE, "--local", "--file", file], {
    cwd: adminRoot,
    stdio: "inherit",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
  });
  if (run.status !== 0) {
    console.error("import-legacy-blog: wrangler failed. Has the local database been migrated? Run `pnpm db:migrate:local` first.");
    return run.status ?? 1;
  }
  console.log("import-legacy-blog: done. Running it again changes nothing.");
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exit(await main(process.argv.slice(2)));
}
