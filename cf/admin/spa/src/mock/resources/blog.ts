import { ifMatch } from "~/lib/crud/etag";
import type { BlogItem, BlogStatus } from "~/pages/blog/model";
import { BLOG_CATEGORIES, BODY_LIMIT_LABEL, cleanMetaDescription, cleanSeoTitle, hasMarkup, LIMITS } from "~/pages/blog/rules";
import { type MockParse, type MockRequest, type MockResource, mockError, mockJson } from "../resources";

// MOCK, local development only. The blog of `/api/admin/blog` with the rules of the Worker's schema
// (src/api/blog.ts) in miniature: validation, a slug made from the title and locked once published, the draft and
// publish states (`POST .../publish`, `.../unpublish`), `If-Match`, and a preview that is a STAND-IN for the Worker's
// renderer (headings, paragraphs, bold, italic, links, images: enough to see the screen work; the real output is
// the Worker's, src/blog/render.ts). Nothing leaves memory.

type MockBlog = BlogItem & { publishedAt: string | null };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const STALE = "Data ini sudah diubah orang lain sejak kamu membukanya. Muat ulang untuk melihat versi terbaru.";
const NOT_FOUND = "Data tidak ditemukan. Mungkin sudah dihapus.";

/** The accounts that can write in this mock (every persona is "Pengguna Contoh"); the Worker's `authorNames` is the real list. */
const MOCK_AUTHORS = ["Editor Contoh", "Konten Contoh", "Pengguna Contoh"];
const AUTHOR_NOT_REGISTERED = "Penulis harus akun yang terdaftar di admin";

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);

const BODY = (extra: string) => `## Mulai dari yang kecil\n\nPendidikan dimulai dari kebiasaan sehari-hari. ${extra}\n\n- Tentukan jadwal yang realistis\n- Catat hal yang sulit dipahami\n- Ulangi sedikit demi sedikit\n\nBaca juga [halaman program kami](/program/pembinaan).`;

function seed(): MockBlog[] {
  const row = (n: number, title: string, category: string, status: BlogStatus, days: number | null, extra: Partial<MockBlog> = {}): MockBlog => ({
    id: `mock-blog-seed-${n}`,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    title,
    excerpt: `Ringkasan artikel "${title}" untuk melihat daftar dan formulir bekerja.`,
    metaDescription: null,
    seoTitle: null,
    noindex: false,
    contentMarkdown: BODY(title),
    category,
    author: "Tim Sakola Kembara",
    featured: false,
    status,
    date: days === null ? null : dayOf(ago(days)),
    publishedAt: days === null ? null : ago(days),
    image: null,
    imageWidth: null,
    imageHeight: null,
    createdAt: ago((days ?? 1) + 2),
    updatedAt: ago(days ?? 1),
    ...extra,
  });
  return [
    row(1, "Cerita Azkiya Menemukan Makna Belajar", "Cerita", "published", 3, { featured: true, metaDescription: "Kisah Azkiya menemukan makna belajar bersama Sakola Kembara, dari ragu-ragu hingga yakin melangkah ke bangku kuliah." }),
    row(2, "Tips Persiapan Masuk PTN", "Tips", "published", 9),
    row(3, "Sakola Kembara Hadir di Belajaraya", "News", "published", 20),
    row(4, "Memilih Jurusan Tanpa Ragu", "Education", "published", 41),
    row(5, "Kisah Alumni di Dunia Kerja", "Career", "published", 75, { image: "/blog/images/2026/05/contoh-sampul.jpg", imageWidth: 1200, imageHeight: 800 }),
    row(6, "Testimoni Orang Tua Siswa", "Testimonials", "published", 120),
    row(7, "Draf: Kegiatan Pekan Depan", "News", "draft", 0),
    row(8, "Draf: Panduan Belajar Mandiri", "Kiat kiat", "draft", 1, { date: null, publishedAt: null }),
  ];
}

