import { describe, expect, inject, it } from "vitest";
import { imageLookup, legacyEntry, legacyImage, legacyPaths, srcsetOf } from "../src/blog/images";
import { renderArticle } from "../src/blog/render";
import { ARTICLE_COUNT } from "./helpers";

// The render pipeline of the Worker against the build plugin of cf/web (docs/cloudflare/admin-blog.md#the-render-pipeline).
// `inject("blogOracle")` holds what cf/web/plugins/blog-content.mjs rendered from content/blog/*.md (see
// test/global/blog-oracle.ts). The Worker's `renderArticle` must give the SAME STRING, byte for byte, for every article (the 80 migrated and the 6 imported on 2026-10-13):
// no whitespace normalising, no attribute reordering, nothing.

const oracle = inject("blogOracle");

describe("renderArticle equals the build plugin on every article (80 migrated + 6 imported)", () => {
  it("has the articles to compare", () => {
    expect(oracle.articles).toHaveLength(ARTICLE_COUNT);
  });

  it("renders every article to exactly the plugin's HTML", () => {
    const different: string[] = [];
    for (const article of oracle.articles) {
      const { html, removed } = renderArticle(article.markdown);
      if (html !== article.html) different.push(article.slug);
      expect(removed, `${article.slug}: the sanitiser must remove nothing from a migrated article`).toBe(0);
    }
    expect(different).toEqual([]);
  });

  it("keeps srcset, sizes, width and height on every inline image the build gave them", () => {
    const withImages = oracle.articles.filter((article) => article.html.includes("<img "));
    expect(withImages.length).toBeGreaterThan(10);
    for (const article of withImages) {
      const { html } = renderArticle(article.markdown);
      expect(html.match(/<img /g)?.length).toBe(article.html.match(/<img /g)?.length);
      expect(html.match(/ srcset="/g)?.length).toBe(article.html.match(/ srcset="/g)?.length);
      expect(html.match(/ width="\d+" height="\d+"/g)?.length).toBe(article.html.match(/ width="\d+" height="\d+"/g)?.length);
    }
  });

  it("is deterministic and does not depend on what a previous render saw", () => {
    const [first, second] = oracle.articles;
    const a = renderArticle(first!.markdown).html;
    renderArticle(second!.markdown, { images: () => ({ width: 1, height: 1 }) });
    expect(renderArticle(first!.markdown).html).toBe(a);
  });
});

describe("the table of legacy blog images equals the asset pipeline's manifest", () => {
  const regenerate = "run `pnpm blog:legacy-images` in cf/admin and commit src/blog/legacy-images.json";

  it("has the same files", () => {
    expect([...legacyPaths()].sort(), regenerate).toEqual(Object.keys(oracle.legacyImages).sort());
  });

  it("has the same size and hash for each, and builds the same srcset", () => {
    for (const [urlPath, expected] of Object.entries(oracle.legacyImages)) {
      expect(legacyEntry(urlPath), `${urlPath}: ${regenerate}`).toEqual(expected.entry);
      const [width, , hash] = expected.entry;
      expect(srcsetOf(hash, width), `${urlPath}: the ladder is not the pipeline's`).toBe(expected.srcset);
    }
  });

  it("answers a legacy path with a query or fragment as the plugin does, and an unknown one not at all", () => {
    const [urlPath] = Object.keys(oracle.legacyImages);
    expect(legacyImage(`${urlPath}?x=1`)).not.toBeNull();
    expect(legacyImage(`${urlPath}#a`)).not.toBeNull();
    expect(legacyImage("/blog/images/nope.png")).toBeNull();
    expect(legacyImage("https://example.org/a.png")).toBeNull();
    expect(imageLookup()("/uploads/blog-image/2026/x.png")).toBeNull();
  });
});
