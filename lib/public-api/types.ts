// Wire types of the public content API (GET /api/public/*). Client-safe: type
// imports only. Each type is the subset of a DB row / BlogArticle that the
// public site already shows; the Worker API that replaces this seam must
// return the same shapes (docs/cloudflare/content-api.md).

import type {
  AnnouncementSeverity,
  EducationEntry,
  ReportCategory,
  ResourceCategory,
  ResourceContentType,
  TeamCategory,
  WorkEntry,
} from "@/lib/db/schema";

export interface PublicTeamMember {
  id: string;
  name: string;
  role: string;
  /** Root-relative path (/images/team/...), or null. */
  image: string | null;
  category: TeamCategory;
  bio: string | null;
  educationHistory: EducationEntry[];
  workHistory: WorkEntry[];
}

export interface PublicReport {
  id: string;
  title: string;
  description: string | null;
  category: ReportCategory;
  /** "2025" or an academic year such as "2025/2026". */
  year: string;
  /** Root-relative path of the PDF (/reports/...). */
  filePath: string;
  /** Bytes. */
  fileSize: number;
}

export interface PublicResource {
  id: string;
  title: string;
  description: string | null;
  category: ResourceCategory;
  contentType: ResourceContentType;
  /** contentType "file": root-relative path (/resources/...). */
  filePath: string | null;
  /** contentType "file": bytes. */
  fileSize: number | null;
  /** contentType "url". */
  externalUrl: string | null;
  /** contentType "text": copy-able text. */
  bodyText: string | null;
}

export interface PublicAnnouncement {
  title: string;
  /** Markdown allowed (the strip renders it as plain text). */
  body: string;
  severity: AnnouncementSeverity;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

/** BlogArticle without the markdown body: enough for an index card. */
export interface PublicBlogSummary {
  /** URL slug (BlogArticle.id). */
  slug: string;
  title: string;
  category: string;
  /** Indonesian display date, e.g. "21 Mei 2026". */
  date: string;
  /** Sort key, YYYY-MM-DD. */
  dateISO: string;
  /** WordPress "[…]" trailers already stripped (cleanExcerpt). */
  excerpt: string;
  /** Hero image, root-relative (/blog/images/...) or absolute; null if none. */
  image: string | null;
  author: string;
  featured: boolean;
}

export interface PublicBlogArticle extends PublicBlogSummary {
  /** Last modification, YYYY-MM-DD (for structured data). */
  modifiedISO: string;
  /** Markdown source. */
  contentMarkdown: string;
  /** The markdown rendered as the site renders it; safe to inject as-is. */
  contentHtml: string;
}

export interface TeamResponse {
  members: PublicTeamMember[];
}
export interface ReportsResponse {
  reports: PublicReport[];
}
export interface ResourcesResponse {
  resources: PublicResource[];
}
export interface AnnouncementResponse {
  announcement: PublicAnnouncement | null;
}
export interface BlogListResponse {
  /** Featured article of the index; also absent from `articles`. */
  featured: PublicBlogSummary | null;
  articles: PublicBlogSummary[];
  page: number;
  pageSize: number;
  /** Articles in `articles` across all pages (featured excluded). */
  total: number;
  totalPages: number;
}
export interface BlogArticleResponse {
  article: PublicBlogArticle;
  related: PublicBlogSummary[];
}
export interface ErrorResponse {
  error: string;
  message?: string;
}
