import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { serializeAnnouncement, serializeBlogArticle, serializeBlogSummary, serializeReport, serializeResource, serializeTeamMember } from "../src/public/serializers";
import { addAnnouncement, addPost, addReport, addResource, addTeam, addUser, internalFetch, json, orm } from "./public-helpers";
import * as schema from "../src/db/schema";

// The contract's rule: build every response from an explicit list of fields,
// never "the row minus the private columns" (docs/cloudflare/content-api.md,
// Conventions). Two layers are tested, because either alone can be undone by
// a careless edit: the serializers (given a row stuffed with private columns,
// only the allow-listed fields may come out) and the whole API over a database
// in which every private column holds a marker that must never appear.

const PRIVATE = {
  note: "INTERNAL-NOTE-do-not-publish",
  wpId: 58021337,
  sourceUrl: "https://wp.example.test/old-permalink-private/",
  contactEmail: "pengirim.privat@example.test",
  contactText: "ISI-PESAN-PRIVAT-pengunjung",
  auditText: "METADATA-AUDIT-PRIVAT",
  mediaKey: "blog/images/kunci-media-privat.jpg",
  shortlinkTarget: "https://example.test/target-shortlink-privat",
};

describe("serializers are allow-lists", () => {
  const stuffed = {
    createdBy: "user-id-privat",
    updatedBy: "user-id-privat",
    uploadedBy: "user-id-privat",
    email: "privat@example.test",
    notes: PRIVATE.note,
    displayOrder: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
    uploadedAt: new Date(),
    active: true,
    startsAt: new Date(),
    endsAt: new Date(),
    wpId: PRIVATE.wpId,
    sourceUrl: PRIVATE.sourceUrl,
    status: "published",
    password: "x",
  };

  test("team member", () => {
    const out = serializeTeamMember({ ...stuffed, id: "i", name: "n", role: "r", image: null, category: "pengurus", bio: null, educationHistory: [], workHistory: [] } as never);
    expect(Object.keys(out).sort()).toEqual(["bio", "category", "educationHistory", "id", "image", "name", "role", "workHistory"]);
  });

  test("history entries keep only their own fields", () => {
    const out = serializeTeamMember({
      id: "i",
      name: "n",
      role: "r",
      image: null,
      category: "pengurus",
      bio: null,
      educationHistory: [{ institution: "I", degree: "S1", year: "2010", gpa: 3.9, studentId: "privat" }],
      workHistory: [{ organization: "O", role: "R", period: "2020", salary: 1, boss: "privat" }],
    } as never);
    expect(Object.keys(out.educationHistory[0]!).sort()).toEqual(["degree", "institution", "year"]);
    expect(Object.keys(out.workHistory[0]!).sort()).toEqual(["organization", "period", "role"]);
  });

  test("report", () => {
    const out = serializeReport({ ...stuffed, id: "i", title: "t", description: null, category: "impact", year: "2025", filePath: "/reports/x.pdf", fileSize: 1 } as never);
    expect(Object.keys(out).sort()).toEqual(["category", "description", "fileSize", "filePath", "id", "title", "year"].sort());
  });

  test("resource", () => {
    const out = serializeResource({ ...stuffed, id: "i", title: "t", description: null, category: "panduan", contentType: "file", filePath: "/resources/x.pdf", fileSize: 1, externalUrl: null, bodyText: null } as never);
    expect(Object.keys(out).sort()).toEqual(["bodyText", "category", "contentType", "description", "externalUrl", "filePath", "fileSize", "id", "title"]);
  });

  test("announcement", () => {
    const out = serializeAnnouncement({ ...stuffed, id: "i", title: "t", body: "b", severity: "info", ctaLabel: null, ctaUrl: null } as never);
    expect(Object.keys(out).sort()).toEqual(["body", "ctaLabel", "ctaUrl", "severity", "title"]);
  });

  test("blog summary and article", () => {
    const row = { ...stuffed, slug: "s", title: "t", category: "News", excerpt: "e", image: null, imageWidth: null, imageHeight: null, author: "a", featured: false, publishedAt: new Date(), metaDescription: "d", contentMarkdown: "m", contentHtml: "h" };
    expect(Object.keys(serializeBlogSummary(row as never)).sort()).toEqual(["author", "category", "date", "dateISO", "excerpt", "featured", "image", "imageHeight", "imageWidth", "slug", "title"]);
    expect(Object.keys(serializeBlogArticle(row as never)).sort()).toEqual([
      "author",
      "category",
      "contentHtml",
      "contentMarkdown",
      "date",
      "dateISO",
      "description",
      "excerpt",
      "featured",
      "image",
      "imageHeight",
      "imageWidth",
      "modifiedISO",
      "seoTitle",
      "slug",
      "title",
    ]);
    // SAKEM-109: `noindex` appears only when set, on both; every other key set is as above.
    const hidden = { ...row, noindex: true, seoTitle: "Judul SEO" };
    expect(Object.keys(serializeBlogSummary(hidden as never))).toContain("noindex");
    expect(serializeBlogSummary(hidden as never).noindex).toBe(true);
    expect(serializeBlogArticle(hidden as never).noindex).toBe(true);
    expect(serializeBlogArticle(hidden as never).seoTitle).toBe("Judul SEO");
  });
});

