import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BlogArticle } from "@/lib/blog-types";

// The readers behind each endpoint are mocked at their module boundary, as
// the page code consumes them. Fixture rows deliberately carry the private
// columns the real rows have (author ids, audit timestamps, internal notes):
// the assertions check that none of them reach the wire.
const mocks = vi.hoisted(() => ({
  getAllTeamMembers: vi.fn(),
  getAllReports: vi.fn(),
  getResourcesByCategory: vi.fn(),
  getCurrentAnnouncement: vi.fn(),
  getBlogArticlesSorted: vi.fn(),
  getBlogArticleBySlug: vi.fn(),
}));
vi.mock("@/lib/team", () => ({ getAllTeamMembers: mocks.getAllTeamMembers }));
vi.mock("@/lib/reports", () => ({ getAllReports: mocks.getAllReports }));
vi.mock("@/lib/site-resources", () => ({
  getResourcesByCategory: mocks.getResourcesByCategory,
}));
vi.mock("@/lib/announcements", () => ({
  getCurrentAnnouncement: mocks.getCurrentAnnouncement,
}));
vi.mock("@/lib/blog", () => ({
  getBlogArticlesSorted: mocks.getBlogArticlesSorted,
  getBlogArticleBySlug: mocks.getBlogArticleBySlug,
}));

import { GET as getTeam } from "@/app/api/public/team/route";
import { GET as getReports } from "@/app/api/public/reports/route";
import { GET as getResources } from "@/app/api/public/resources/route";
import { GET as getAnnouncement } from "@/app/api/public/announcements/current/route";
import { GET as getBlogList } from "@/app/api/public/blog/route";
import { GET as getBlogArticle } from "@/app/api/public/blog/[slug]/route";

// Strings that must never appear in any response body.
const PRIVATE = {
  userId: "00000000-aaaa-bbbb-cccc-private-user-id",
  note: "INTERNAL-NOTE-do-not-publish",
  wpId: 5802,
  sourceUrl: "https://wp.example/old-permalink/",
};

const CONTENT_CACHE = "public, s-maxage=60, stale-while-revalidate=300";
const ANNOUNCEMENT_CACHE = "public, s-maxage=30, stale-while-revalidate=60";

const date = new Date("2026-01-01T00:00:00Z");

function keys(o: object): string[] {
  return Object.keys(o).sort();
}

function request(path = "/api/public/blog"): Request {
  return new Request(`https://origin.example${path}`);
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/public/team", () => {
  test("exposes only the profile fields the /tim page shows", async () => {
    mocks.getAllTeamMembers.mockResolvedValue([
      {
        id: "t1",
        name: "Ani Wijaya",
        role: "Ketua",
        image: "/images/team/ani.jpg",
        category: "pengurus",
        bio: "Bio singkat",
        educationHistory: [{ institution: "ITB", degree: "S1", year: "2015" }],
        workHistory: [{ organization: "Yayasan", role: "Ketua", period: "2020-" }],
        displayOrder: 3,
        createdAt: date,
        updatedAt: date,
        email: "ani@example.com",
        phone: "0800000000",
        updatedBy: PRIVATE.userId,
      },
    ]);
    const res = await getTeam();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CONTENT_CACHE);
    expect(keys(body)).toEqual(["members"]);
    expect(keys(body.members[0])).toEqual([
      "bio",
      "category",
      "educationHistory",
      "id",
      "image",
      "name",
      "role",
      "workHistory",
    ]);
    expect(body.members[0].educationHistory).toEqual([
      { institution: "ITB", degree: "S1", year: "2015" },
    ]);
    const wire = JSON.stringify(body);
    expect(wire).not.toContain("ani@example.com");
    expect(wire).not.toContain(PRIVATE.userId);
  });

  test("an empty table is an empty list, not an error", async () => {
    mocks.getAllTeamMembers.mockResolvedValue([]);
    expect(await (await getTeam()).json()).toEqual({ members: [] });
  });
});

