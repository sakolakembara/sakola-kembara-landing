import type {
  Announcement,
  Report,
  SiteResource,
  TeamMember,
} from "@/lib/db/schema";
import { cleanExcerpt, type BlogArticle } from "@/lib/blog-types";
import type {
  PublicAnnouncement,
  PublicBlogArticle,
  PublicBlogSummary,
  PublicReport,
  PublicResource,
  PublicTeamMember,
} from "@/lib/public-api/types";

// Every mapper lists the exposed fields explicitly instead of omitting the
// private ones: a column added to a table later (an email, an audit field)
// stays out of the public API until someone adds it here on purpose.

export function toPublicTeamMember(m: TeamMember): PublicTeamMember {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    image: m.image,
    category: m.category,
    bio: m.bio,
    educationHistory: m.educationHistory,
    workHistory: m.workHistory,
  };
}

export function toPublicReport(r: Report): PublicReport {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    year: r.year,
    filePath: r.filePath,
    fileSize: r.fileSize,
  };
}

export function toPublicResource(r: SiteResource): PublicResource {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    contentType: r.contentType,
    filePath: r.filePath,
    fileSize: r.fileSize,
    externalUrl: r.externalUrl,
    bodyText: r.bodyText,
  };
}

export function toPublicAnnouncement(a: Announcement): PublicAnnouncement {
  return {
    title: a.title,
    body: a.body,
    severity: a.severity,
    ctaLabel: a.ctaLabel,
    ctaUrl: a.ctaUrl,
  };
}

export function toPublicBlogSummary(a: BlogArticle): PublicBlogSummary {
  return {
    slug: a.id,
    title: a.title,
    category: a.category,
    date: a.date,
    dateISO: a.dateISO,
    excerpt: cleanExcerpt(a.excerpt),
    image: a.image || null,
    author: a.author,
    featured: a.featured,
  };
}

export function toPublicBlogArticle(
  a: BlogArticle,
  contentHtml: string,
): PublicBlogArticle {
  return {
    ...toPublicBlogSummary(a),
    modifiedISO: a.modifiedISO,
    contentMarkdown: a.contentMarkdown,
    contentHtml,
  };
}
