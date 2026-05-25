#!/usr/bin/env node
/**
 * Regenerate lib/blog-posts.json from content/blog/*.md (after manual markdown edits).
 * Syncs contentMarkdown → content (HTML) for each article.
 */

import fs from "fs";
import path from "path";
import {
  BLOG_MD_DIR,
  readMarkdownArticle,
  writeBlogJson,
} from "./lib/blog-pipeline.mjs";

function main() {
  if (!fs.existsSync(BLOG_MD_DIR)) {
    console.error(`Missing ${BLOG_MD_DIR}. Run pnpm scrape:blog first.`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(BLOG_MD_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();

  const articles = files.map((f) => readMarkdownArticle(path.join(BLOG_MD_DIR, f)));
  articles.sort(
    (a, b) => new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime()
  );

  if (articles.length > 0 && !articles.some((a) => a.featured)) {
    articles[0].featured = true;
  }

  writeBlogJson(articles, {
    syncedFrom: "content/blog",
    api: null,
  });

  console.error(`Synced ${articles.length} articles from markdown → lib/blog-posts.json`);
}

main();