describe("GET /api/public/reports", () => {
  test("keeps the reader's order and drops uploader and timestamps", async () => {
    mocks.getAllReports.mockResolvedValue([
      {
        id: "r2",
        title: "Laporan Dampak",
        description: null,
        category: "impact",
        year: "2025/2026",
        filePath: "/reports/2025-2026/impact/laporan.pdf",
        fileSize: 120_000,
        uploadedBy: PRIVATE.userId,
        uploadedAt: date,
      },
      {
        id: "r1",
        title: "Laporan Keuangan",
        description: "Ringkasan",
        category: "financial",
        year: "2025",
        filePath: "/reports/2025/financial/keuangan.pdf",
        fileSize: 5_000,
        uploadedBy: PRIVATE.userId,
        uploadedAt: date,
      },
    ]);
    const res = await getReports();
    const body = await res.json();

    expect(res.headers.get("cache-control")).toBe(CONTENT_CACHE);
    expect(body.reports.map((r: { id: string }) => r.id)).toEqual(["r2", "r1"]);
    expect(keys(body.reports[0])).toEqual([
      "category",
      "description",
      "fileSize",
      "filePath",
      "id",
      "title",
      "year",
    ].sort());
    expect(JSON.stringify(body)).not.toContain(PRIVATE.userId);
  });
});

describe("GET /api/public/resources", () => {
  test("flattens the page's category groups and drops notes and audit fields", async () => {
    const base = {
      description: null,
      displayOrder: 0,
      filePath: null,
      fileSize: null,
      externalUrl: null,
      bodyText: null,
      notes: PRIVATE.note,
      updatedBy: PRIVATE.userId,
      createdAt: date,
      updatedAt: date,
    };
    mocks.getResourcesByCategory.mockResolvedValue([
      {
        category: "panduan",
        items: [
          { ...base, id: "a", title: "Panduan", category: "panduan", contentType: "file", filePath: "/resources/panduan.pdf", fileSize: 900 },
        ],
      },
      {
        category: "tutorial",
        items: [
          { ...base, id: "b", title: "Video", category: "tutorial", contentType: "url", externalUrl: "https://video.example/x" },
          { ...base, id: "c", title: "Caption", category: "tutorial", contentType: "text", bodyText: "Salin ini" },
        ],
      },
    ]);
    const res = await getResources();
    const body = await res.json();

    expect(res.headers.get("cache-control")).toBe(CONTENT_CACHE);
    expect(body.resources.map((r: { id: string }) => r.id)).toEqual(["a", "b", "c"]);
    expect(keys(body.resources[0])).toEqual([
      "bodyText",
      "category",
      "contentType",
      "description",
      "externalUrl",
      "filePath",
      "fileSize",
      "id",
      "title",
    ]);
    const wire = JSON.stringify(body);
    expect(wire).not.toContain(PRIVATE.note);
    expect(wire).not.toContain(PRIVATE.userId);
  });
});

describe("GET /api/public/announcements/current", () => {
  test("returns the strip fields only, with the shorter cache window", async () => {
    mocks.getCurrentAnnouncement.mockResolvedValue({
      id: "an1",
      title: "Pendaftaran dibuka",
      body: "Daftar sekarang",
      severity: "info",
      ctaLabel: "Daftar",
      ctaUrl: "/gabung-siswa",
      active: true,
      startsAt: date,
      endsAt: null,
      createdBy: PRIVATE.userId,
      createdAt: date,
      updatedAt: date,
    });
    const res = await getAnnouncement();
    const body = await res.json();

    expect(res.headers.get("cache-control")).toBe(ANNOUNCEMENT_CACHE);
    expect(keys(body.announcement)).toEqual([
      "body",
      "ctaLabel",
      "ctaUrl",
      "severity",
      "title",
    ]);
    expect(JSON.stringify(body)).not.toContain(PRIVATE.userId);
  });

  test("answers { announcement: null } when none is active", async () => {
    mocks.getCurrentAnnouncement.mockResolvedValue(null);
    const res = await getAnnouncement();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ announcement: null });
  });
});

// ---------------------------------------------------------------- blog

function article(i: number, over: Partial<BlogArticle> = {}): BlogArticle {
  const day = String(30 - i).padStart(2, "0");
  return {
    id: `artikel-${i}`,
    wpId: PRIVATE.wpId,
    category: i % 2 === 0 ? "Cerita" : "News",
    date: `${day} Mei 2026`,
    dateISO: `2026-05-${day}`,
    title: `Judul ${i}`,
    excerpt: `Ringkasan ${i} [&hellip;]`,
    contentMarkdown: `Isi artikel ${i}`,
    featured: false,
    image: `/blog/images/2026/05/${i}.jpg`,
    author: "Redaksi",
    sourceUrl: PRIVATE.sourceUrl,
    modifiedISO: `2026-05-${day}`,
    ...over,
  };
}

