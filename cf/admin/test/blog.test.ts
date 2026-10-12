import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createBlogRoutes, uploadsOf } from "../src/api/blog";
import type { CrudDeps } from "../src/api/crud";
import { renderArticle } from "../src/blog/render";
import { BODY_MAX, isIsoDay, pickFreeSlug, slugify, startOfIsoDayJakarta } from "../src/blog/rules";
import { isoDayJakarta } from "../src/public/dates";
import type { ContentChange } from "../src/public/purge";
import { checkLimits } from "../src/security/rate-limit";
import { appAround, ifMatchOf, spyOnD1 } from "./crud-app";
import { CAPTCHA, call, cookiesOf, createVerifiedUser, fakeNetwork, PASSWORD, productionLike, signedInCookie, uniqueEmail } from "./helpers";
import { withFrozenDate } from "./limiter-clock";
import { internalFetch } from "./public-helpers";
import { auditRows, clearBucket, mediaRows, objectKeys, png, upload, type Uploaded } from "./uploads-helpers";

// The blog API (SAKEM-082, docs/cloudflare/admin-blog.md): the legacy rules and messages
// (app/(admin)/admin/blog/actions.ts), the roles and areas, the render at save, the draft and publish states,
// the slug rules, the hero and inline images, the public effect and the audit rows. What is generic to every
// resource (envelopes, clamping, the audit transaction) is test/crud-contract.test.ts.

const LIST = "/api/admin/blog";

const BODY = "## Mulai dari jadwal\n\nBuat jadwal belajar harian dan patuhi dengan **disiplin**. Istirahat cukup itu penting.";

function form(overrides: Record<string, unknown> = {}) {
  return {
    title: "Cara Belajar yang Efektif",
    category: "Tips",
    excerpt: "Ringkasan artikel tentang cara belajar yang efektif untuk siswa.",
    contentMarkdown: BODY,
    author: "Dzul",
    featured: false,
    ...overrides,
  };
}

