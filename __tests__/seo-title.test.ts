import { describe, expect, test } from "vitest";
import { buildPageMetadata, pageTitle, TITLE_TEMPLATE } from "@/lib/seo";

describe("page titles", () => {
  test("pageTitle adds the site suffix as an absolute title", () => {
    expect(pageTitle("Tim Kami")).toEqual({ absolute: "Tim Kami | Sakola Kembara" });
    expect(TITLE_TEMPLATE).toBe("%s | Sakola Kembara");
  });

  test("buildPageMetadata gives the tab title the suffix but keeps share titles plain", () => {
    const meta = buildPageMetadata({ title: "Contoh Artikel", description: "Deskripsi.", path: "/blog/contoh" });
    expect(meta.title).toEqual({ absolute: "Contoh Artikel | Sakola Kembara" });
    expect(meta.openGraph?.title).toBe("Contoh Artikel");
  });
});