/** n articles, newest first, as getBlogArticlesSorted returns them. */
function articles(n: number, over: (i: number) => Partial<BlogArticle> = () => ({})) {
  return Array.from({ length: n }, (_, i) => article(i, over(i)));
}

describe("GET /api/public/blog", () => {
  test("lists summaries without bodies or internal fields", async () => {
    mocks.getBlogArticlesSorted.mockResolvedValue(articles(3));
    const res = await getBlogList(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CONTENT_CACHE);
    expect(keys(body)).toEqual([
      "articles",
      "featured",
      "page",
      "pageSize",
      "total",
      "totalPages",
    ]);
    expect(keys(body.featured)).toEqual([
      "author",
      "category",
      "date",
      "dateISO",
      "excerpt",
      "featured",
      "image",
      "slug",
      "title",
    ]);
    // WordPress "[&hellip;]" trailer cleaned the way the index page does.
    expect(body.featured.excerpt).toBe("Ringkasan 0 ...");
    const wire = JSON.stringify(body);
    expect(wire).not.toContain("Isi artikel");
    expect(wire).not.toContain(PRIVATE.sourceUrl);
    expect(wire).not.toContain(String(PRIVATE.wpId));
  });

  test("the featured article is the newest flagged one and is not repeated in the grid", async () => {
    mocks.getBlogArticlesSorted.mockResolvedValue(
      articles(4, (i) => ({ featured: i === 2 })),
    );
    const body = await (await getBlogList(request())).json();
    expect(body.featured.slug).toBe("artikel-2");
    expect(body.articles.map((a: { slug: string }) => a.slug)).toEqual([
      "artikel-0",
      "artikel-1",
      "artikel-3",
    ]);
    expect(body.total).toBe(3);
  });

  test("defaults to page 1 with 15 per page", async () => {
    mocks.getBlogArticlesSorted.mockResolvedValue(articles(40));
    const body = await (await getBlogList(request())).json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(15);
    expect(body.articles).toHaveLength(15);
    // 40 articles = 1 featured + 39 in the grid.
    expect(body.total).toBe(39);
    expect(body.totalPages).toBe(3);
  });

  test("returns the requested page and the remainder on the last one", async () => {
    mocks.getBlogArticlesSorted.mockResolvedValue(articles(40));
    const page3 = await (
      await getBlogList(request("/api/public/blog?page=3"))
    ).json();
    expect(page3.page).toBe(3);
    expect(page3.articles).toHaveLength(9);
    // Page 1 starts after the featured article (index 0).
    const page1 = await (await getBlogList(request())).json();
    expect(page1.articles[0].slug).toBe("artikel-1");
    expect(page3.articles[0].slug).toBe("artikel-31");
  });

  test("honours pageSize", async () => {
    mocks.getBlogArticlesSorted.mockResolvedValue(articles(40));
    const body = await (
      await getBlogList(request("/api/public/blog?page=2&pageSize=10"))
    ).json();
    expect(body.pageSize).toBe(10);
    expect(body.articles).toHaveLength(10);
    expect(body.totalPages).toBe(4);
    expect(body.articles[0].slug).toBe("artikel-11");
  });

  test("clamps an out-of-range page instead of failing", async () => {
    mocks.getBlogArticlesSorted.mockResolvedValue(articles(40));
    for (const [query, expected] of [
      ["page=999", 3],
      ["page=0", 1],
      ["page=-4", 1],
      ["page=abc", 1],
      ["page=", 1],
    ] as const) {
      const res = await getBlogList(request(`/api/public/blog?${query}`));
      expect(res.status).toBe(200);
      expect((await res.json()).page, query).toBe(expected);
    }
  });

  test("bounds pageSize to 1..50", async () => {
    mocks.getBlogArticlesSorted.mockResolvedValue(articles(80));
    for (const [query, expected] of [
      ["pageSize=0", 1],
      ["pageSize=-5", 1],
      ["pageSize=1000", 50],
      ["pageSize=abc", 15],
      ["pageSize=50", 50],
    ] as const) {
      const body = await (
        await getBlogList(request(`/api/public/blog?${query}`))
      ).json();
      expect(body.pageSize, query).toBe(expected);
      expect(body.articles.length, query).toBeLessThanOrEqual(expected);
    }
  });

  test("an empty blog is page 1 of 1 with no featured article", async () => {
    mocks.getBlogArticlesSorted.mockResolvedValue([]);
    expect(await (await getBlogList(request())).json()).toEqual({
      featured: null,
      articles: [],
      page: 1,
      pageSize: 15,
      total: 0,
      totalPages: 1,
    });
  });

  test("an article without an image reports image: null", async () => {
    mocks.getBlogArticlesSorted.mockResolvedValue(articles(1, () => ({ image: "" })));
    const body = await (await getBlogList(request())).json();
    expect(body.featured.image).toBeNull();
  });
});

