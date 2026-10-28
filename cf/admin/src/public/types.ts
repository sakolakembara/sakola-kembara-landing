// Wire types of the public content API (GET /api/public/*), exactly the shapes
// of docs/cloudflare/content-api.md. Type-only, so the consumer (cf/web) could
// copy this file. Every field here is something the public site already shows;
// anything else a table holds (author ids, audit timestamps, admin notes,
// WordPress ids) must never be added without changing the contract first.

import type { AnnouncementSeverity, ReportCategory, ResourceCategory, ResourceContentType, TeamCategory } from "../db/schema";

export interface PublicEducationEntry {
  institution: string;
  degree: string | null;
  year: string | null;
}

export interface PublicWorkEntry {
  organization: string;
  role: string;
  period: string | null;
}

export interface PublicTeamMember {
  id: string;
  name: string;
  role: string;
  /** Root-relative path (/images/team/...), or null. */
  image: string | null;
  category: TeamCategory;
  bio: string | null;
  educationHistory: PublicEducationEntry[];
  workHistory: PublicWorkEntry[];
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
  filePath: string | null;
  fileSize: number | null;
  externalUrl: string | null;
  bodyText: string | null;
}

export interface PublicAnnouncement {
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

/** An entry of the blog index (and a "related" card): everything except the body. */
export interface PublicBlogSummary {
  slug: string;
  title: string;
  category: string;
  /** Indonesian long date in Asia/Jakarta, e.g. "21 Mei 2026". */
  date: string;
  /** YYYY-MM-DD in Asia/Jakarta. */
  dateISO: string;
  /** WordPress "[...]" trailers already stripped. */
  excerpt: string;
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  author: string;
  featured: boolean;
  /**
   * Present, and `true`, only when the editor ticked "Sembunyikan dari Google" (SAKEM-109): the site leaves the article out of
   * the sitemap and its page says noindex. Absent otherwise, so the entries of every other article are as they were.
   */
  noindex?: true;
}

/** The summary fields plus the dates and bodies the article page needs. */
export interface PublicBlogArticle extends PublicBlogSummary {
  /** YYYY-MM-DD of the last save, in Asia/Jakarta. */
  modifiedISO: string;
  /**
   * The text for `<meta name="description">`, og:description and the JSON-LD description, when it is not the excerpt
   * (the migrated articles carry the description their WordPress page had); null when none is set: use the excerpt.
   */
  description: string | null;
  /**
   * The text for `<title>`, og:title and twitter:title, used as written (SAKEM-109, "Judul SEO"); null when none is set: the
   * site uses the title with its suffix.
   */
  seoTitle: string | null;
  /** The source of truth. */
  contentMarkdown: string;
  /** Rendered when the article was saved; never rendered on read. */
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
  /** The newest featured article (else the newest). Not repeated in `articles`; null only for an empty blog. */
  featured: PublicBlogSummary | null;
  articles: PublicBlogSummary[];
  page: number;
  pageSize: number;
  /** Articles across all pages, the featured one excluded. */
  total: number;
  totalPages: number;
}
export interface BlogArticleResponse {
  article: PublicBlogArticle;
  related: PublicBlogSummary[];
}
