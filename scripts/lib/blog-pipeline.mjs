import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { marked } from "marked";
import matter from "gray-matter";
import { findGpsMetadata } from "./image-gps.mjs";
import { isJpeg, stripJpegMetadata } from "./strip-jpeg-metadata.mjs";

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

// ---------------------------------------------------------------------------
// WordPress → new-site URL rewriting
// ---------------------------------------------------------------------------
// Internal blog links inside content/blog/*.md still point at the legacy
// WordPress paths (/cerita/<slug>/, /education/<slug>/, etc.). After the
// cutover, sakolakembara.org resolves to this Next.js site, where those paths
// 404. Rewrite them at sync time so the markdown source is portable and the
// rendered HTML doesn't depend on legacy redirects.

const SAKEM_LINK_RE = /https?:\/\/(?:www\.)?sakolakembara\.org(?:\/[^\s)\]"'<>]*)?/gi;

const CATEGORY_PREFIX_RE =
  /^\/(?:cerita|education|news|tips|testimonials|career|kiat-kiat)\/([^/]+)\/?$/i;

/**
 * Map a WordPress-era pathname (without scheme/host) to its new-site route.
 * Returns null when the path is unknown — callers should leave the URL
 * untouched and surface the pattern so we can extend the mapping.
 */
export function mapSakemPath(pathname) {
  const p = pathname || "/";
  if (p === "" || p === "/") return "/";

  const m = p.match(CATEGORY_PREFIX_RE);
  if (m) return `/blog/${m[1]}`;

  if (/^\/donasi\/?$/i.test(p)) return "/donasi";
  if (/^\/(?:daftar|apply)\/?$/i.test(p)) return "/gabung-siswa";
  if (/^\/tentang-kami\/?$/i.test(p)) return "/tim";
  if (/^\/blog(?:\/[^?#]*)?$/i.test(p)) return p.replace(/\/$/, "");

  return null;
}

/**
 * Rewrite every sakolakembara.org URL in `text` to its new-site equivalent.
 * Preserves query strings and fragments. wp-content / wp-admin / wp-json paths
 * are left alone (the image pipeline owns those).
 *
 * Returns { text, unknown } so callers can log unmapped patterns instead of
 * silently dropping them.
 */
export function rewriteSakemUrlsInMarkdown(text) {
  if (!text) return { text: text ?? "", unknown: [] };

  const unknown = new Set();
  const rewritten = text.replace(SAKEM_LINK_RE, (full) => {
    let parsed;
    try {
      parsed = new URL(full);
    } catch {
      unknown.add(full);
      return full;
    }

    const p = parsed.pathname;
    if (
      p.startsWith("/wp-content/") ||
      p.startsWith("/wp-admin/") ||
      p.startsWith("/wp-json/")
    ) {
      return full;
    }

    const mapped = mapSakemPath(p);
    if (mapped === null) {
      unknown.add(full);
      return full;
    }
    return `${mapped}${parsed.search}${parsed.hash}`;
  });

  return { text: rewritten, unknown: [...unknown] };
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

// ---------------------------------------------------------------------------
// Image metadata (SAKEM-099)
// ---------------------------------------------------------------------------
// This repository is public. A photo straight from a phone carries Exif (camera, owner, time, GPS position),
// XMP and IPTC, and the importer used to commit the files as WordPress served them. Every image now goes
// through here before it is written under public/blog/images.

/**
 * The bytes to write for a downloaded image. A JPEG loses its Exif, XMP and IPTC segments without being
 * decoded or re-encoded (lib/strip-jpeg-metadata.mjs: the scan data, dimensions, colour profile and
 * orientation stay as they were). A file that still carries GPS afterwards, such as a PNG or WebP with an
 * Exif chunk, is refused instead of committed: it throws, and the download counts as failed.
 */
export function sanitizeImportedImage(bytes, label = "image") {
  let out = bytes;
  // Sniffed by content, not by extension: some migrated ".jpg" files are PNG data.
  if (isJpeg(bytes)) {
    const result = stripJpegMetadata(bytes);
    out = result.data;
    for (const warning of result.warnings) console.warn(`  ! ${label}: ${warning}`);
    for (const kept of result.keptUnknown) {
      console.warn(`  ! ${label}: kept ${kept.marker} "${kept.id}" (${kept.bytes} bytes), which is not a known metadata block: look at it`);
    }
  }
  const { hits } = findGpsMetadata(out);
  if (hits.length > 0) {
    throw new Error(`${label} carries GPS metadata that the importer cannot strip (${hits.join("; ")}). Remove it from the file, then import again.`);
  }
  return out;
}

export async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) return false;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const res = await fetch(normalizeRemoteUrl(url), {
    headers: { "User-Agent": "SakolaKembara-BlogImporter/1.0" },
  });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buf = sanitizeImportedImage(Buffer.from(await res.arrayBuffer()), url);
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
    // The meta description of the WordPress page (SAKEM-090); only written when there is one, right after the excerpt.
    ...(meta.description ? { description: meta.description } : {}),
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
    // Kept so that rewriting a file (writeMarkdownFile) does not drop it; not part of lib/blog-posts.json (writeBlogJson).
    ...(data.description ? { description: String(data.description) } : {}),
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
    // `description` is a front matter field of the new site (SAKEM-090); the legacy data file never carried it.
    articles: articles.map(({ description: _description, ...rest }) => rest),
  };
  fs.writeFileSync(BLOG_JSON, JSON.stringify(output, null, 2) + "\n", "utf8");
}
