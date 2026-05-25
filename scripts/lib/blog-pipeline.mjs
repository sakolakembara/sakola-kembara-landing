import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { marked } from "marked";
import matter from "gray-matter";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BLOG_JSON = path.join(ROOT, "lib/blog-posts.json");
export const BLOG_MD_DIR = path.join(ROOT, "content/blog");
export const BLOG_IMAGES_DIR = path.join(ROOT, "public/blog/images");

const SAKEM_HOSTS = ["sakolakembara.org", "www.sakolakembara.org"];

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.use(gfm);
turndown.addRule("removeEmptyParagraph", {
  filter: (node) =>
    node.nodeName === "P" && !node.textContent?.trim() && !node.querySelector?.("img"),
  replacement: () => "",
});

marked.setOptions({ gfm: true, breaks: false });

export function htmlToMarkdown(html) {
  return turndown.turndown(html || "").trim();
}

export function markdownToHtml(markdown) {
  return marked.parse(markdown || "");
}

export function normalizeRemoteUrl(url) {
  if (!url || url.startsWith("data:") || url.startsWith("/")) return url;
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    if (SAKEM_HOSTS.includes(u.hostname)) {
      u.protocol = "https:";
      return u.href;
    }
  } catch {
    return url;
  }
  return url;
}

/** wp-content/uploads/... → public path /blog/images/... */
export function remoteUrlToLocalPath(url) {
  const normalized = normalizeRemoteUrl(url);
  if (!normalized) return null;
  try {
    const u = new URL(normalized);
    if (!SAKEM_HOSTS.includes(u.hostname)) return null;
    const match = u.pathname.match(/\/wp-content\/uploads\/(.+)/i);
    if (!match) return null;
    return `/blog/images/${match[1]}`;
  } catch {
    return null;
  }
}

export function extractImageUrls(text) {
  const urls = new Set();
  if (!text) return urls;

  const patterns = [
    /src=["']([^"']+)["']/gi,
    /srcset=["']([^"']+)["']/gi,
    /!\[[^\]]*]\(([^)]+)\)/g,
    /!\[[^\]]*]\[[^\]]*]\(([^)]+)\)/g,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const raw = m[1];
      if (raw.includes(",")) {
        raw.split(",").forEach((part) => {
          const u = part.trim().split(/\s+/)[0];
          if (u) urls.add(u);
        });
      } else {
        urls.add(raw.trim());
      }
    }
  }

  return [...urls]
    .map(normalizeRemoteUrl)
    .filter((u) => remoteUrlToLocalPath(u));
}

export function collectUrlVariants(url) {
  const normalized = normalizeRemoteUrl(url);
  if (!normalized || normalized.startsWith("/blog/")) return [];

  const variants = new Set([url, normalized]);
  try {
    const u = new URL(normalized);
    if (!SAKEM_HOSTS.includes(u.hostname)) return [];
    variants.add(u.href);
    variants.add(u.href.replace("https://", "http://"));
    variants.add(`//${u.host}${u.pathname}`);
  } catch {
    /* ignore */
  }
  return [...variants].filter(Boolean);
}

export function replaceUrlsInText(text, urlMapOrEntries) {
  let out = text;
  const entries = (
    urlMapOrEntries instanceof Map
      ? [...urlMapOrEntries.entries()]
      : urlMapOrEntries
  ).sort((a, b) => b[0].length - a[0].length);

  for (const [remote, local] of entries) {
    for (const variant of collectUrlVariants(remote)) {
      if (!variant || variant.length < 12 || out.includes(local)) continue;
      out = out.split(variant).join(local);
      out = out.split(variant.replace(/&/g, "&amp;")).join(local);
    }
  }
  return out;
}

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) return false;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const res = await fetch(normalizeRemoteUrl(url), {
    headers: { "User-Agent": "SakolaKembara-BlogImporter/1.0" },
  });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return true;
}

export async function buildImageMap(articles, { concurrency = 6 } = {}) {
  const allUrls = new Set();
  for (const article of articles) {
    if (article.image) {
      const img = normalizeRemoteUrl(article.image);
      if (remoteUrlToLocalPath(img)) allUrls.add(img);
      extractImageUrls(article.image).forEach((u) => allUrls.add(u));
    }
    if (article.content) extractImageUrls(article.content).forEach((u) => allUrls.add(u));
    if (article.contentMarkdown) {
      extractImageUrls(article.contentMarkdown).forEach((u) => allUrls.add(u));
    }
  }

  const urlMap = new Map();
  const queue = [...allUrls];
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      const localPath = remoteUrlToLocalPath(url);
      if (!localPath) continue;
      const dest = path.join(ROOT, "public", localPath);
      try {
        const isNew = await downloadFile(url, dest);
        urlMap.set(url, localPath);
        if (isNew) downloaded++;
        else skipped++;
      } catch (err) {
        failed++;
        console.error(`  ✗ ${url}: ${err.message}`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return { urlMap, downloaded, skipped, failed, total: allUrls.size };
}

export function applyImageMapToArticle(article, urlMap) {
  const mapEntries = [...urlMap.entries()];

  let image = article.image || "";
  if (image) {
    image = replaceUrlsInText(image, mapEntries);
    const local = remoteUrlToLocalPath(normalizeRemoteUrl(article.image));
    if (local) image = local;
  }

  let content = replaceUrlsInText(article.content || "", mapEntries);
  let contentMarkdown = article.contentMarkdown
    ? replaceUrlsInText(article.contentMarkdown, mapEntries)
    : htmlToMarkdown(content);

  const contentHtml = markdownToHtml(contentMarkdown);

  return {
    ...article,
    image,
    content: contentHtml,
    contentMarkdown,
  };
}

export function writeMarkdownFile(article) {
  fs.mkdirSync(BLOG_MD_DIR, { recursive: true });
  const {
    contentMarkdown,
    content,
    ...meta
  } = article;

  const frontmatter = {
    id: meta.id,
    wpId: meta.wpId,
    title: meta.title,
    category: meta.category,
    date: meta.date,
    dateISO: meta.dateISO,
    excerpt: meta.excerpt,
    featured: meta.featured,
    image: meta.image,
    author: meta.author,
    sourceUrl: meta.sourceUrl,
    modifiedISO: meta.modifiedISO,
  };

  const body = contentMarkdown || htmlToMarkdown(content || "");
  const file = matter.stringify(body, frontmatter);
  const mdPath = path.join(BLOG_MD_DIR, `${meta.id}.md`);
  fs.writeFileSync(mdPath, file, "utf8");
}

export function readMarkdownArticle(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content: body } = matter(raw);
  const contentMarkdown = body.trim();
  const content = markdownToHtml(contentMarkdown);

  return {
    id: data.id,
    wpId: data.wpId,
    title: data.title,
    category: data.category,
    date: data.date,
    dateISO: data.dateISO,
    excerpt: data.excerpt,
    featured: Boolean(data.featured),
    image: data.image || "",
    author: data.author || "Sakola Kembara",
    sourceUrl: data.sourceUrl || "",
    modifiedISO: data.modifiedISO || data.dateISO,
    contentMarkdown,
    content,
  };
}

export function writeBlogJson(articles, metaExtra = {}) {
  const output = {
    meta: {
      source: "https://sakolakembara.org/blog/",
      scrapedAt: new Date().toISOString(),
      total: articles.length,
      contentFormat: "markdown",
      ...metaExtra,
    },
    articles,
  };
  fs.writeFileSync(BLOG_JSON, JSON.stringify(output, null, 2) + "\n", "utf8");
}