interface Item {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  contentMarkdown: string;
  category: string;
  author: string;
  featured: boolean;
  status: "draft" | "published";
  date: string | null;
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, any>;

async function editor(areas: ("konten" | "pendaftaran" | "komunikasi")[] = ["konten"]) {
  return signedInCookie(uniqueEmail("editor"), "editor", areas);
}

async function post(cookie: string, overrides: Record<string, unknown> = {}, via?: { fetch: any }) {
  const res = await call(LIST, { method: "POST", cookie, json: form(overrides), via });
  return { res, body: (await res.clone().json()) as { item: Item } & Record<string, any> };
}

async function createDraft(cookie: string, overrides: Record<string, unknown> = {}): Promise<Item> {
  const { res, body } = await post(cookie, overrides);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.item;
}

const ifMatch = (id: string) => ifMatchOf("blog_posts", id);

async function put(cookie: string, id: string, overrides: Record<string, unknown> = {}, via?: { fetch: any }) {
  return call(`${LIST}/${id}`, { method: "PUT", cookie, headers: await ifMatch(id), json: form(overrides), via });
}

async function verb(cookie: string, id: string, name: "publish" | "unpublish", via?: { fetch: any }) {
  return call(`${LIST}/${id}/${name}`, { method: "POST", cookie, headers: await ifMatch(id), via });
}

async function row(id: string): Promise<Row> {
  return (await env.DB.prepare("SELECT * FROM blog_posts WHERE id = ?").bind(id).first<Row>())!;
}

async function count(table: string) {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

async function fieldsOf(res: Response): Promise<Record<string, string>> {
  return ((await res.json()) as { fields: Record<string, string> }).fields;
}

async function uploadImage(cookie: string, width = 640, height = 360, name = "foto.png"): Promise<Uploaded> {
  const res = await upload({ kind: "blog-image", bytes: png(width, height), filename: name, claimedType: "image/png", cookie });
  expect(res.status).toBe(201);
  return (await res.json()) as Uploaded;
}

/** A row inserted as an import or an older save would leave it: for the list tests. */
async function seed(values: Partial<Record<string, unknown>> & { slug: string }) {
  const row = {
    id: crypto.randomUUID(),
    title: `Judul ${values.slug}`,
    excerpt: "Ringkasan yang cukup panjang untuk contoh.",
    content_markdown: BODY,
    content_html: "<p>isi</p>",
    category: "Cerita",
    author: "Seed",
    featured: 0,
    status: "published",
    published_at: Date.parse("2026-01-01T00:00:00Z"),
    created_at: 1000,
    updated_at: 1000,
    ...values,
  };
  const columns = Object.keys(row);
  await env.DB.prepare(`INSERT INTO blog_posts (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .bind(...Object.values(row))
    .run();
  return row;
}

beforeEach(clearBucket);

// -------------------------------------------------------------------------------------------- who may

describe("blog: who may do what", () => {
  test("nobody signed in: 401 on every route", async () => {
    const id = (await seed({ slug: "a" })).id;
    for (const [method, path] of [
      ["GET", LIST],
      ["GET", `${LIST}/${id}`],
      ["POST", LIST],
      ["POST", `${LIST}/preview`],
      ["PUT", `${LIST}/${id}`],
      ["POST", `${LIST}/${id}/publish`],
      ["POST", `${LIST}/${id}/unpublish`],
      ["DELETE", `${LIST}/${id}`],
    ] as const) {
      expect((await call(path, { method, json: method === "GET" || method === "DELETE" ? undefined : form() })).status, `${method} ${path}`).toBe(401);
    }
    expect(await count("audit_log")).toBe(0);
  });

  // Blog is the `konten` area. Negative checks (scripts/negative-checks-blog.mjs): drop the area check of a route,
  // or let a viewer write, and the matrix below fails.
  const cases = [
    { label: "student", role: "student", areas: [], read: 403, write: 403 },
    { label: "viewer", role: "viewer", areas: [], read: 200, write: 403 },
    { label: "viewer with a stray konten grant", role: "viewer", areas: ["konten"], read: 200, write: 403 },
    { label: "editor with no grants", role: "editor", areas: [], read: 403, write: 403 },
    { label: "editor granted pendaftaran only", role: "editor", areas: ["pendaftaran"], read: 403, write: 403 },
    { label: "editor granted komunikasi and pendaftaran", role: "editor", areas: ["komunikasi", "pendaftaran"], read: 403, write: 403 },
    { label: "editor granted konten", role: "editor", areas: ["konten"], read: 200, write: "ok" },
    { label: "editor granted every area", role: "editor", areas: ["pendaftaran", "komunikasi", "konten"], read: 200, write: "ok" },
    { label: "super_admin", role: "super_admin", areas: [], read: 200, write: "ok" },
  ] as const;

  for (const { label, role, areas, read, write } of cases) {
    test(`${label}: read ${read}, write ${write === "ok" ? "allowed" : "403"}`, async () => {
      const cookie = await signedInCookie(uniqueEmail(role), role, areas);
      const seeded = await seed({ slug: "seed", title: "Seed" });

      expect((await call(LIST, { cookie })).status).toBe(read);
      expect((await call(`${LIST}/${seeded.id}`, { cookie })).status).toBe(read);

      const preview = await call(`${LIST}/preview`, { method: "POST", cookie, json: { contentMarkdown: BODY } });
      const created = await call(LIST, { method: "POST", cookie, json: form() });
      const updated = await call(`${LIST}/${seeded.id}`, { method: "PUT", cookie, headers: await ifMatch(seeded.id), json: form({ date: "2026-01-01", title: "Judul baru" }) });
      const unpublished = await call(`${LIST}/${seeded.id}/unpublish`, { method: "POST", cookie, headers: await ifMatch(seeded.id) });
      const published = await call(`${LIST}/${seeded.id}/publish`, { method: "POST", cookie, headers: await ifMatch(seeded.id) });
      const deleted = await call(`${LIST}/${seeded.id}`, { method: "DELETE", cookie });

      if (write === "ok") {
        expect([preview.status, created.status, updated.status, unpublished.status, published.status, deleted.status]).toEqual([200, 201, 200, 200, 200, 204]);
        expect((await auditRows()).map((r) => r.action)).toEqual(["blog.create", "blog.update", "blog.unpublish", "blog.publish", "blog.delete"]);
      } else {
        expect([preview.status, created.status, updated.status, unpublished.status, published.status, deleted.status]).toEqual([403, 403, 403, 403, 403, 403]);
        // A refused write changes nothing and leaves no audit row.
        expect(await count("blog_posts")).toBe(1);
        expect((await row(seeded.id)).title).toBe("Seed");
        expect((await row(seeded.id)).status).toBe("published");
        expect(await count("audit_log")).toBe(0);
      }
    });
  }

  test("a refused read says nothing about what is there", async () => {
    await seed({ slug: "rahasia" });
    const cookie = await editor(["pendaftaran"]);
    const res = await call(LIST, { cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});

// ---------------------------------------------------------------------------------------------- create

describe("blog: create", () => {
  test("makes a draft, renders the HTML, records who, and writes one audit row of field names", async () => {
    const email = uniqueEmail("editor");
    const cookie = await signedInCookie(email, "editor", ["konten"]);
    const res = await call(LIST, { method: "POST", cookie, json: form() });
    expect(res.status).toBe(201);
    const { item } = (await res.json()) as { item: Item };

    expect(item).toMatchObject({ slug: "cara-belajar-yang-efektif", title: "Cara Belajar yang Efektif", status: "draft", date: null, image: null, imageWidth: null, imageHeight: null, featured: false, contentMarkdown: BODY });
    // An explicit field list: no HTML, no WordPress id or source, no user ids.
    expect(Object.keys(item).sort()).toEqual(["author", "category", "contentMarkdown", "createdAt", "date", "excerpt", "featured", "id", "image", "imageHeight", "imageWidth", "slug", "status", "title", "updatedAt"]);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);

    const stored = await row(item.id);
    expect(stored.content_html).toBe(renderArticle(BODY).html);
    expect(stored.status).toBe("draft");
    expect(stored.published_at).toBeNull();
    expect(stored.wp_id).toBeNull();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    expect([stored.created_by, stored.updated_by]).toEqual([user!.id, user!.id]);

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_email: email, action: "blog.create", resource_type: "blog", resource_id: item.id });
    const metadata = JSON.parse(audit[0]!.metadata) as { fields: string[]; label: string };
    expect(Object.keys(metadata).sort()).toEqual(["fields", "label"]);
    expect(metadata.label).toBe("Cara Belajar yang Efektif");
    expect(metadata.fields).toEqual(["slug", "title", "excerpt", "contentMarkdown", "contentHtml", "image", "imageWidth", "imageHeight", "category", "author", "featured", "status", "publishedAt"]);
    // Names only: not a word of the article, in markdown or HTML.
    for (const secret of ["disiplin", "Istirahat", "<p>", "Ringkasan artikel", "Dzul"]) expect(audit[0]!.metadata).not.toContain(secret);
  });

  test("the slug is made from the title like the legacy admin did, and numbered when taken", async () => {
    const cookie = await editor();
    expect((await createDraft(cookie, { title: "Kisah Ibu Rahmá: Dari Desa ke Kampus!" })).slug).toBe("kisah-ibu-rahma-dari-desa-ke-kampus");
    expect((await createDraft(cookie)).slug).toBe("cara-belajar-yang-efektif");
    expect((await createDraft(cookie)).slug).toBe("cara-belajar-yang-efektif-2");
    expect((await createDraft(cookie)).slug).toBe("cara-belajar-yang-efektif-3");
    // A title with nothing usable in it: the legacy fallback.
    expect((await createDraft(cookie, { title: "!!!" })).slug).toBe("post");
    expect((await createDraft(cookie, { title: "???" })).slug).toBe("post-2");
  });

  test("a slug can be given: lower-cased for the writer, checked, and never taken twice", async () => {
    const cookie = await editor();
    expect((await createDraft(cookie, { slug: "Halo-Dunia" })).slug).toBe("halo-dunia");

    const taken = await post(cookie, { slug: "halo-dunia" });
    expect(taken.res.status).toBe(409);
    expect(taken.body).toMatchObject({ error: "conflict", fields: { slug: "Slug sudah dipakai" } });

    // An explicit slug that an automatic one would also want.
    const dup = await post(cookie, { title: "Halo Dunia" }); // auto: "halo-dunia" is taken, so "halo-dunia-2"
    expect(dup.res.status).toBe(201);
    expect(dup.body.item.slug).toBe("halo-dunia-2");
    expect(await count("blog_posts")).toBe(2);
    expect((await auditRows()).map((r) => r.action)).toEqual(["blog.create", "blog.create"]); // the 409 left no row

    for (const bad of ["halo dunia", "halo_dunia", "-halo", "halo-", "halo--dunia", "halo/dunia", "HALO DUNIA"]) {
      const res = await call(LIST, { method: "POST", cookie, json: form({ slug: bad }) });
      expect(res.status, bad).toBe(400);
      expect(await fieldsOf(res), bad).toEqual({ slug: "Slug hanya boleh huruf kecil, angka, dan tanda hubung" });
    }
    expect(await fieldsOf(await call(LIST, { method: "POST", cookie, json: form({ slug: "a".repeat(161) }) }))).toEqual({ slug: "Slug maksimal 160 karakter" });
    // An empty slug is no slug: the title's is used.
    expect((await createDraft(cookie, { slug: "", title: "Judul Lain" })).slug).toBe("judul-lain");
  });

  test("a date is the day of publication at 00:00 in Jakarta; no date leaves none", async () => {
    const cookie = await editor();
    const dated = await createDraft(cookie, { date: "2026-05-21" });
    expect(dated.date).toBe("2026-05-21");
    expect((await row(dated.id)).published_at).toBe(Date.parse("2026-05-20T17:00:00.000Z"));
    expect(startOfIsoDayJakarta("2026-05-21").toISOString()).toBe("2026-05-20T17:00:00.000Z");
    const undated = await createDraft(cookie, { date: "" });
    expect(undated.date).toBeNull();
    expect((await row(undated.id)).published_at).toBeNull();
  });

  test("it is always a draft, whatever the body says", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie, { status: "published", publishedAt: "2020-01-01T00:00:00Z", id: "mine", createdBy: "someone", wpId: 5, contentHtml: "<script>alert(1)</script>" });
    expect(item.status).toBe("draft");
    expect(item.id).not.toBe("mine");
    const stored = await row(item.id);
    expect([stored.status, stored.published_at, stored.wp_id, stored.content_html]).toEqual(["draft", null, null, renderArticle(BODY).html]);
  });

  test("the HTML is sanitised on the way in", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie, { contentMarkdown: `${BODY}\n\n[klik](javascript:alert(1)) <script>alert(2)</script> ![x](http://example.org/a.png)` });
    const html = (await row(item.id)).content_html as string;
    expect(html).not.toMatch(/javascript|<script|<img|href="javascript/);
    expect(html).toContain("klik");
  });
});

describe("blog: validation keeps the legacy rules and messages, in the one 400 shape", () => {
  async function invalid(overrides: Record<string, unknown>) {
    const cookie = await editor();
    const res = await call(LIST, { method: "POST", cookie, json: form(overrides) });
    expect(res.status).toBe(400);
    expect(await count("blog_posts")).toBe(0);
    expect(await count("audit_log")).toBe(0);
    return (await res.json()) as { error: string; message: string; fields: Record<string, string> };
  }

  test("title 3 to 200", async () => {
    expect(await invalid({ title: "ab" })).toMatchObject({ error: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter" } });
    expect((await invalid({ title: "x".repeat(201) })).fields).toEqual({ title: "Judul maksimal 200 karakter" });
    expect((await invalid({ title: "  ab  " })).fields).toEqual({ title: "Judul minimal 3 karakter" }); // trimmed first
  });

  test("excerpt 20 to 500", async () => {
    expect((await invalid({ excerpt: "terlalu pendek" })).fields).toEqual({ excerpt: "Excerpt minimal 20 karakter" });
    expect((await invalid({ excerpt: "x".repeat(501) })).fields).toEqual({ excerpt: "Maksimal 500 karakter" });
  });

  test("the minimum of the excerpt is for a text the writer changes: an article keeps the excerpt it has, whatever its length", async () => {
    const cookie = await editor();
    // As the import leaves `daffa-najwan`: a WordPress testimonial whose excerpt is 14 characters.
    const short = "Manajemen, UGM";
    const imported = await seed({ slug: "pendek", excerpt: short, title: "Daffa", published_at: Date.parse("2025-03-04T00:00:00Z") });
    const id = imported.id as string;
    const send = (excerpt: string, extra: Record<string, unknown> = {}) => put(cookie, id, { excerpt, date: "2025-03-04", ...extra });

    // Unchanged (also with spaces around it, which are trimmed first): accepted, while the rest of the form changes.
    const kept = await send(short, { title: "Daffa Najwan" });
    expect(kept.status, JSON.stringify(await kept.clone().json())).toBe(200);
    expect(((await kept.json()) as { item: Item }).item).toMatchObject({ title: "Daffa Najwan", excerpt: short });
    expect((await send(`  ${short}  `, { title: "Daffa Najwan, lagi" })).status).toBe(200);
    expect((await row(id)).excerpt).toBe(short);

    // Changed to something else that is short, or emptied: the rule applies, with the legacy message, next to the other messages.
    for (const excerpt of ["Manajemen", "x", "   "]) {
      const refused = await send(excerpt);
      expect(refused.status, excerpt).toBe(400);
      expect(await fieldsOf(refused), excerpt).toEqual({ excerpt: "Excerpt minimal 20 karakter" });
    }
    const together = await send("Manajemen", { slug: "slug-baru" }); // published: the slug is locked too
    expect(await fieldsOf(together)).toEqual({ excerpt: "Excerpt minimal 20 karakter", slug: "Slug tidak bisa diubah setelah artikel terbit" });
    expect((await row(id)).excerpt).toBe(short);

    // Lengthened to 20 or more: accepted, and from then on that is the excerpt that stays valid.
    expect((await send("Manajemen, Universitas Gadjah Mada")).status).toBe(200);
    expect((await send(short)).status).toBe(400);
    // The maximum is not relaxed for anyone.
    expect(await fieldsOf(await send("x".repeat(501)))).toEqual({ excerpt: "Maksimal 500 karakter" });
  });

  test("a new article never gets the exception: the same short excerpt is refused on create", async () => {
    const cookie = await editor();
    await seed({ slug: "pendek", excerpt: "Manajemen, UGM" });
    const res = await call(LIST, { method: "POST", cookie, json: form({ excerpt: "Manajemen, UGM" }) });
    expect(res.status).toBe(400);
    expect(await fieldsOf(res)).toEqual({ excerpt: "Excerpt minimal 20 karakter" });
  });

  test("body at least 50 characters, and at most the limit", async () => {
    expect((await invalid({ contentMarkdown: "terlalu pendek" })).fields).toEqual({ contentMarkdown: "Isi minimal 50 karakter" });
    expect((await invalid({ contentMarkdown: "x".repeat(BODY_MAX + 1) })).fields).toEqual({ contentMarkdown: "Isi maksimal 12.000 karakter" });
  });

  test("a body of exactly the limit is accepted", async () => {
    const cookie = await editor();
    const res = await call(LIST, { method: "POST", cookie, json: form({ contentMarkdown: "x".repeat(BODY_MAX) }) });
    expect(res.status).toBe(201);
  });

  test("author 2 to 120, category from the fixed list", async () => {
    expect((await invalid({ author: "D" })).fields).toEqual({ author: "Wajib diisi" });
    expect((await invalid({ author: "x".repeat(121) })).fields).toEqual({ author: "Maksimal 120 karakter" });
    expect((await invalid({ category: "Berita" })).fields).toEqual({ category: "Kategori tidak dikenal" });
    expect((await invalid({ category: "tips" })).fields).toEqual({ category: "Kategori tidak dikenal" });
  });

  test("the date is a real day written YYYY-MM-DD", async () => {
    for (const date of ["21-05-2026", "2026/05/21", "2026-5-21", "2026-02-31", "2026-13-01", "besok", "2026-05-21T10:00"]) {
      expect((await invalid({ date })).fields, date).toEqual({ date: "Format harus YYYY-MM-DD" });
    }
    expect(isIsoDay("2024-02-29")).toBe(true);
    expect(isIsoDay("2026-02-29")).toBe(false);
  });

  test("the hero must be one of our blog uploads or a file of the legacy blog", async () => {
    const message = "Berkas tidak valid. Unggah ulang berkasnya.";
    const id = crypto.randomUUID();
    for (const image of ["http://example.org/a.png", "https://example.org/a.png", "javascript:alert(1)", `/uploads/team-photo/2026/${id}-a.png`, `/uploads/report/2026/${id}-a.pdf`, "/uploads/blog-image/2026/a.png", "/images/logo.png", "/blog/images/../../etc/passwd", "x".repeat(501)]) {
      expect((await invalid({ image })).fields, image).toEqual({ image: message });
    }
  });

  test("a missing field is one of ours, never zod's English; unknown fields are ignored", async () => {
    const cookie = await editor();
    const { title: _title, ...withoutTitle } = form();
    const res = await call(LIST, { method: "POST", cookie, json: withoutTitle });
    expect(res.status).toBe(400);
    expect(await fieldsOf(res)).toEqual({ title: "Wajib diisi." });
    expect((await call(LIST, { method: "POST", cookie, json: form({ nonsense: 1 }) })).status).toBe(201);
  });

  test("a body that is not JSON is refused (this is what stops a cross-site form post)", async () => {
    const cookie = await editor();
    const urlencoded = await call(LIST, { method: "POST", cookie, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "title=Halo" });
    const plain = await call(LIST, { method: "POST", cookie, headers: { "content-type": "text/plain" }, body: JSON.stringify(form()) });
    const broken = await call(LIST, { method: "POST", cookie, headers: { "content-type": "application/json" }, body: "{nope" });
    expect([urlencoded.status, plain.status, broken.status]).toEqual([415, 415, 400]);
    expect(await count("blog_posts")).toBe(0);
  });

  test("a body above the request limit is refused before it is parsed", async () => {
    const cookie = await editor();
    const res = await call(LIST, { method: "POST", cookie, json: form({ padding: "x".repeat(130 * 1024) }) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too_large", maxBytes: 128 * 1024 });
  });
});

// ---------------------------------------------------------------------------------------------- read

describe("blog: list and one", () => {
  test("the list is an envelope of short items: never the markdown or the HTML", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    await seed({ slug: "a", title: "Satu", excerpt: "Awal kalimat yang panjang [&hellip;]", updated_at: 2000 });
    const spy = spyOnD1(env.DB);
    const res = await call(LIST, { cookie, env: { DB: spy.db } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[]; page: number; pageSize: number; total: number };
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(Object.keys(body.items[0]!).sort()).toEqual(["author", "category", "createdAt", "date", "excerpt", "featured", "id", "slug", "status", "title", "updatedAt"]);
    // The legacy list showed the excerpt without the WordPress trailer.
    expect(body.items[0]).toMatchObject({ excerpt: "Awal kalimat yang panjang ...", date: "2026-01-01", status: "published" });
    // One round trip of two statements, and neither names a long column.
    const [event] = spy.touching("blog_posts");
    expect(spy.touching("blog_posts")).toHaveLength(1);
    expect(event).toMatchObject({ kind: "batch" });
    expect(event!.sql).toHaveLength(2);
    expect(event!.sql.join(" ")).not.toMatch(/content_markdown|content_html/);
  });

  test("filters by status and category, searches the title and the excerpt, sorts by a whitelist, newest edit first", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    await seed({ slug: "alpha", title: "Alpha", category: "Tips", status: "published", updated_at: 1000 });
    await seed({ slug: "beta", title: "Beta", excerpt: "tentang cari-aku di dalam ringkasan", category: "Cerita", status: "draft", published_at: null, updated_at: 2000 });
    await seed({ slug: "gamma", title: "Gamma", category: "Tips", status: "draft", published_at: null, updated_at: 3000 });
    const titles = async (query: string) => ((await (await call(`${LIST}${query}`, { cookie })).json()) as { items: { title: string }[] }).items.map((a) => a.title);

    expect(await titles("")).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(await titles("?status=draft")).toEqual(["Gamma", "Beta"]);
    expect(await titles("?status=published")).toEqual(["Alpha"]);
    expect(await titles("?category=Tips")).toEqual(["Gamma", "Alpha"]);
    expect(await titles("?category=Tips&status=draft")).toEqual(["Gamma"]);
    expect(await titles("?q=cari-aku")).toEqual(["Beta"]); // the excerpt
    expect(await titles("?q=ALPHA")).toEqual(["Alpha"]); // the title, any case
    expect(await titles("?sort=title")).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(await titles("?sort=-title&pageSize=2")).toEqual(["Gamma", "Beta"]);
    expect(await titles("?page=2&pageSize=2")).toEqual(["Alpha"]);

    for (const bad of ["?status=archived", "?category=Berita", "?sort=contentMarkdown", "?sort=-wpId"]) expect((await call(`${LIST}${bad}`, { cookie })).status, bad).toBe(400);
  });

  test("a draft shows its date only when the writer gave one", async () => {
    const cookie = await editor();
    const dated = await createDraft(cookie, { date: "2026-03-04" });
    const undated = await createDraft(cookie);
    const list = (await (await call(LIST, { cookie })).json()) as { items: { id: string; date: string | null }[] };
    expect(Object.fromEntries(list.items.map((i) => [i.id, i.date]))).toEqual({ [dated.id]: "2026-03-04", [undated.id]: null });
  });

  test("one item with its ETag and the markdown, never the HTML; 404 for a missing one", async () => {
    const cookie = await signedInCookie(uniqueEmail("viewer"), "viewer");
    const seeded = await seed({ slug: "satu", content_html: "<p>RAHASIA-HTML</p>", wp_id: 77, source_url: "https://example.org/lama" });
    const res = await call(`${LIST}/${seeded.id}`, { cookie });
    expect(res.status).toBe(200);
    const { item } = (await res.json()) as { item: Item };
    expect(item).toMatchObject({ id: seeded.id, slug: "satu", contentMarkdown: BODY, status: "published", date: "2026-01-01" });
    expect(JSON.stringify(item)).not.toMatch(/RAHASIA-HTML|wpId|sourceUrl|example\.org\/lama/);
    expect(res.headers.get("etag")).toBe(`"${item.updatedAt}"`);
    expect((await call(`${LIST}/missing`, { cookie })).status).toBe(404);
    expect((await call(`${LIST}/${"x".repeat(129)}`, { cookie })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------- update

describe("blog: update", () => {
  test("replaces the form, re-renders when the text changed, and writes one audit row of the names that changed", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    const res = await put(cookie, item.id, { title: "Judul Baru", contentMarkdown: `${BODY}\n\nParagraf tambahan yang baru.`, featured: true });
    expect(res.status).toBe(200);
    const updated = ((await res.json()) as { item: Item }).item;
    expect(updated).toMatchObject({ title: "Judul Baru", featured: true, slug: item.slug });
    expect(updated.updatedAt > item.updatedAt).toBe(true);
    expect(res.headers.get("etag")).toBe(`"${updated.updatedAt}"`);
    expect((await row(item.id)).content_html).toBe(renderArticle(`${BODY}\n\nParagraf tambahan yang baru.`).html);

    const audit = await auditRows();
    expect(audit.map((r) => r.action)).toEqual(["blog.create", "blog.update"]);
    expect(JSON.parse(audit[1]!.metadata)).toEqual({ fields: ["title", "contentMarkdown", "contentHtml", "featured"], label: "Judul Baru" });
    expect(audit[1]!.metadata).not.toContain("Paragraf tambahan");
  });

  test("a change of title or category alone costs no render: the stored HTML stays", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    await env.DB.prepare("UPDATE blog_posts SET content_html = '<p>TANDA</p>' WHERE id = ?").bind(item.id).run();
    expect((await put(cookie, item.id, { title: "Judul Lain" })).status).toBe(200);
    expect((await row(item.id)).content_html).toBe("<p>TANDA</p>");
    // The text changes: rendered again.
    expect((await put(cookie, item.id, { title: "Judul Lain", contentMarkdown: `${BODY}\n\nLebih banyak.` })).status).toBe(200);
    expect((await row(item.id)).content_html).toBe(renderArticle(`${BODY}\n\nLebih banyak.`).html);
  });

  test("a save that changes nothing writes nothing: no new version, no audit row", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    const before = await row(item.id);
    const res = await put(cookie, item.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { item: Item }).item.updatedAt).toBe(item.updatedAt);
    expect((await row(item.id)).updated_at).toBe(before.updated_at);
    expect((await auditRows()).map((r) => r.action)).toEqual(["blog.create"]);
  });

  test("needs If-Match (428); a stale one is refused (409) without a trace", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    const first = await ifMatch(item.id);

    expect((await call(`${LIST}/${item.id}`, { method: "PUT", cookie, json: form() })).status).toBe(428);
    expect((await call(`${LIST}/${item.id}`, { method: "PUT", cookie, headers: first, json: form({ title: "Versi pertama" }) })).status).toBe(200);
    const late = await call(`${LIST}/${item.id}`, { method: "PUT", cookie, headers: first, json: form({ title: "Versi kedua" }) });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale", message: expect.stringContaining("diubah orang lain") });
    expect((await row(item.id)).title).toBe("Versi pertama");
    expect((await auditRows()).map((r) => r.action)).toEqual(["blog.create", "blog.update"]);
  });

  test("two saves of one version cannot both win", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    const headers = await ifMatch(item.id);
    const results = await Promise.all([
      call(`${LIST}/${item.id}`, { method: "PUT", cookie, headers, json: form({ title: "Dari satu" }) }),
      call(`${LIST}/${item.id}`, { method: "PUT", cookie, headers, json: form({ title: "Dari dua" }) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await auditRows()).filter((r) => r.action === "blog.update")).toHaveLength(1);
  });

  test("404 for a missing article; the body is checked before the row is read", async () => {
    const cookie = await editor();
    expect((await call(`${LIST}/missing`, { method: "PUT", cookie, headers: { "if-match": '"2026-01-01T00:00:00.000Z"' }, json: form() })).status).toBe(404);
    const bad = await call(`${LIST}/missing`, { method: "PUT", cookie, headers: { "if-match": '"2026-01-01T00:00:00.000Z"' }, json: form({ title: "ab" }) });
    expect(bad.status).toBe(400);
  });

  test("the slug can change while the article is a draft, and not once it is published", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    const renamed = await put(cookie, item.id, { slug: "judul-yang-lebih-baik" });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { item: Item }).item.slug).toBe("judul-yang-lebih-baik");

    expect((await verb(cookie, item.id, "publish")).status).toBe(200);
    const locked = await put(cookie, item.id, { slug: "slug-baru", date: isoDayJakarta(Date.now()) });
    expect(locked.status).toBe(400);
    expect(await fieldsOf(locked)).toEqual({ slug: "Slug tidak bisa diubah setelah artikel terbit" });
    expect((await row(item.id)).slug).toBe("judul-yang-lebih-baik");
    // Sending the slug it already has is not a change.
    expect((await put(cookie, item.id, { slug: "judul-yang-lebih-baik", date: isoDayJakarta(Date.now()), title: "Judul Baru Lagi" })).status).toBe(200);
    // Back to a draft, it can change again.
    expect((await verb(cookie, item.id, "unpublish")).status).toBe(200);
    expect((await put(cookie, item.id, { slug: "slug-baru", date: isoDayJakarta(Date.now()), title: "Judul Baru Lagi" })).status).toBe(200);
    expect((await row(item.id)).slug).toBe("slug-baru");
  });

  test("a slug taken by another article is a 409 on the slug, with nothing written", async () => {
    const cookie = await editor();
    const a = await createDraft(cookie, { slug: "pertama" });
    const b = await createDraft(cookie, { slug: "kedua" });
    const res = await put(cookie, b.id, { slug: "pertama" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "conflict", fields: { slug: "Slug sudah dipakai" } });
    expect((await row(b.id)).slug).toBe("kedua");
    expect((await row(a.id)).slug).toBe("pertama");
    expect((await auditRows()).map((r) => r.action)).toEqual(["blog.create", "blog.create"]);
  });

  test("a published article needs its date; the same day keeps the instant, another day is 00:00 in Jakarta", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    expect((await verb(cookie, item.id, "publish")).status).toBe(200);
    const published = await row(item.id);
    const today = isoDayJakarta(published.published_at as number);

    const missing = await put(cookie, item.id, { date: "" });
    expect(missing.status).toBe(400);
    expect(await fieldsOf(missing)).toEqual({ date: "Format harus YYYY-MM-DD" });

    // The same day: the instant (and so the order among the day's articles) is kept.
    expect((await put(cookie, item.id, { date: today, title: "Judul lain" })).status).toBe(200);
    expect((await row(item.id)).published_at).toBe(published.published_at);

    // Another day.
    const moved = await put(cookie, item.id, { date: "2026-02-03", title: "Judul lain" });
    expect(((await moved.json()) as { item: Item }).item.date).toBe("2026-02-03");
    expect((await row(item.id)).published_at).toBe(Date.parse("2026-02-02T17:00:00.000Z"));
  });

  test("a draft can lose its date again", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie, { date: "2026-02-03" });
    const res = await put(cookie, item.id, { date: "" });
    expect(((await res.json()) as { item: Item }).item.date).toBeNull();
    expect((await row(item.id)).published_at).toBeNull();
  });

  test("featured is the legacy flag: more than one article can carry it, and the public index picks the newest", async () => {
    const cookie = await editor();
    const older = await createDraft(cookie, { title: "Artikel Lama", featured: true, date: "2026-01-10" });
    const newer = await createDraft(cookie, { title: "Artikel Baru", featured: true, date: "2026-02-20" });
    const plain = await createDraft(cookie, { title: "Artikel Biasa", date: "2026-03-30" });
    for (const item of [older, newer, plain]) expect((await verb(cookie, item.id, "publish")).status).toBe(200);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM blog_posts WHERE featured = 1").first<{ n: number }>()).toEqual({ n: 2 });

    const list = (await (await internalFetch("/api/public/blog")).json()) as { featured: { slug: string }; articles: { slug: string }[] };
    expect(list.featured.slug).toBe(newer.slug);
    expect(list.articles.map((a) => a.slug)).toEqual([plain.slug, older.slug]);
  });
});

// -------------------------------------------------------------------------------- publish and unpublish

describe("blog: publish and unpublish", () => {
  test("publishing dates an undated draft now, makes it public, and writes blog.publish", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    const gone = await internalFetch(`/api/public/blog/${item.slug}`);
    expect(gone.status).toBe(404); // a draft has no public existence

    const before = Date.now();
    const res = await verb(cookie, item.id, "publish");
    expect(res.status).toBe(200);
    const published = ((await res.json()) as { item: Item }).item;
    expect(published).toMatchObject({ status: "published", date: isoDayJakarta(before) });
    const stored = await row(item.id);
    expect(stored.status).toBe("published");
    expect(stored.published_at).toBeGreaterThanOrEqual(before - 5);
    expect(stored.published_at).toBeLessThanOrEqual(Date.now() + 5);
    expect(published.updatedAt > item.updatedAt).toBe(true);

    const audit = await auditRows();
    expect(audit.map((r) => r.action)).toEqual(["blog.create", "blog.publish"]);
    expect(JSON.parse(audit[1]!.metadata)).toEqual({ fields: ["status", "publishedAt"], label: item.title });

    // The public API serves it now, with the stored HTML, without a build.
    const live = await internalFetch(`/api/public/blog/${item.slug}`);
    expect(live.status).toBe(200);
    const body = (await live.json()) as { article: { slug: string; contentHtml: string; dateISO: string; author: string; contentMarkdown: string } };
    expect(body.article).toMatchObject({ slug: item.slug, contentHtml: renderArticle(BODY).html, dateISO: isoDayJakarta(before), author: "Dzul", contentMarkdown: BODY });
    const index = (await (await internalFetch("/api/public/blog")).json()) as { featured: { slug: string } };
    expect(index.featured.slug).toBe(item.slug);
  });

  test("publishing keeps the day the writer chose; unpublishing keeps it too, so publishing again does not move the article", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie, { date: "2026-02-03" });
    const first = ((await (await verb(cookie, item.id, "publish")).json()) as { item: Item }).item;
    expect(first.date).toBe("2026-02-03");
    expect((await row(item.id)).published_at).toBe(Date.parse("2026-02-02T17:00:00.000Z"));

    const off = await verb(cookie, item.id, "unpublish");
    expect(((await off.json()) as { item: Item }).item).toMatchObject({ status: "draft", date: "2026-02-03" });
    expect((await row(item.id)).published_at).toBe(Date.parse("2026-02-02T17:00:00.000Z"));
    expect(JSON.parse((await auditRows()).at(-1)!.metadata)).toEqual({ fields: ["status"], label: item.title });
    expect((await internalFetch(`/api/public/blog/${item.slug}`)).status).toBe(404); // gone from the site again

    const again = await verb(cookie, item.id, "publish");
    expect(((await again.json()) as { item: Item }).item).toMatchObject({ status: "published", date: "2026-02-03" });
    // The date was there already: only the status is a change.
    expect(JSON.parse((await auditRows()).at(-1)!.metadata)).toEqual({ fields: ["status"], label: item.title });
  });

  test("both need If-Match (428) and refuse a stale version (409): the writer publishes what they saw", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    expect((await call(`${LIST}/${item.id}/publish`, { method: "POST", cookie })).status).toBe(428);
    expect((await call(`${LIST}/${item.id}/unpublish`, { method: "POST", cookie })).status).toBe(428);

    const old = await ifMatch(item.id);
    expect((await put(cookie, item.id, { title: "Diubah orang lain" })).status).toBe(200);
    const stale = await call(`${LIST}/${item.id}/publish`, { method: "POST", cookie, headers: old });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "stale" });
    expect((await row(item.id)).status).toBe("draft");
    expect((await auditRows()).map((r) => r.action)).toEqual(["blog.create", "blog.update"]);
  });

  test("a status that is already the wanted one is answered without a write or an audit row", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    const draftAgain = await verb(cookie, item.id, "unpublish");
    expect(draftAgain.status).toBe(200);
    expect(((await draftAgain.json()) as { item: Item }).item.updatedAt).toBe(item.updatedAt);
    await verb(cookie, item.id, "publish");
    const versions = (await row(item.id)).updated_at;
    const again = await verb(cookie, item.id, "publish");
    expect(again.status).toBe(200);
    expect((await row(item.id)).updated_at).toBe(versions);
    expect((await auditRows()).map((r) => r.action)).toEqual(["blog.create", "blog.publish"]);
  });

  test("404 for a missing article", async () => {
    const cookie = await editor();
    expect((await call(`${LIST}/missing/publish`, { method: "POST", cookie, headers: { "if-match": '"2026-01-01T00:00:00.000Z"' } })).status).toBe(404);
  });

  test("an edit of a published article reaches the public API at once; a draft edit does not exist there", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie, { date: "2026-02-03" });
    await verb(cookie, item.id, "publish");
    await put(cookie, item.id, { date: "2026-02-03", title: "Judul Berubah", contentMarkdown: `${BODY}\n\nTambahan baru.` });
    const body = (await (await internalFetch(`/api/public/blog/${item.slug}`)).json()) as { article: { title: string; contentHtml: string } };
    expect(body.article.title).toBe("Judul Berubah");
    expect(body.article.contentHtml).toContain("Tambahan baru.");
  });
});

