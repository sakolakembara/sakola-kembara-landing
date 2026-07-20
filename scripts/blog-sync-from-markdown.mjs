#!/usr/bin/env node
/**
 * Regenerate lib/blog-posts.json from content/blog/*.md (after manual markdown edits).
 * Syncs contentMarkdown → content (HTML) for each article.
 *
 * Also rewrites any remaining legacy sakolakembara.org WordPress URLs in the
 * markdown source (mutating the .md files in place) so internal links stay
 * working after the cutover. Unmapped patterns are reported but left alone.
 */

import fs from "fs";
import path from "path";
import {
  BLOG_MD_DIR,
  markdownToHtml,
  readMarkdownArticle,
  rewriteSakemUrlsInMarkdown,
  writeBlogJson,
  writeMarkdownFile,
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

  let rewrittenCount = 0;
  const unknownPatterns = new Map(); // pattern → list of slugs

  const articles = files.map((f) => {
    const filePath = path.join(BLOG_MD_DIR, f);
    const article = readMarkdownArticle(filePath);
    const { text: rewritten, unknown } = rewriteSakemUrlsInMarkdown(
      article.contentMarkdown
    );

    if (rewritten !== article.contentMarkdown) {
      const next = {
        ...article,
        contentMarkdown: rewritten,
        content: markdownToHtml(rewritten),
      };
      writeMarkdownFile(next);
      rewrittenCount++;
      article.contentMarkdown = next.contentMarkdown;
      article.content = next.content;
    }

    for (const u of unknown) {
      if (!unknownPatterns.has(u)) unknownPatterns.set(u, []);
      unknownPatterns.get(u).push(article.id);
    }

    return article;
  });

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
  if (rewrittenCount > 0) {
    console.error(`  Rewrote sakolakembara.org URLs in ${rewrittenCount} markdown file(s)`);
  }
  if (unknownPatterns.size > 0) {
    console.error(
      `  WARNING: ${unknownPatterns.size} unmapped sakolakembara.org pattern(s) left in place:`
    );
    for (const [pattern, slugs] of unknownPatterns) {
      const sample = slugs.slice(0, 3).join(", ");
      const more = slugs.length > 3 ? `, +${slugs.length - 3} more` : "";
      console.error(`    ${pattern}`);
      console.error(`      in: ${sample}${more}`);
    }
    console.error(
      `  Extend mapSakemPath() in scripts/lib/blog-pipeline.mjs to handle them.`
    );
  }
}

main();
