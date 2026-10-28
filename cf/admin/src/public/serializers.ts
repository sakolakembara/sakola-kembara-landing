// Row -> wire. Each serializer builds its object from an explicit list of
// fields, never "the row minus the private columns" (contract, Conventions):
// a column added to a table later stays private until someone adds it here on
// purpose. test/public-serializers.test.ts feeds each serializer a row full of
// private columns and fails if one of them comes out; the queries select the
// same lists, so a private column is not even read.

import { cleanExcerpt } from "./blog-rules";
import { isoDayJakarta, longDateJakarta } from "./dates";
import type {
  PublicAnnouncement,
  PublicBlogArticle,
  PublicBlogSummary,
  PublicEducationEntry,
  PublicReport,
  PublicResource,
  PublicTeamMember,
  PublicWorkEntry,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const optionalText = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

// The history columns are JSON written by the admin form; the database proves
// it is an array, not what is inside. A malformed entry is dropped instead of
// failing the whole team page.
function educationEntries(value: unknown): PublicEducationEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !optionalText(entry.institution)) return [];
    return [{ institution: entry.institution as string, degree: optionalText(entry.degree), year: optionalText(entry.year) }];
  });
}

function workEntries(value: unknown): PublicWorkEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !optionalText(entry.organization) || !optionalText(entry.role)) return [];
    return [{ organization: entry.organization as string, role: entry.role as string, period: optionalText(entry.period) }];
  });
}

export function serializeTeamMember(row: Pick<PublicTeamMember, "id" | "name" | "role" | "image" | "category" | "bio"> & { educationHistory: unknown; workHistory: unknown }): PublicTeamMember {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    image: row.image,
    category: row.category,
    bio: row.bio,
    educationHistory: educationEntries(row.educationHistory),
    workHistory: workEntries(row.workHistory),
  };
}

export function serializeReport(row: PublicReport): PublicReport {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    year: row.year,
    filePath: row.filePath,
    fileSize: row.fileSize,
  };
}

export function serializeResource(row: PublicResource): PublicResource {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    contentType: row.contentType,
    filePath: row.filePath,
    fileSize: row.fileSize,
    externalUrl: row.externalUrl,
    bodyText: row.bodyText,
  };
}

export function serializeAnnouncement(row: PublicAnnouncement): PublicAnnouncement {
  return { title: row.title, body: row.body, severity: row.severity, ctaLabel: row.ctaLabel, ctaUrl: row.ctaUrl };
}

/** What the blog queries return for a card. `publishedAt` is the stored instant. */
export interface BlogSummaryRow {
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  author: string;
  featured: boolean;
  /** `blog_posts.noindex` (SAKEM-109). */
  noindex: boolean;
  publishedAt: Date | null;
}

export function serializeBlogSummary(row: BlogSummaryRow): PublicBlogSummary {
  // A published row always has a date (CHECK blog_posts_published_at_check); the epoch is only a type-level fallback.
  const publishedMs = row.publishedAt?.getTime() ?? 0;
  return {
    slug: row.slug,
    title: row.title,
    category: row.category,
    date: longDateJakarta(publishedMs),
    dateISO: isoDayJakarta(publishedMs),
    excerpt: cleanExcerpt(row.excerpt),
    image: optionalText(row.image),
    imageWidth: row.imageWidth ?? null,
    imageHeight: row.imageHeight ?? null,
    author: row.author,
    featured: row.featured,
    // Only when set: every other entry keeps its shape.
    ...(row.noindex ? { noindex: true as const } : {}),
  };
}

export interface BlogArticleRow extends BlogSummaryRow {
  updatedAt: Date;
  /** `blog_posts.meta_description`; null (or empty) when none is set. */
  metaDescription: string | null;
  /** `blog_posts.seo_title`; null (or empty) when none is set. */
  seoTitle: string | null;
  contentMarkdown: string;
  contentHtml: string;
}

export function serializeBlogArticle(row: BlogArticleRow): PublicBlogArticle {
  const summary = serializeBlogSummary(row);
  return {
    slug: summary.slug,
    title: summary.title,
    category: summary.category,
    date: summary.date,
    dateISO: summary.dateISO,
    modifiedISO: isoDayJakarta(row.updatedAt.getTime()),
    description: optionalText(row.metaDescription),
    seoTitle: optionalText(row.seoTitle),
    excerpt: summary.excerpt,
    image: summary.image,
    imageWidth: summary.imageWidth,
    imageHeight: summary.imageHeight,
    author: summary.author,
    featured: summary.featured,
    ...(summary.noindex ? { noindex: true as const } : {}),
    contentMarkdown: row.contentMarkdown,
    contentHtml: row.contentHtml,
  };
}