// ---------------------------------------------------------------------------------------------- delete

describe("blog: delete", () => {
  test("removes the article, writes blog.delete with the title as label, and the page is gone from the site", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie, { date: "2026-02-03" });
    await verb(cookie, item.id, "publish");
    expect((await internalFetch(`/api/public/blog/${item.slug}`)).status).toBe(200);

    expect((await call(`${LIST}/${item.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await count("blog_posts")).toBe(0);
    expect((await internalFetch(`/api/public/blog/${item.slug}`)).status).toBe(404);
    const audit = (await auditRows()).at(-1)!;
    expect(audit).toMatchObject({ action: "blog.delete", resource_type: "blog", resource_id: item.id });
    expect(JSON.parse(audit.metadata)).toEqual({ label: item.title });
    expect((await call(`${LIST}/${item.id}`, { method: "DELETE", cookie })).status).toBe(404);
  });

  test("a version that changed after the list was loaded is refused as stale", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie);
    const old = await ifMatch(item.id);
    await put(cookie, item.id, { title: "Diubah" });
    const res = await call(`${LIST}/${item.id}`, { method: "DELETE", cookie, headers: old });
    expect(res.status).toBe(409);
    expect(await count("blog_posts")).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------- the public side is told

describe("blog: the public site is told when a published article changes", () => {
  function spies() {
    const notify = vi.fn<(change: ContentChange) => void>();
    const deleteUpload = vi.fn(async () => ({ status: "not_found" as const }));
    const deps: CrudDeps = { notify: (change) => notify(change), deleteUpload };
    return { notify, deleteUpload, app: appAround({ "/api/admin/blog": createBlogRoutes(deps) }) };
  }

  test("publish, an edit of a published article, unpublish and delete each ask for a purge of the article; a draft's own edits do not", async () => {
    const { notify, app } = spies();
    const cookie = await editor();
    const created = await post(cookie, {}, app);
    const item = created.body.item;
    await put(cookie, item.id, { title: "Masih draf" }, app);
    expect(notify).not.toHaveBeenCalled();

    await verb(cookie, item.id, "publish", app);
    expect(notify.mock.calls.map(([c]) => c)).toEqual([{ area: "blog", slug: item.slug }]);
    notify.mockClear();

    await put(cookie, item.id, { title: "Sudah terbit", date: isoDayJakarta(Date.now()) }, app);
    await verb(cookie, item.id, "unpublish", app);
    expect(notify.mock.calls.map(([c]) => c)).toEqual([
      { area: "blog", slug: item.slug },
      { area: "blog", slug: item.slug },
    ]);
    notify.mockClear();

    await verb(cookie, item.id, "publish", app);
    notify.mockClear();
    await call(`${LIST}/${item.id}`, { method: "DELETE", cookie, via: app });
    expect(notify.mock.calls.map(([c]) => c)).toEqual([{ area: "blog", slug: item.slug }]);
  });

  test("deleting a draft touches nothing public", async () => {
    const { notify, app } = spies();
    const cookie = await editor();
    const item = (await post(cookie, {}, app)).body.item;
    await call(`${LIST}/${item.id}`, { method: "DELETE", cookie, via: app });
    expect(notify).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------- images

describe("blog: the hero image", () => {
  test("an upload is accepted and its size is read from `media`, never from the client", async () => {
    const cookie = await editor();
    const image = await uploadImage(cookie, 640, 360);
    const item = await createDraft(cookie, { image: image.path, imageWidth: 9999, imageHeight: 9999 });
    expect(item).toMatchObject({ image: image.path, imageWidth: 640, imageHeight: 360 });
    expect(await row(item.id)).toMatchObject({ image: image.path, image_width: 640, image_height: 360 });
    // The public API carries the recorded size to the site.
    await verb(cookie, item.id, "publish");
    const { article } = (await (await internalFetch(`/api/public/blog/${item.slug}`)).json()) as { article: { image: string; imageWidth: number; imageHeight: number } };
    expect(article).toMatchObject({ image: image.path, imageWidth: 640, imageHeight: 360 });
  });

  test("a GIF is a blog image (the legacy blog took them)", async () => {
    const cookie = await editor();
    const res = await upload({ kind: "blog-image", bytes: new Uint8Array([...new TextEncoder().encode("GIF89a"), 0xe0, 0x01, 0x10, 0x01, 0, 0, 0, 0x3b]), filename: "animasi.gif", claimedType: "image/gif", cookie });
    expect(res.status).toBe(201);
    const gif = (await res.json()) as Uploaded;
    expect(gif).toMatchObject({ contentType: "image/gif", width: 480, height: 272 });
    expect(await createDraft(cookie, { image: gif.path })).toMatchObject({ image: gif.path, imageWidth: 480, imageHeight: 272 });
  });

  test("an upload path that has no `media` row is refused", async () => {
    const cookie = await editor();
    const res = await call(LIST, { method: "POST", cookie, json: form({ image: `/uploads/blog-image/2026/${crypto.randomUUID()}-hilang.png` }) });
    expect(res.status).toBe(400);
    expect(await fieldsOf(res)).toEqual({ image: "Berkas tidak valid. Unggah ulang berkasnya." });
    expect(await count("blog_posts")).toBe(0);
  });

  test("a file of the legacy blog is accepted, with the size the asset pipeline knows; saving again keeps it", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie, { image: "/blog/images/2024/10/img-daffa.png" });
    expect(item).toMatchObject({ image: "/blog/images/2024/10/img-daffa.png", imageWidth: 419, imageHeight: 420 });
    const again = await put(cookie, item.id, { image: "/blog/images/2024/10/img-daffa.png", title: "Judul lain" });
    expect(((await again.json()) as { item: Item }).item).toMatchObject({ imageWidth: 419, imageHeight: 420 });
    // Five files of the blog have an `@` in their names (the one of "Azkiya Najwah" is a cover): accepted, with their size.
    const at = await createDraft(cookie, { image: "/blog/images/2026/04/IMG_9167@-1353469099-Azkiya-Najwah-3-scaled.jpg" });
    expect(at.image).toBe("/blog/images/2026/04/IMG_9167@-1353469099-Azkiya-Najwah-3-scaled.jpg");
    expect(at.imageWidth).toBeGreaterThan(100);
    expect(at.imageHeight).toBeGreaterThan(100);
    // A legacy path the table does not know has no size (both or neither: the database's rule).
    const unknown = await createDraft(cookie, { image: "/blog/images/2099/01/tidak-ada.png" });
    expect(unknown).toMatchObject({ imageWidth: null, imageHeight: null });
  });

  test("replacing or removing the hero deletes the old upload after the save; one still used is kept", async () => {
    const cookie = await editor();
    const first = await uploadImage(cookie, 100, 100, "satu.png");
    const second = await uploadImage(cookie, 200, 150, "dua.png");
    const item = await createDraft(cookie, { image: first.path });
    expect(await objectKeys()).toHaveLength(2);

    expect((await put(cookie, item.id, { image: second.path })).status).toBe(200);
    expect(await objectKeys()).toEqual([second.path.slice(1)]);
    expect((await mediaRows()).map((m) => m.key)).toEqual([second.path.slice(1)]);
    expect(await row(item.id)).toMatchObject({ image: second.path, image_width: 200, image_height: 150 });

    expect((await put(cookie, item.id, { image: null })).status).toBe(200);
    expect(await objectKeys()).toEqual([]);
    expect(await row(item.id)).toMatchObject({ image: null, image_width: null, image_height: null });

    // A hero the markdown also shows is not deleted from under it.
    const shared = await uploadImage(cookie, 300, 200, "bersama.png");
    const other = await createDraft(cookie, { title: "Artikel Lain", image: shared.path, contentMarkdown: `${BODY}\n\n![bersama](${shared.path})` });
    await put(cookie, other.id, { title: "Artikel Lain", image: null, contentMarkdown: `${BODY}\n\n![bersama](${shared.path})` });
    expect(await objectKeys()).toEqual([shared.path.slice(1)]);
  });
});

describe("blog: images inside the text", () => {
  test("an upload in the markdown gets the width and height recorded for it", async () => {
    const cookie = await editor();
    const image = await uploadImage(cookie, 800, 450);
    const item = await createDraft(cookie, { contentMarkdown: `${BODY}\n\n![Siswa belajar](${image.path})` });
    const html = (await row(item.id)).content_html as string;
    expect(html).toContain(`<span class="block my-6 relative w-full max-w-full"><img src="${image.path}" alt="Siswa belajar" width="800" height="450" loading="lazy" decoding="async" class="rounded-xl w-full h-auto"></span>`);
  });

  test("an image of the legacy blog keeps its srcset, width and height when the article is saved again", async () => {
    const cookie = await editor();
    const item = await createDraft(cookie, { contentMarkdown: `${BODY}\n\n![Daffa](/blog/images/2024/10/img-daffa.png)` });
    expect((await row(item.id)).content_html).toMatch(/srcset="\/_img\/cd6953e6ff48-419\.webp 419w" sizes="[^"]+" width="419" height="420"/);
  });

  test("an inline upload that the text no longer shows is deleted after the save, and the delete of the article removes what it held", async () => {
    const cookie = await editor();
    const a = await uploadImage(cookie, 100, 100, "a.png");
    const b = await uploadImage(cookie, 100, 100, "b.png");
    const item = await createDraft(cookie, { contentMarkdown: `${BODY}\n\n![a](${a.path})\n\n![b](${b.path})` });
    expect(await objectKeys()).toHaveLength(2);

    expect((await put(cookie, item.id, { contentMarkdown: `${BODY}\n\n![b](${b.path})` })).status).toBe(200);
    expect(await objectKeys()).toEqual([b.path.slice(1)]);

    expect((await call(`${LIST}/${item.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await objectKeys()).toEqual([]);
    expect(await mediaRows()).toEqual([]);
  });

  test("a file the article uses cannot be deleted from the upload API while it does (the reference registry covers the blog)", async () => {
    const cookie = await editor();
    const image = await uploadImage(cookie, 100, 100);
    await createDraft(cookie, { contentMarkdown: `${BODY}\n\n![a](${image.path})` });
    const res = await call(`/api/admin/uploads/${image.id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "in_use", usedBy: ["Blog"] });
  });

  test("uploadsOf lists the hero and every upload the markdown mentions, once", () => {
    const id = "0a1b2c3d-1111-4222-8333-444455556666";
    const a = `/uploads/blog-image/2026/${id}-a.png`;
    const b = `/uploads/blog-image/2026/${id.replace("0a1b", "ffff")}-b.gif`;
    expect(uploadsOf({ image: a, contentMarkdown: `x ![a](${a}) ![b](${b}) ![a](${a}) ![legacy](/blog/images/2024/10/img-daffa.png)` })).toEqual([a, b]);
    expect(uploadsOf({ image: null, contentMarkdown: "tanpa gambar" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- preview

describe("blog: preview", () => {
  const preview = (cookie: string, markdown: unknown) => call(`${LIST}/preview`, { method: "POST", cookie, json: { contentMarkdown: markdown } });

  test("returns the HTML a save would store, and saves nothing", async () => {
    const cookie = await editor();
    const res = await preview(cookie, `${BODY}\n\n[tautan](https://example.org)`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ html: renderArticle(`${BODY}\n\n[tautan](https://example.org)`).html });
    expect(await count("blog_posts")).toBe(0);
    expect(await count("audit_log")).toBe(0);
  });

  test("is sanitised like a save: no script URLs, no raw HTML, no foreign images", async () => {
    const cookie = await editor();
    const { html } = (await (await preview(cookie, "[a](javascript:alert(1)) <script>alert(2)</script> <img src=x onerror=alert(3)> ![b](http://example.org/b.png) ![c](data:image/png;base64,AAAA)")).json()) as { html: string };
    expect(html).not.toMatch(/javascript|<script|onerror|<img|data:/i);
  });

  test("shows an upload with the size recorded for it, as a save does", async () => {
    const cookie = await editor();
    const image = await uploadImage(cookie, 700, 300);
    const { html } = (await (await preview(cookie, `![x](${image.path})`)).json()) as { html: string };
    expect(html).toContain('width="700" height="300"');
  });

  test("an empty text is empty HTML; a text above the limit is a 400 on the body; not JSON is refused", async () => {
    const cookie = await editor();
    expect(await (await preview(cookie, "   ")).json()).toEqual({ html: "" });
    const big = await preview(cookie, "x".repeat(BODY_MAX + 1));
    expect(big.status).toBe(400);
    expect(await fieldsOf(big)).toEqual({ contentMarkdown: "Isi maksimal 12.000 karakter" });
    expect((await preview(cookie, 5)).status).toBe(400);
    expect((await call(`${LIST}/preview`, { method: "POST", cookie, headers: { "content-type": "text/plain" }, body: BODY })).status).toBe(415);
  });

  test("costs no D1 round trip when the text mentions no upload", async () => {
    const cookie = await editor();
    const spy = spyOnD1(env.DB);
    const res = await call(`${LIST}/preview`, { method: "POST", cookie, json: { contentMarkdown: BODY }, env: { DB: spy.db } });
    expect(res.status).toBe(200);
    expect(spy.touching("blog_posts")).toEqual([]);
    expect(spy.touching("media")).toEqual([]);
  });

  describe("its limiter (RL_BLOG_PREVIEW)", () => {
    const send = (cookie: string, extra: Record<string, unknown> = {}) => call(`${LIST}/preview`, { method: "POST", cookie, json: { contentMarkdown: "x" }, ...extra });

    test("counts per signed-in user, whatever the address: the key is blog-preview:<user id>", async () => {
      const email = uniqueEmail("editor");
      const cookie = await signedInCookie(email, "editor", ["konten"]);
      const userId = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;
      const keys: string[] = [];
      const binding = {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: true };
        },
      } as unknown as RateLimit;
      expect((await send(cookie, { env: { RL_BLOG_PREVIEW: binding }, ip: "203.0.113.31" })).status).toBe(200);
      expect((await send(cookie, { env: { RL_BLOG_PREVIEW: binding }, ip: "203.0.113.32" })).status).toBe(200);
      expect(keys).toEqual([`blog-preview:${userId}`, `blog-preview:${userId}`]);
    });

    test("a refusal is the 429 of the other limiters, decided before the body is read, and only for the preview", async () => {
      const cookie = await editor();
      const full = { limit: async () => ({ success: false }) } as unknown as RateLimit;
      // Not even JSON: a limiter that ran after the body was read would answer 400.
      const res = await call(`${LIST}/preview`, { method: "POST", cookie, headers: { "content-type": "application/json" }, body: "{not json", env: { RL_BLOG_PREVIEW: full } });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("60");
      expect(await res.json()).toEqual({ error: "rate_limited", message: "Terlalu banyak permintaan pratinjau. Silakan tunggu satu menit lalu coba lagi.", retryAfterSeconds: 60 });

      // The same binding says nothing about saving or reading: the preview is the only route that asks it.
      expect((await call(LIST, { method: "POST", cookie, json: form(), env: { RL_BLOG_PREVIEW: full } })).status).toBe(201);
      expect((await call(LIST, { cookie, env: { RL_BLOG_PREVIEW: full } })).status).toBe(200);
    });

    test("a roles refusal comes first: a viewer gets 403 and a visitor 401, neither is counted", async () => {
      const asked: string[] = [];
      const spy = { limit: async ({ key }: { key: string }) => (asked.push(key), { success: true }) } as unknown as RateLimit;
      const viewer = await signedInCookie(uniqueEmail("viewer"), "viewer");
      expect((await send(viewer, { env: { RL_BLOG_PREVIEW: spy } })).status).toBe(403);
      expect((await send("", { env: { RL_BLOG_PREVIEW: spy } })).status).toBe(401);
      expect(asked).toEqual([]);
    });

    test("without the binding a local run counts in memory with the same numbers (60 a minute, per user); production would refuse", async () => {
      const cookie = await editor();
      const other = await editor();
      // The fallback's window lasts a minute by the wall clock from the first preview: frozen, a slow run cannot outlast it.
      await withFrozenDate(async () => {
        const statuses: number[] = [];
        for (let i = 0; i < 61; i++) statuses.push((await send(cookie, { env: { RL_BLOG_PREVIEW: undefined }, ip: "203.0.113.40" })).status);
        expect(statuses).toEqual([...Array(60).fill(200), 429]);

        // Another person is not held back by it.
        expect((await send(other, { env: { RL_BLOG_PREVIEW: undefined }, ip: "203.0.113.40" })).status).toBe(200);
      });

      // The same lookup in production: no binding, nothing throttles, so the request is refused (503), not allowed.
      expect(await checkLimits({ ENVIRONMENT: "production" }, [{ name: "blogPreview", key: "blog-preview:someone" }])).toEqual({ allowed: false, reason: "unavailable", name: "blogPreview" });
    }, 30_000);

    test("through the Worker in production, a deploy that lost the binding refuses the preview (503) and renders nothing; with the binding it answers", async () => {
      fakeNetwork(); // a sign-in in production asks Turnstile
      const email = uniqueEmail("editor");
      await createVerifiedUser(email, "editor", ["konten"]);
      // A session made in production mode: its cookie has the __Host- name, which a development-mode Worker would not read.
      const signedIn = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD }, env: productionLike, captcha: CAPTCHA });
      expect(signedIn.status).toBe(200);
      const cookie = cookiesOf(signedIn);

      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const refused = await send(cookie, { env: { ...productionLike, RL_BLOG_PREVIEW: undefined } });
      expect(refused.status).toBe(503);
      expect(await refused.json()).toEqual({ error: "service_unavailable" });
      expect(logged).toHaveBeenCalledWith("[rate-limit] binding RL_BLOG_PREVIEW is not configured; refusing the request");
      vi.restoreAllMocks();

      expect((await send(cookie, { env: productionLike })).status).toBe(200);
    });
  });
});