function renderMock(markdown: string): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (value: string) =>
    escape(value)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" class="rounded-xl w-full h-auto">')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return markdown
    .split(/\n{2,}/)
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(block.trim());
      if (heading) return `<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`;
      const list = block.split("\n");
      if (list.every((line) => /^[-*]\s+/.test(line))) return `<ul>${list.map((line) => `<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
      return `<p>${inline(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "post";
}

const META_DESCRIPTION_RAW_MAX = 2_000;
const META_DESCRIPTION_MARKUP = "Deskripsi meta hanya boleh berupa teks biasa, tanpa tag HTML";
const META_DESCRIPTION_TOO_LONG = `Deskripsi meta maksimal ${LIMITS.metaDescriptionMax} karakter`;

/** The Worker's `metaDescriptionField` in miniature: `undefined` when the key is absent, `null` for none, else the cleaned text; the length is checked by the caller. */
function parseMetaDescription(body: Record<string, unknown>, fields: Record<string, string>): string | null | undefined {
  const raw = body.metaDescription;
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    fields.metaDescription = "Isian belum benar.";
    return undefined;
  }
  if (raw.length > META_DESCRIPTION_RAW_MAX) {
    fields.metaDescription = META_DESCRIPTION_TOO_LONG;
    return undefined;
  }
  const cleaned = cleanMetaDescription(raw);
  if (hasMarkup(cleaned)) fields.metaDescription = META_DESCRIPTION_MARKUP;
  return cleaned || null;
}

const SEO_TITLE_RAW_MAX = 500;
const SEO_TITLE_MARKUP = "Judul SEO hanya boleh berupa teks biasa, tanpa tag HTML";
const SEO_TITLE_TOO_LONG = `Judul SEO maksimal ${LIMITS.seoTitleMax} karakter`;

/** The Worker's `seoTitleField` in miniature (SAKEM-109): like the meta description, but its maximum holds on every save. */
function parseSeoTitle(body: Record<string, unknown>, fields: Record<string, string>): string | null | undefined {
  const raw = body.seoTitle;
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    fields.seoTitle = "Isian belum benar.";
    return undefined;
  }
  if (raw.length > SEO_TITLE_RAW_MAX) {
    fields.seoTitle = SEO_TITLE_TOO_LONG;
    return undefined;
  }
  const cleaned = cleanSeoTitle(raw);
  if (hasMarkup(cleaned)) fields.seoTitle = SEO_TITLE_MARKUP;
  else if (cleaned.length > LIMITS.seoTitleMax) fields.seoTitle = SEO_TITLE_TOO_LONG;
  return cleaned || null;
}

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * The Worker's schema, in miniature. `values` carry the slug and date the writer typed ("" for none). `excerptMin` is
 * the minimum of the excerpt: a save of an existing article lowers it to 1 and checks the real one against the stored
 * excerpt afterwards, like the Worker (an excerpt the article already has stays valid, whatever its length).
 */
function parse(body: Record<string, unknown>, excerptMin: number = LIMITS.excerptMin, stored: { metaDescription: string | null } | null = null): MockParse<MockBlog> {
  const fields: Record<string, string> = {};
  const title = text(body.title);
  if (title.length < LIMITS.titleMin) fields.title = "Judul minimal 3 karakter";
  else if (title.length > LIMITS.titleMax) fields.title = "Judul maksimal 200 karakter";
  const slug = text(body.slug).toLowerCase();
  if (slug.length > LIMITS.slugMax) fields.slug = "Slug maksimal 160 karakter";
  else if (slug !== "" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fields.slug = "Slug hanya boleh huruf kecil, angka, dan tanda hubung";
  const excerpt = text(body.excerpt);
  if (excerpt.length < excerptMin) fields.excerpt = "Excerpt minimal 20 karakter";
  else if (excerpt.length > LIMITS.excerptMax) fields.excerpt = "Maksimal 500 karakter";
  // The maximum applies to a create and to a text the writer changes; the one an article already has stays valid (the Worker's update does the same).
  const metaDescription = parseMetaDescription(body, fields);
  if (!fields.metaDescription && metaDescription && metaDescription.length > LIMITS.metaDescriptionMax && metaDescription !== stored?.metaDescription) fields.metaDescription = META_DESCRIPTION_TOO_LONG;
  const seoTitle = parseSeoTitle(body, fields);
  if (body.noindex !== undefined && typeof body.noindex !== "boolean") fields.noindex = "Isian belum benar.";
  const markdown = text(body.contentMarkdown);
  if (markdown.length < LIMITS.bodyMin) fields.contentMarkdown = "Isi minimal 50 karakter";
  else if (markdown.length > LIMITS.bodyMax) fields.contentMarkdown = `Isi maksimal ${BODY_LIMIT_LABEL} karakter`;
  const author = text(body.author);
  if (author.length < LIMITS.authorMin) fields.author = "Wajib diisi";
  else if (author.length > LIMITS.authorMax) fields.author = "Maksimal 120 karakter";
  if (!(BLOG_CATEGORIES as readonly unknown[]).includes(body.category)) fields.category = "Kategori tidak dikenal";
  const date = text(body.date);
  if (date !== "" && !isDay(date)) fields.date = "Format harus YYYY-MM-DD";
  const image = text(body.image);
  if (image !== "" && !/^\/(uploads\/blog-image|blog\/images)\//.test(image)) fields.image = "Berkas tidak valid. Unggah ulang berkasnya.";
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    values: {
      title,
      slug,
      excerpt,
      // Absent stays absent (an update keeps what is stored, a create stores none), `null` clears.
      ...(metaDescription === undefined ? {} : { metaDescription }),
      ...(seoTitle === undefined ? {} : { seoTitle }),
      ...(typeof body.noindex === "boolean" ? { noindex: body.noindex } : {}),
      contentMarkdown: markdown,
      category: body.category as string,
      author,
      featured: body.featured === true,
      date: date === "" ? null : date,
      image: image === "" ? null : image,
      imageWidth: image === "" ? null : 800,
      imageHeight: image === "" ? null : 600,
    },
  };
}

function bodyOf(init: RequestInit): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(String(init.body ?? "null"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

let created = 0;

// Called by the generic store after its access check (a persona that cannot write never gets a write here), like the Worker's guards.
function custom({ method, rest, init, rows }: MockRequest<MockBlog>): Response | null {
  const parts = rest.split("/").map(decodeURIComponent);
  const isCreate = method === "POST" && rest === "";
  const isPreview = method === "POST" && rest === "preview";
  const isUpdate = method === "PUT" && parts.length === 1 && rest !== "";
  const isVerb = method === "POST" && parts.length === 2 && (parts[1] === "publish" || parts[1] === "unpublish");
  const isAuthors = method === "GET" && rest === "authors";
  if (!isCreate && !isPreview && !isUpdate && !isVerb && !isAuthors) return null; // the generic store: list, one, delete

  if (isAuthors) return mockJson({ authors: MOCK_AUTHORS });

  const headers = new Headers(init.headers);
  const today = new Date().toISOString().slice(0, 10);

  if (isPreview) {
    const body = bodyOf(init);
    const markdown = typeof body?.contentMarkdown === "string" ? body.contentMarkdown : null;
    if (markdown === null) return mockError(400, "invalid", "Periksa kembali isian formulir.", { fields: { contentMarkdown: "Wajib diisi." } });
    if (markdown.length > LIMITS.bodyMax) return mockError(400, "invalid", "Periksa kembali isian formulir.", { fields: { contentMarkdown: `Isi maksimal ${BODY_LIMIT_LABEL} karakter` } });
    return mockJson({ html: renderMock(markdown.trim()) });
  }

  if (isCreate) {
    const body = bodyOf(init);
    if (!body) return mockError(400, "invalid_json", "Isi permintaan bukan JSON yang valid.");
    const parsed = parse(body);
    if (!parsed.ok) return mockError(400, "invalid", "Periksa kembali isian formulir.", { fields: parsed.fields });
    if (!MOCK_AUTHORS.includes(parsed.values.author!)) return mockError(400, "invalid", "Periksa kembali isian formulir.", { fields: { author: AUTHOR_NOT_REGISTERED } });
    const wanted = parsed.values.slug || "";
    if (wanted && rows.some((row) => row.slug === wanted)) return mockError(409, "conflict", "Data bentrok dengan data lain yang sudah ada.", { fields: { slug: "Slug sudah dipakai" } });
    let slug = wanted || slugify(parsed.values.title!);
    for (let n = 2; !wanted && rows.some((row) => row.slug === slug); n++) slug = `${slugify(parsed.values.title!)}-${n}`;
    created += 1;
    const now = new Date().toISOString();
    const row: MockBlog = {
      ...(parsed.values as MockBlog),
      metaDescription: parsed.values.metaDescription ?? null,
      seoTitle: parsed.values.seoTitle ?? null,
      noindex: parsed.values.noindex ?? false,
      id: `mock-blog-${created}`,
      slug,
      status: "draft",
      publishedAt: parsed.values.date ? `${parsed.values.date}T00:00:00.000Z` : null,
      createdAt: now,
      updatedAt: now,
    };
    rows.unshift(row);
    return mockJson({ item: row }, 201, { ETag: ifMatch(row.updatedAt) });
  }

  const row = rows.find((candidate) => candidate.id === parts[0]);
  const precondition = headers.get("If-Match");
  if (precondition === null) return mockError(428, "precondition_required", "Versi data tidak disertakan. Muat ulang halaman lalu coba lagi.");
  const nextVersion = (previous: string) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

  if (isUpdate) {
    const body = bodyOf(init);
    if (!body) return mockError(400, "invalid_json", "Isi permintaan bukan JSON yang valid.");
    const parsed = parse(body, 1, row ?? null);
    if (!parsed.ok) return mockError(400, "invalid", "Periksa kembali isian formulir.", { fields: parsed.fields });
    if (!row) return mockError(404, "not_found", NOT_FOUND);
    if (precondition !== ifMatch(row.updatedAt)) return mockError(409, "stale", STALE);
    const problems: Record<string, string> = {};
    if (parsed.values.excerpt!.length < LIMITS.excerptMin && parsed.values.excerpt !== row.excerpt.trim()) problems.excerpt = "Excerpt minimal 20 karakter";
    const slug = parsed.values.slug || row.slug;
    if (parsed.values.slug && parsed.values.slug !== row.slug && row.status === "published") problems.slug = "Slug tidak bisa diubah setelah artikel terbit";
    if (row.status === "published" && !parsed.values.date) problems.date = "Format harus YYYY-MM-DD";
    // The author the article has stays valid as it is; another one must be an account that can write.
    if (parsed.values.author !== row.author.trim() && !MOCK_AUTHORS.includes(parsed.values.author!)) problems.author = AUTHOR_NOT_REGISTERED;
    if (Object.keys(problems).length > 0) return mockError(400, "invalid", "Periksa kembali isian formulir.", { fields: problems });
    if (rows.some((other) => other.id !== row.id && other.slug === slug)) return mockError(409, "conflict", "Data bentrok dengan data lain yang sudah ada.", { fields: { slug: "Slug sudah dipakai" } });
    const next = { ...parsed.values, metaDescription: parsed.values.metaDescription === undefined ? row.metaDescription || null : parsed.values.metaDescription, seoTitle: parsed.values.seoTitle === undefined ? row.seoTitle || null : parsed.values.seoTitle, noindex: parsed.values.noindex ?? row.noindex, slug, publishedAt: parsed.values.date === row.date ? row.publishedAt : parsed.values.date ? `${parsed.values.date}T00:00:00.000Z` : null };
    const same = (Object.keys(next) as (keyof typeof next)[]).every((key) => next[key] === (row as unknown as Record<string, unknown>)[key]);
    if (same) return mockJson({ item: row }, 200, { ETag: ifMatch(row.updatedAt) });
    Object.assign(row, next, { updatedAt: nextVersion(row.updatedAt) });
    return mockJson({ item: row }, 200, { ETag: ifMatch(row.updatedAt) });
  }

  // publish / unpublish
  if (!row) return mockError(404, "not_found", NOT_FOUND);
  if (precondition !== ifMatch(row.updatedAt)) return mockError(409, "stale", STALE);
  const to: BlogStatus = parts[1] === "publish" ? "published" : "draft";
  if (row.status !== to) {
    if (to === "published" && !row.date) Object.assign(row, { date: today, publishedAt: new Date().toISOString() });
    Object.assign(row, { status: to, updatedAt: nextVersion(row.updatedAt) });
  }
  return mockJson({ item: row }, 200, { ETag: ifMatch(row.updatedAt) });
}

const resource: MockResource<MockBlog> = {
  path: "/api/admin/blog",
  area: "konten",
  seed,
  search: ["title", "excerpt"],
  filters: { status: ["draft", "published"], category: [...BLOG_CATEGORIES] },
  sorts: ["updatedAt", "publishedAt", "createdAt", "title"],
  defaultSort: "-updatedAt",
  parse,
  custom,
};

export default resource;
