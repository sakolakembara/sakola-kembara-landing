import type { ListSpec } from "../../lib/crud/query";
import { defaultAuthor } from "./rules";

// What the blog screens share and that is not React: the types, the paths and the form's values with their mapping
// to the body of a save. Pure (no `~` imports), so the Worker's contract test imports it and sends what the form
// would send. The status tags and the list's spec are in model.ts.

/** The API collection and the SPA route of the menu. */
export const API_PATH = "/api/admin/blog";
export const ROUTE = "/blog";
export const PREVIEW_PATH = `${API_PATH}/preview`;

/** What the list offers: the same names as the Worker's filters and sorts (src/api/blog.ts). */
export const LIST_SPEC: ListSpec = {
  filters: ["status", "category"],
  sorts: ["updatedAt", "publishedAt", "createdAt", "title"],
  defaultSort: "-updatedAt",
};

export type BlogStatus = "draft" | "published";

/** A row of the list (`presentListItem` in src/api/blog.ts): no markdown, no HTML. */
export interface BlogListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  featured: boolean;
  status: BlogStatus;
  /** `YYYY-MM-DD` (Jakarta), or null on a draft that has no date yet. */
  date: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One article as the form needs it (`present` in src/api/blog.ts). */
export interface BlogItem extends BlogListItem {
  /** The text for search results (SAKEM-094), or null when the article has none and the site uses the excerpt. */
  metaDescription: string | null;
  contentMarkdown: string;
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

export interface BlogValues extends Record<string, string | boolean> {
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  /** "" for none. */
  metaDescription: string;
  contentMarkdown: string;
  author: string;
  featured: boolean;
  /** `YYYY-MM-DD`, or "" for none. */
  date: string;
  /** The hero's path, or "" for none. */
  image: string;
}

export function toValues(item: BlogItem | null, email?: string | null): BlogValues {
  return {
    title: item?.title ?? "",
    // A new article has none: the Worker makes it from the title.
    slug: item?.slug ?? "",
    // The legacy form started on "Cerita".
    category: item?.category ?? "Cerita",
    excerpt: item?.excerpt ?? "",
    metaDescription: item?.metaDescription ?? "",
    contentMarkdown: item?.contentMarkdown ?? "",
    author: item?.author ?? defaultAuthor(email),
    featured: item?.featured ?? false,
    date: item?.date ?? "",
    image: item?.image ?? "",
  };
}

/**
 * The body of `POST` and `PUT`. An empty date, image or meta description is "none" (null: the key is always sent, so
 * emptying the field clears it); a blank slug asks for the automatic one.
 */
export function toBody(values: BlogValues) {
  return {
    title: values.title,
    slug: values.slug,
    category: values.category,
    excerpt: values.excerpt,
    metaDescription: values.metaDescription === "" ? null : values.metaDescription,
    contentMarkdown: values.contentMarkdown,
    author: values.author,
    featured: values.featured,
    date: values.date === "" ? null : values.date,
    image: values.image === "" ? null : values.image,
  };
}

/** For the error summary: the field names the Worker reports, in the legacy labels. */
export const FIELD_LABELS: Record<string, string> = {
  title: "Judul",
  slug: "Slug",
  excerpt: "Excerpt",
  metaDescription: "Deskripsi meta",
  category: "Kategori",
  date: "Tanggal Publikasi",
  author: "Penulis",
  featured: "Featured",
  image: "Gambar Hero",
  contentMarkdown: "Isi Artikel",
};

export type EditorTab = "detail" | "konten";

/** The tab each field lives on: the legacy editor opened the tab that held the first error. */
export const FIELD_TAB: Record<string, EditorTab> = {
  title: "detail",
  slug: "detail",
  excerpt: "detail",
  metaDescription: "detail",
  category: "detail",
  date: "detail",
  author: "detail",
  featured: "detail",
  image: "detail",
  contentMarkdown: "konten",
};