// -------------------------------------------------------------------------------------------- D1 budget

describe("blog: the D1 budget", () => {
  test("create without uploads is two round trips (the slug range, then the insert and audit batch); an update is a read and a batch", async () => {
    const cookie = await editor();
    const create = spyOnD1(env.DB);
    const res = await call(LIST, { method: "POST", cookie, json: form(), env: { DB: create.db } });
    const item = ((await res.json()) as { item: Item }).item;
    expect(create.touching("blog_posts").map((e) => e.kind)).toEqual(["single", "batch"]);
    expect(create.touching("media")).toEqual([]);

    const update = spyOnD1(env.DB);
    await call(`${LIST}/${item.id}`, { method: "PUT", cookie, headers: await ifMatch(item.id), json: form({ title: "Judul lain" }), env: { DB: update.db } });
    expect(update.touching("blog_posts").map((e) => e.kind)).toEqual(["single", "batch"]);
  });

  test("with an upload, one more statement reads every size in one go", async () => {
    const cookie = await editor();
    const a = await uploadImage(cookie, 10, 10, "a.png");
    const b = await uploadImage(cookie, 10, 10, "b.png");
    const spy = spyOnD1(env.DB);
    const res = await call(LIST, { method: "POST", cookie, json: form({ image: a.path, contentMarkdown: `${BODY}\n\n![b](${b.path})` }), env: { DB: spy.db } });
    expect(res.status).toBe(201);
    expect(spy.touching("media")).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------------------------- rules

describe("blog: the pure rules", () => {
  test("slugify is the legacy one, with the trailing hyphen after the cut fixed", () => {
    expect(slugify("Cara Belajar yang Efektif!")).toBe("cara-belajar-yang-efektif");
    expect(slugify("  Café   Résumé  ")).toBe("cafe-resume");
    expect(slugify("a--b---c")).toBe("a-b-c");
    expect(slugify("日本語")).toBe("post");
    expect(slugify("")).toBe("post");
    const cut = slugify(`${"a".repeat(79)} bbb`);
    expect(cut).toBe("a".repeat(79)); // the legacy cut left "aaa...a-", which the database refuses
    expect(slugify("x".repeat(200))).toHaveLength(80);
  });

  test("pickFreeSlug numbers from 2, and gives up after a thousand", () => {
    expect(pickFreeSlug("a", new Set())).toBe("a");
    expect(pickFreeSlug("a", new Set(["a"]))).toBe("a-2");
    expect(pickFreeSlug("a", new Set(["a", "a-2", "a-3"]))).toBe("a-4");
    expect(() => pickFreeSlug("a", new Set(["a", ...Array.from({ length: 999 }, (_, i) => `a-${i + 2}`)]))).toThrow();
  });
});

describe("blog: query plans", () => {
  const plan = async (sql: string, ...binds: unknown[]) => {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...binds)
      .all<{ detail: string }>();
    return results.map((r) => r.detail).join(" | ");
  };

  test("the slug range and the lookup by id are index seeks; the media lookup is one seek per key", async () => {
    expect(await plan("SELECT slug FROM blog_posts WHERE slug >= ? AND slug < ?", "a", "a~")).toMatch(/SEARCH blog_posts USING COVERING INDEX blog_posts_slug_idx/);
    expect(await plan("SELECT * FROM blog_posts WHERE id = ? LIMIT 1", "x")).toMatch(/SEARCH blog_posts USING INDEX sqlite_autoindex_blog_posts_1/);
    expect(await plan("SELECT key, width, height FROM media WHERE key IN (?, ?)", "a", "b")).toMatch(/SEARCH media USING INDEX media_key_idx/);
  });

  test("the list sorts a table that stays small (about 80 articles, a few hundred in years): a scan is the documented choice, no index per sort", async () => {
    // docs/cloudflare/admin-blog.md, "D1 budget": rows read per list view are twice the table, far inside the free daily budget.
    expect(await plan("SELECT id, slug, title FROM blog_posts ORDER BY updated_at DESC, id ASC LIMIT 20")).toMatch(/SCAN blog_posts/);
  });
});
