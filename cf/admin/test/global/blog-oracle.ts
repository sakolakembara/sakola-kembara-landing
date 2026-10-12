import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TestProject } from "vitest/node";
import { importSql, readLegacyArticles } from "../../scripts/import-legacy-blog";

// The ORACLE of the blog tests, computed in Node before the Worker tests run (workerd has no file system and
// cannot import cf/web's build plugin, so the comparison data is made here and handed to the tests with
// `inject("blogOracle")`).
//
// Everything in it is produced by the public site's own code, not by the Worker's:
//
//   - the 80 migrated articles read and rendered by `createBlogReader` of cf/web/plugins/blog-content.mjs, the
//     pipeline that rendered the pages at build time, with the image manifest of the asset pipeline;
//   - the answers of cf/web's FIXTURE API (scripts/fixture-api.mjs: the contract's rules, `blog-contract.mjs`) to
//     every request the tests ask the Worker's public API: the list at two page sizes and one article payload
//     (with `related`) per slug;
//   - the manifest's `srcset` of every legacy blog image, to prove the Worker's table of them equal.
//
// It needs cf/web installed (`pnpm install --frozen-lockfile` in cf/web) and fails loudly, with that sentence,
// when it is not: a skipped oracle would be a proof that silently never ran.

const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(adminRoot, "../..");
const webRoot = path.join(repoRoot, "cf/web");
const contentDir = path.join(repoRoot, "content/blog");
const manifestFile = path.join(webRoot, "src/generated/image-manifest.json");

/** Node's own `import()`, not Vite's: these files and their packages live in cf/web, outside this project's root. */
const nativeImport = <T = Record<string, any>>(file: string): Promise<T> => import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>;

export interface OracleArticle {
  slug: string;
  /** `content.trim()` of the file: what the legacy reader called `contentMarkdown`. */
  markdown: string;
  /** What the build plugin rendered. */
  html: string;
  /** The plugin's metadata: `id`, `wpId`, `category`, `date`, `dateISO`, `title`, `excerpt`, `featured`, `image`, `imageWidth`, `imageHeight`, `author`, `sourceUrl`, `modifiedISO`. */
  meta: Record<string, unknown>;
}

export interface BlogOracle {
  /** Newest first, as the plugin sorts them. */
  articles: OracleArticle[];
  /** The fixture API's `GET /api/public/blog?page=&pageSize=` bodies, keyed `"<pageSize>:<page>"`. */
  lists: Record<string, unknown>;
  /** The fixture API's `GET /api/public/blog/<slug>` bodies. */
  payloads: Record<string, unknown>;
  /** `srcsetFor(entry)` of the manifest for every legacy blog image, and its `[width, height, hash]`. */
  legacyImages: Record<string, { srcset: string; entry: [number, number, string] }>;
  /** The SQL file `scripts/import-legacy-blog.ts` writes (one statement per line): the tests run it against the test D1. */
  importSql: string;
}

declare module "vitest" {
  interface ProvidedContext {
    blogOracle: BlogOracle;
  }
}

function ensureWebReady(): void {
  if (!existsSync(path.join(webRoot, "node_modules"))) {
    throw new Error("blog oracle: cf/web has no node_modules. Run `pnpm install --frozen-lockfile` in cf/web, then run the tests again.");
  }
  if (existsSync(manifestFile)) return;
  // Cheap: reads the images' headers and writes the manifest only (no derivative).
  for (const args of [["scripts/sync-assets.mjs"], ["scripts/build-assets.mjs", "--manifest-only"]]) {
    const run = spawnSync(process.execPath, args, { cwd: webRoot, stdio: "inherit" });
    if (run.status !== 0) throw new Error(`blog oracle: \`node ${args.join(" ")}\` failed in cf/web`);
  }
}

/**
 * A run that names test files, none of them a blog one (the negative checks of another area do this), does not need
 * the oracle: skipping it saves its few seconds on every one of those runs. A run that names nothing, or a blog file,
 * builds it, and a blog test that finds no oracle says so by failing.
 */
function neededByThisRun(): boolean {
  const named = process.argv.slice(2).filter((arg) => /\.test\.tsx?$|^test\//.test(arg));
  return named.length === 0 || named.some((arg) => /blog/.test(arg));
}

export default async function setup(project: TestProject): Promise<void> {
  if (!neededByThisRun()) return;
  ensureWebReady();

  const { createBlogReader } = await nativeImport(path.join(webRoot, "plugins/blog-content.mjs"));
  const reader = createBlogReader({ contentDir, manifestFile });
  const read: { meta: Record<string, unknown>; html: string; markdown: string }[] = await reader.readAll();
  const articles: OracleArticle[] = read.map((article) => ({ slug: String(article.meta.id), markdown: article.markdown, html: article.html, meta: article.meta }));

  // The fixture API (the contract's rules over the same articles), on a free port, asked for every answer the tests compare.
  const { startFixtureApi } = await nativeImport(path.join(webRoot, "scripts/fixture-api.mjs"));
  const fixture = await startFixtureApi({ port: 0 });
  const base = `http://127.0.0.1:${(fixture.server.address() as AddressInfo).port}`;
  const lists: Record<string, unknown> = {};
  const payloads: Record<string, unknown> = {};
  try {
    for (const pageSize of [15, 50]) {
      const first = (await (await fetch(`${base}/api/public/blog?page=1&pageSize=${pageSize}`)).json()) as { totalPages: number };
      lists[`${pageSize}:1`] = first;
      for (let page = 2; page <= first.totalPages; page++) lists[`${pageSize}:${page}`] = await (await fetch(`${base}/api/public/blog?page=${page}&pageSize=${pageSize}`)).json();
    }
    for (const article of articles) {
      const response = await fetch(`${base}/api/public/blog/${encodeURIComponent(article.slug)}`);
      if (response.status !== 200) throw new Error(`blog oracle: the fixture API answered ${response.status} for ${article.slug}`);
      payloads[article.slug] = await response.json();
    }
  } finally {
    fixture.server.closeAllConnections?.();
    await fixture.close();
  }

  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as { images: Record<string, { width: number; height: number; hash: string; variants: { width: number; height: number }[] }> };
  const { srcsetFor } = await nativeImport(path.join(webRoot, "assets.config.mjs"));
  const legacyImages: BlogOracle["legacyImages"] = {};
  for (const [urlPath, entry] of Object.entries(manifest.images)) {
    if (urlPath.startsWith("/blog/images/")) legacyImages[urlPath] = { srcset: srcsetFor(entry), entry: [entry.width, entry.height, entry.hash] };
  }

  // What the import script would apply, from the same files and manifest.
  const importFile = importSql(await readLegacyArticles({ contentDir, manifestFile }));

  project.provide("blogOracle", { articles, lists, payloads, legacyImages, importSql: importFile });
}
