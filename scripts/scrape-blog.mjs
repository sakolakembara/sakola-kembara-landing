#!/usr/bin/env node
/**
 * Scrape blog from WordPress API → download images → markdown + JSON + content/blog/*.md
 */

import fs from "fs";
import path from "path";
import {
  BLOG_IMAGES_DIR,
  BLOG_MD_DIR,
  htmlToMarkdown,
  buildImageMap,
  applyImageMapToArticle,
  writeMarkdownFile,
  writeBlogJson,
} from "./lib/blog-pipeline.mjs";

const API_BASE = "https://sakolakembara.org/wp-json/wp/v2";

const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const CATEGORY_MAP = {
  4: "Career",
  39: "Cerita",
  27: "Education",
  40: "Kiat kiat",
  9: "News",
  5: "Testimonials",
  38: "Tips",
  1: "Uncategorized",
};

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateId(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { data: await res.json(), headers: res.headers };
}

async function fetchAllPosts() {
  const all = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${API_BASE}/posts?per_page=100&page=${page}&_embed`;
    const { data, headers } = await fetchJson(url);
    totalPages = Number(headers.get("x-wp-totalpages") || 1);
    all.push(...data);
    console.error(`Fetched page ${page}/${totalPages} (${data.length} posts)`);
    page++;
  }

  return all;
}

function transformPost(post, index) {
  const categoryId = post.categories?.[0];
  const category = CATEGORY_MAP[categoryId] ?? "Uncategorized";
  const featuredMedia = post._embedded?.["wp:featuredmedia"]?.[0];
  const author = post._embedded?.author?.[0]?.name ?? "Sakola Kembara";
  const image =
    featuredMedia?.source_url ??
    featuredMedia?.media_details?.sizes?.medium?.source_url ??
    "";

  const contentHtml = post.content.rendered;
  const contentMarkdown = htmlToMarkdown(contentHtml);

  return {
    id: post.slug,
    wpId: post.id,
    category,
    date: formatDateId(post.date),
    dateISO: post.date.split("T")[0],
    title: stripHtml(post.title.rendered),
    excerpt: stripHtml(post.excerpt.rendered),
    content: contentHtml,
    contentMarkdown,
    featured: index === 0,
    image,
    author,
    sourceUrl: post.link,
    modifiedISO: post.modified.split("T")[0],
  };
}

async function main() {
  console.error("1/4 Fetching posts from WordPress API...");
  const posts = await fetchAllPosts();
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));

  let articles = posts.map(transformPost);

  fs.mkdirSync(BLOG_IMAGES_DIR, { recursive: true });
  fs.mkdirSync(BLOG_MD_DIR, { recursive: true });

  console.error("2/4 Downloading blog images...");
  const { urlMap, downloaded, skipped, failed, total } = await buildImageMap(articles);
  console.error(
    `  Images: ${total} unique URLs → ${downloaded} downloaded, ${skipped} cached, ${failed} failed`
  );

  console.error("3/4 Converting content → local paths + markdown...");
  articles = articles.map((a) => applyImageMapToArticle(a, urlMap));

  console.error("4/4 Writing content/blog/*.md and lib/blog-posts.json...");
  for (const article of articles) {
    writeMarkdownFile(article);
  }

  writeBlogJson(articles, {
    api: `${API_BASE}/posts`,
    imagesDir: "/blog/images",
  });

  console.error(`Done: ${articles.length} articles, ${urlMap.size} image mappings`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
