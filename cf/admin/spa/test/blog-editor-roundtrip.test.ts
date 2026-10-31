import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import matter from "gray-matter";
import { describe, expect, test } from "vitest";
import { renderArticle } from "../../src/blog/render";
import { blogExtensions } from "~/pages/blog/editor/extensions";
import { articleMarkdown } from "~/pages/blog/editor/serialize";
import { signature } from "./blog-editor-signature";

// The editor reads Markdown into a document and writes it back. Markdown is what the Worker renders and stores, so the
// question that matters is: after the editor has had an article, does the Worker's rendering of what it wrote read the
// same as the rendering of what it was given? These tests ask it of the 86 articles of the legacy blog (content/blog,
// the real texts the editor is opened on) and of one text with every kind of block and mark the editor has. "Read the
// same" is `signature` (test/blog-editor-signature.ts): the words, their marks, the blocks and the pictures; not the
// ways Markdown has of saying one thing in two.

const DIR = path.resolve(process.cwd(), "../../content/blog");
const articles = readdirSync(DIR)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .map((name) => ({ name, body: matter(readFileSync(path.join(DIR, name), "utf8")).content }));

function roundTrip(markdown: string): string {
  const editor = new Editor({ extensions: blogExtensions(), content: markdown, contentType: "markdown" });
  const out = articleMarkdown(editor);
  editor.destroy();
  return out;
}

const readsTheSame = (before: string, after: string) => JSON.stringify(signature(renderArticle(before).html)) === JSON.stringify(signature(renderArticle(after).html));

/**
 * The articles that do NOT read the same, each with why. The editor's Markdown parser (marked) and the Worker's (remark)
 * disagree about them: all three are texts that are wrong Markdown, which one reads as the author meant and the other as
 * the letter of the rules. The Worker's rendering stays the truth ("Pratinjau" shows it); the list is here so a fourth
 * cannot join it without somebody reading why.
 */
const KNOWN: Record<string, string> = {
  "digitalisasi-dan-ketimpangan-akses-belajar-online-di-indonesia.md": "a paragraph indented by one space after a list item: remark ends the list, marked keeps the paragraph in the item",
  "strategi-pemeliharaan-fasilitas-yang-menunjang-sekolah.md": '"4." straight after a paragraph: remark keeps it as text (only "1." can interrupt a paragraph), marked makes it a list',
  "tentukan-jurusan-kuliah-tanpa-ragu-cerita-kak-nisrina-dampingi-siswa-sakola-kembara-lewat-talents-mapping.md": 'a bare address followed by ". ": remark keeps ".%20" in the link, marked does not',
};

describe("the legacy articles through the editor", () => {
  test("there are the 86 articles of the migrated blog and its imports", () => {
    expect(articles.length).toBeGreaterThanOrEqual(86);
  });

  test("each reads the same after the editor has had it, except the ones listed with their reason", { timeout: 30_000 }, () => {
    const differ = articles.filter(({ body }) => !readsTheSame(body, roundTrip(body))).map(({ name }) => name);
    expect(differ.sort()).toEqual(Object.keys(KNOWN).sort());
  });

  test("what the editor writes is what it would write again: a second pass changes nothing (the listed ones are read differently the first time, so they settle only then)", { timeout: 30_000 }, () => {
    const moved = articles.filter(({ name, body }) => {
      if (name in KNOWN) return false;
      const once = roundTrip(body);
      return roundTrip(once) !== once;
    });
    expect(moved.map(({ name }) => name)).toEqual([]);
  });
});

describe("every kind of block and mark the editor has", () => {
  const SAMPLE = [
    "## Judul besar",
    "",
    "### Judul kecil",
    "",
    "Paragraf dengan **tebal**, *miring*, ~~coret~~, `kode`, dan [tautan ke situs](https://sakolakembara.org) serta [halaman](/program/pembinaan).",
    "",
    "> Sebuah kutipan",
    "> yang dua baris.",
    "",
    "- poin satu",
    "- poin dua",
    "  - poin dalam",
    "",
    "1. langkah satu",
    "2. langkah dua",
    "",
    "- [ ] belum",
    "- [x] sudah",
    "",
    "```js",
    "const a = 1;",
    "```",
    "",
    "| Nama | Nilai |",
    "| --- | --- |",
    "| Satu | 1 |",
    "| Dua | 2 |",
    "",
    "---",
    "",
    "![Siswa belajar](/uploads/blog-image/2026/0a1b2c3d-1111-4222-8333-444455556666-foto.png)",
    "",
    "Karakter khusus: 5 * 3 = 15, snake_case_name, a < b, dan \\*bukan miring\\*.",
  ].join("\n");

  test("a text with all of them reads the same after a round trip, and again after a second one", () => {
    const once = roundTrip(SAMPLE);
    expect(readsTheSame(SAMPLE, once)).toBe(true);
    expect(roundTrip(once)).toBe(once);
  });

  test("a picture keeps the path of its upload, with its alt text", () => {
    expect(roundTrip("![Siswa belajar](/uploads/blog-image/2026/x-foto.png)")).toBe("![Siswa belajar](/uploads/blog-image/2026/x-foto.png)");
  });

  test("raw HTML the Worker drops is not made into something it keeps", () => {
    const html = "Teks <b>tebal</b> dan <script>alert(1)</script> lalu <iframe src=\"https://x.test\"></iframe> selesai.";
    expect(renderArticle(roundTrip(html)).html).not.toMatch(/<script|<iframe|<b>/);
  });

  test("an empty article stays empty, and a very long one is not cut", { timeout: 30_000 }, () => {
    expect(roundTrip("")).toBe("");
    const long = Array.from({ length: 200 }, (_, index) => `Paragraf nomor ${index} yang cukup panjang untuk diuji.`).join("\n\n");
    expect(roundTrip(long)).toBe(long);
  });
});
