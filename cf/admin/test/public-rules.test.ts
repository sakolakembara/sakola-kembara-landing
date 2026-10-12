import { describe, expect, test } from "vitest";
import { cleanExcerpt, pageWindow, parseIntParam, pickRelatedArticles, relatedWindow, resolvePageSize } from "../src/public/blog-rules";
import { dayNumberJakarta, isoDayJakarta, longDateJakarta, startOfDayJakarta } from "../src/public/dates";

// The pure rules behind the blog index. The SQL applies the same rules in D1;
// public-blog.test.ts compares the two end to end.

describe("query parameters", () => {
  test("an integer is optional sign and digits only", () => {
    expect(["1", "+2", "-3", " 4 ", "007", "0"].map(parseIntParam)).toEqual([1, 2, -3, 4, 7, 0]);
    for (const raw of [undefined, "", " ", "abc", "1.5", "2abc", "1e3", "0x10", "--1", "٣"]) expect(parseIntParam(raw), String(raw)).toBeUndefined();
  });

  test("a very long run of digits is out of range, not an error", () => {
    expect(parseIntParam("9".repeat(400))).toBe(Infinity);
    expect(pageWindow(40, 15, Infinity).page).toBe(3);
    expect(resolvePageSize("9".repeat(400))).toBe(50);
  });

  test("pageSize defaults to 15 and is bounded to 1..50", () => {
    expect([undefined, "", "abc", "0", "-1", "1", "15", "50", "51", "1000"].map(resolvePageSize)).toEqual([15, 15, 15, 1, 1, 1, 15, 50, 50, 50]);
  });

  test("the page is clamped to 1..totalPages and totalPages is at least 1", () => {
    expect(pageWindow(0, 15, undefined)).toEqual({ page: 1, totalPages: 1, offset: 0 });
    expect(pageWindow(15, 15, 2)).toEqual({ page: 1, totalPages: 1, offset: 0 });
    expect(pageWindow(16, 15, 2)).toEqual({ page: 2, totalPages: 2, offset: 15 });
    expect(pageWindow(79, 15, 99)).toEqual({ page: 6, totalPages: 6, offset: 75 });
    expect(pageWindow(79, 15, -5)).toEqual({ page: 1, totalPages: 6, offset: 0 });
  });
});

describe("cleanExcerpt (the legacy WordPress trailer rule)", () => {
  test.each([
    ["Cerita [&hellip;]", "Cerita ..."],
    ["Cerita [ &hellip; ]", "Cerita ..."],
    ["Cerita [hellip;]", "Cerita ..."],
    ["Cerita [&HELLIP;]", "Cerita ..."],
    ["Cerita…", "Cerita..."],
    ["Cerita …  ", "Cerita ..."],
    ["  Tanpa trailer  ", "Tanpa trailer"],
    ["Titik ... tengah", "Titik ... tengah"],
    ["", ""],
  ])("%j", (raw, expected) => {
    expect(cleanExcerpt(raw)).toBe(expected);
  });
});

describe("dates in Asia/Jakarta", () => {
  test("the day an instant falls on, at the 17:00 UTC boundary", () => {
    expect(isoDayJakarta(Date.parse("2026-05-20T16:59:59.999Z"))).toBe("2026-05-20");
    expect(isoDayJakarta(Date.parse("2026-05-20T17:00:00.000Z"))).toBe("2026-05-21");
    expect(longDateJakarta(Date.parse("2026-05-20T17:00:00Z"))).toBe("21 Mei 2026");
  });

  test("every month name, with no zero padding on the day", () => {
    const names = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    names.forEach((name, month) => expect(longDateJakarta(Date.UTC(2026, month, 5, 5))).toBe(`5 ${name} 2026`));
  });

  test("a leap day and the turn of the year", () => {
    expect(longDateJakarta(Date.parse("2028-02-29T05:00:00Z"))).toBe("29 Februari 2028");
    expect(isoDayJakarta(Date.parse("2025-12-31T17:00:00Z"))).toBe("2026-01-01");
  });

  test("day numbers round-trip to Jakarta midnight", () => {
    const noon = Date.parse("2026-05-21T05:00:00Z");
    expect(new Date(startOfDayJakarta(dayNumberJakarta(noon))).toISOString()).toBe("2026-05-20T17:00:00.000Z");
  });
});

describe("the related window", () => {
  const at = (iso: string) => Date.parse(`${iso}T12:00:00+07:00`);

  test("is the Jakarta days from -179 to +179, as a half-open instant range", () => {
    const { from, to } = relatedWindow(at("2026-03-01"));
    expect(new Date(from).toISOString()).toBe("2025-09-02T17:00:00.000Z"); // 2025-09-03 00:00 WIB
    expect(new Date(to).toISOString()).toBe("2026-08-27T17:00:00.000Z"); // 2026-08-28 00:00 WIB, excluded
  });

  test("the pure picker: same category or in the window, newest first, three of them, else the newest others", () => {
    const article = (slug: string, category: string, iso: string) => ({ slug, category, publishedAtMs: at(iso) });
    const sorted = [
      article("a", "News", "2026-03-10"),
      article("b", "Tips", "2026-03-05"),
      article("c", "Career", "2023-01-01"),
      article("d", "Tips", "2022-01-01"),
      article("e", "News", "2021-01-01"),
    ];
    const target = article("t", "Tips", "2026-03-01");
    expect(pickRelatedArticles(target, sorted).map((x) => x.slug)).toEqual(["a", "b", "d"]);
    expect(pickRelatedArticles(article("lone", "Education", "2010-01-01"), sorted).map((x) => x.slug)).toEqual(["a", "b", "c"]);
    expect(pickRelatedArticles(sorted[0]!, sorted).map((x) => x.slug)).not.toContain("a");
  });
});