describe("no private column reaches any public response", () => {
  async function seedEverythingPrivate() {
    const staff = await addUser("staf.privat@example.test");
    await addTeam({ name: "Anggota", category: "dewan_pembina" });
    await addReport({ uploadedBy: staff.id });
    await addResource({ notes: PRIVATE.note, updatedBy: staff.id });
    await addResource({ title: "Tautan", category: "tutorial", contentType: "url", filePath: null, fileSize: null, externalUrl: "https://example.test/x", notes: PRIVATE.note });
    await addAnnouncement({ createdBy: staff.id, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000) });
    await addPost({ slug: "satu", createdBy: staff.id, updatedBy: staff.id, wpId: PRIVATE.wpId, sourceUrl: PRIVATE.sourceUrl, featured: true });
    await addPost({ slug: "dua", createdBy: staff.id, updatedBy: staff.id });
    await addPost({ slug: "draf-privat", status: "draft", title: "JUDUL-DRAF-PRIVAT", createdBy: staff.id });
    // Rows of tables the public API never reads: they must not leak either (a join added later would be caught here).
    await orm().insert(schema.contactMessages).values({ fullName: "Pengirim", email: PRIVATE.contactEmail, subject: "other", message: PRIVATE.contactText });
    await orm().insert(schema.auditLog).values({ actorId: staff.id, actorEmail: staff.email, action: "x.y", metadata: { note: PRIVATE.auditText } });
    await orm().insert(schema.media).values({ key: PRIVATE.mediaKey, purpose: "blog", contentType: "image/jpeg", size: 1, uploadedBy: staff.id });
    await orm().insert(schema.shortlinks).values({ slug: "privat", targetUrl: PRIVATE.shortlinkTarget, createdBy: staff.id });
    return staff;
  }

  test("every endpoint, over a database full of private values", async () => {
    const staff = await seedEverythingPrivate();
    const paths = ["/api/public/team", "/api/public/reports", "/api/public/resources", "/api/public/announcements/current", "/api/public/blog", "/api/public/blog?pageSize=50", "/api/public/blog/satu", "/api/public/blog/dua"];
    const markers = [staff.id, staff.email, "staf.privat", PRIVATE.note, String(PRIVATE.wpId), PRIVATE.sourceUrl, "wp.example.test", PRIVATE.contactEmail, PRIVATE.contactText, PRIVATE.auditText, PRIVATE.mediaKey, PRIVATE.shortlinkTarget, "JUDUL-DRAF-PRIVAT", "draf-privat"];
    for (const path of paths) {
      const res = await internalFetch(path);
      expect(res.status, path).toBe(200);
      const text = await res.text();
      for (const marker of markers) expect(text, `${path} leaked ${marker}`).not.toContain(marker);
      // And no field name of an internal column.
      for (const column of ["createdBy", "updatedBy", "uploadedBy", "uploadedAt", "createdAt", "updatedAt", "displayOrder", "notes", "wpId", "sourceUrl", "status", "active", "startsAt", "endsAt", "email", "password"]) {
        expect(text, `${path} exposes the field ${column}`).not.toContain(`"${column}"`);
      }
    }
  });

  test("the key set of every endpoint is exactly the contract's, nothing more", async () => {
    await seedEverythingPrivate();
    const keys = (value: object) => Object.keys(value).sort();
    const team = await json<{ members: object[] }>(await internalFetch("/api/public/team"));
    expect(keys(team)).toEqual(["members"]);
    expect(keys(team.members[0]!)).toEqual(["bio", "category", "educationHistory", "id", "image", "name", "role", "workHistory"]);

    const reports = await json<{ reports: object[] }>(await internalFetch("/api/public/reports"));
    expect(keys(reports.reports[0]!)).toEqual(["category", "description", "fileSize", "filePath", "id", "title", "year"].sort());

    const resources = await json<{ resources: object[] }>(await internalFetch("/api/public/resources"));
    for (const resource of resources.resources) expect(keys(resource)).toEqual(["bodyText", "category", "contentType", "description", "externalUrl", "filePath", "fileSize", "id", "title"]);

    const announcement = await json<{ announcement: object }>(await internalFetch("/api/public/announcements/current"));
    expect(keys(announcement.announcement)).toEqual(["body", "ctaLabel", "ctaUrl", "severity", "title"]);

    const blog = await json<{ featured: object; articles: object[] }>(await internalFetch("/api/public/blog"));
    expect(keys(blog)).toEqual(["articles", "featured", "page", "pageSize", "total", "totalPages"]);
    expect(keys(blog.featured)).toEqual(["author", "category", "date", "dateISO", "excerpt", "featured", "image", "imageHeight", "imageWidth", "slug", "title"]);

    const article = await json<{ article: object; related: object[] }>(await internalFetch("/api/public/blog/satu"));
    expect(keys(article)).toEqual(["article", "related"]);
    expect(keys(article.article)).toEqual(["author", "category", "contentHtml", "contentMarkdown", "date", "dateISO", "description", "excerpt", "featured", "image", "imageHeight", "imageWidth", "modifiedISO", "seoTitle", "slug", "title"]);
    expect(keys(article.related[0]!)).toEqual(["author", "category", "date", "dateISO", "excerpt", "featured", "image", "imageHeight", "imageWidth", "slug", "title"]);
  });

  test("the announcement does not carry its author, as the legacy /api/announcements/current did (SAKEM-085)", async () => {
    const staff = await addUser();
    await addAnnouncement({ createdBy: staff.id });
    const text = await (await internalFetch("/api/public/announcements/current")).text();
    expect(text).not.toContain(staff.id);
    expect(text).not.toContain("createdBy");
  });

  test("the database really holds the private values (the test is not vacuous)", async () => {
    await seedEverythingPrivate();
    const row = await env.DB.prepare("SELECT count(*) AS n FROM blog_posts WHERE wp_id = ? AND source_url = ?").bind(PRIVATE.wpId, PRIVATE.sourceUrl).first<{ n: number }>();
    expect(row?.n).toBe(1);
    const note = await env.DB.prepare("SELECT count(*) AS n FROM site_resources WHERE notes = ?").bind(PRIVATE.note).first<{ n: number }>();
    expect(note?.n).toBe(2);
  });
});
