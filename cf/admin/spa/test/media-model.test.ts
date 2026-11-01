import { describe, expect, test } from "vitest";
import { formatSize, isPdfFile, kindForFile, mediaItemFromUpload, mediaListPath, type MediaQuery, typeLabel } from "~/lib/crud/media";
import { isFiltered, mediaSearchParams, parseMediaParams } from "~/pages/media/model";

// The Media library's query: what the page's address says, and what is asked of the Worker for it.

const query = (change: Partial<MediaQuery> = {}): MediaQuery => ({ kind: null, q: "", type: "", range: "", page: 1, pageSize: 40, ...change });
const NOW = new Date("2026-11-01T10:30:00.000Z");

describe("mediaListPath", () => {
  test("the library asks for a page and nothing else; defaults are left out", () => {
    expect(mediaListPath(query(), NOW)).toBe("/api/admin/uploads?pageSize=40");
    expect(mediaListPath(query({ page: 3 }), NOW)).toBe("/api/admin/uploads?page=3&pageSize=40");
  });

  test("a picker asks for one kind; the search and the type go along", () => {
    expect(mediaListPath(query({ kind: "blog-image", q: "hero kelas", type: "image", pageSize: 20 }), NOW)).toBe("/api/admin/uploads?kind=blog-image&q=hero+kelas&type=image&pageSize=20");
  });

  test("a window of days is a `from` date, the start of that day in UTC: a bare date, which is all the Worker takes", () => {
    expect(mediaListPath(query({ range: "7" }), NOW)).toMatch(/from=2026-10-25&/);
    expect(mediaListPath(query({ range: "30" }), NOW)).toMatch(/from=2026-10-02&/);
    expect(mediaListPath(query({ range: "90" }), NOW)).toMatch(/from=2026-08-03&/);
    expect(mediaListPath(query({ range: "7" }), NOW)).not.toContain("to=");
  });
});

describe("the address of the Media page", () => {
  test("what is unknown or malformed is the default", () => {
    expect(parseMediaParams(new URLSearchParams(""))).toEqual({ q: "", type: "", range: "", page: 1, view: "grid" });
    expect(parseMediaParams(new URLSearchParams("type=video&range=365&page=0&view=tabel&q=%20%20hero%20"))).toEqual({ q: "hero", type: "", range: "", page: 1, view: "grid" });
    expect(parseMediaParams(new URLSearchParams("page=2.5"))).toMatchObject({ page: 1 });
    expect(parseMediaParams(new URLSearchParams("type=pdf&range=30&page=4&view=list"))).toEqual({ q: "", type: "pdf", range: "30", page: 4, view: "list" });
  });

  test("it is written without its defaults, and reads back as it was", () => {
    expect(mediaSearchParams({ q: "", type: "", range: "", page: 1, view: "grid" }).toString()).toBe("");
    const full = { q: "wisuda", type: "image" as const, range: "7" as const, page: 2, view: "list" as const };
    expect(mediaSearchParams(full).toString()).toBe("q=wisuda&type=image&range=7&page=2&view=list");
    expect(parseMediaParams(mediaSearchParams(full))).toEqual(full);
  });

  test("a search, a type or a window makes it filtered; a page and a view do not", () => {
    expect(isFiltered({ q: "", type: "", range: "" })).toBe(false);
    expect(isFiltered({ q: "a", type: "", range: "" })).toBe(true);
    expect(isFiltered({ q: "", type: "pdf", range: "" })).toBe(true);
    expect(isFiltered({ q: "", type: "", range: "30" })).toBe(true);
  });
});

describe("what a dropped file is stored as", () => {
  test("a PDF is a report, anything else a blog image: the two limits of the zone (5 MB a picture, 20 MB a PDF)", () => {
    expect(kindForFile({ name: "laporan.pdf", type: "application/pdf" })).toBe("report");
    expect(kindForFile({ name: "LAPORAN.PDF", type: "" })).toBe("report");
    expect(kindForFile({ name: "laporan.pdf", type: "application/octet-stream" })).toBe("report");
    expect(kindForFile({ name: "foto.png", type: "image/png" })).toBe("blog-image");
    expect(kindForFile({ name: "foto", type: "" })).toBe("blog-image");
    expect(isPdfFile({ name: "foto.pdf", type: "image/png" })).toBe(false); // the browser's guess wins over the name
  });
});

describe("how a file is written", () => {
  test("sizes in decimal units with a decimal comma, as the Worker's messages say 5 MB", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(340_000)).toBe("340 KB");
    expect(formatSize(2_400_000)).toBe("2,4 MB");
    expect(formatSize(5_000_000)).toBe("5 MB");
  });

  test("types by name", () => {
    expect(["application/pdf", "image/webp", "image/jpeg", "image/png", "image/gif", "image/avif"].map(typeLabel)).toEqual(["PDF", "WebP", "JPEG", "PNG", "GIF", "image/avif"]);
  });

  test("a file just uploaded is a library item with its name, its kind and no text alternative", () => {
    const item = mediaItemFromUpload(
      { id: "u1", path: "/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto-siswa.webp", contentType: "image/webp", size: 1234, width: 800, height: 450 },
      "blog-image",
      "Dewi",
    );
    expect(item).toMatchObject({ id: "u1", name: "foto-siswa.webp", kind: "blog-image", altText: null, uploadedByName: "Dewi", width: 800, height: 450 });
    expect(mediaItemFromUpload({ id: "u2", path: "/uploads/report/2026/0a1b2c3d-1111-4222-8333-444455556666-a.pdf", contentType: "application/pdf", size: 1, width: null, height: null }, "report", "").uploadedByName).toBeNull();
  });
});