describe("GET /api/public/blog/[slug]", () => {
  function ctx(slug: string) {
    return { params: Promise.resolve({ slug }) };
  }

  function mockBlog(all: BlogArticle[]) {
    mocks.getBlogArticlesSorted.mockResolvedValue(all);
    mocks.getBlogArticleBySlug.mockImplementation(
      async (slug: string) => all.find((a) => a.id === slug) ?? null,
    );
  }

  test("unknown slug is a JSON 404 with a short cache", async () => {
    mockBlog(articles(3));
    const res = await getBlogArticle(request("/api/public/blog/nope"), ctx("nope"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("returns metadata, markdown, rendered HTML, hero image and related posts", async () => {
    const all = articles(8);
    all[1] = article(1, {
      contentMarkdown: "### Judul bagian\n\nParagraf dengan [tautan](https://example.org/x).",
    });
    mockBlog(all);
    const res = await getBlogArticle(
      request("/api/public/blog/artikel-1"),
      ctx("artikel-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CONTENT_CACHE);
    expect(keys(body)).toEqual(["article", "related"]);
    expect(keys(body.article)).toEqual([
      "author",
      "category",
      "contentHtml",
      "contentMarkdown",
      "date",
      "dateISO",
      "excerpt",
      "featured",
      "image",
      "modifiedISO",
      "slug",
      "title",
    ]);
    expect(body.article.slug).toBe("artikel-1");
    expect(body.article.image).toBe("/blog/images/2026/05/1.jpg");
    expect(body.article.contentMarkdown).toContain("### Judul bagian");
    expect(body.article.contentHtml).toContain("<h3>Judul bagian</h3>");
    expect(body.article.contentHtml).toContain(
      '<a href="https://example.org/x" rel="noopener noreferrer" target="_blank">tautan</a>',
    );

    expect(body.related).toHaveLength(3);
    expect(
      body.related.map((a: { slug: string }) => a.slug),
    ).not.toContain("artikel-1");
    for (const item of body.related) {
      expect(item).not.toHaveProperty("contentMarkdown");
      expect(item).not.toHaveProperty("contentHtml");
    }
    const wire = JSON.stringify(body);
    expect(wire).not.toContain(PRIVATE.sourceUrl);
    expect(wire).not.toContain(String(PRIVATE.wpId));
  });

  test("renders what the site renders: GFM tables and lazy images, no raw HTML", async () => {
    const md = [
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "![Foto kegiatan](/blog/images/2026/05/foto.jpg)",
      "",
      "<script>alert(1)</script>",
      "",
      "[jahat](javascript:alert(1))",
    ].join("\n");
    mockBlog([article(0, { contentMarkdown: md })]);
    const body = await (
      await getBlogArticle(request(), ctx("artikel-0"))
    ).json();
    const html: string = body.article.contentHtml;

    expect(html).toContain("<table>");
    expect(html).toContain(
      '<img src="/blog/images/2026/05/foto.jpg" alt="Foto kegiatan" class="rounded-xl max-w-full h-auto my-6" loading="lazy">',
    );
    // Raw HTML is shown as text, never passed through.
    expect(html).toContain("&#x3C;script>alert(1)&#x3C;/script>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });

  test("an article with no related match still gets the newest others", async () => {
    // Different category and more than 180 days apart from the target.
    const target = article(0, {
      id: "lama",
      category: "Career",
      dateISO: "2020-01-01",
    });
    mockBlog([...articles(5).slice(1), target]);
    const body = await (await getBlogArticle(request(), ctx("lama"))).json();
    expect(body.related.map((a: { slug: string }) => a.slug)).toEqual([
      "artikel-1",
      "artikel-2",
      "artikel-3",
    ]);
  });

  test("an empty markdown body renders as empty HTML", async () => {
    mockBlog([article(0, { contentMarkdown: "" })]);
    const body = await (await getBlogArticle(request(), ctx("artikel-0"))).json();
    expect(body.article.contentHtml).toBe("");
  });
});
