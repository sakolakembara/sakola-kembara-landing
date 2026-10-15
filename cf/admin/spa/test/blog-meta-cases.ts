// The validation matrix of the blog's meta description (SAKEM-094), as data: no imports, so the Worker's tests (workerd,
// test/blog-spa-contract.test.ts, the real routes) and the SPA's (jsdom, spa/test/blog-mock.test.ts, the mock) run the
// SAME cases and cannot drift apart. Each case is a CREATE: `input` is what the form would send as `metaDescription`,
// and the answer is either the text that is stored (null for none) or the message of the 400 on that field.

export const TOO_LONG = "Deskripsi meta maksimal 300 karakter";
export const MARKUP = "Deskripsi meta hanya boleh berupa teks biasa, tanpa tag HTML";
/** zod's own English is never shown: a value of the wrong type gets this generic line (src/api/crud/validation.ts). */
export const NOT_TEXT = "Isian belum benar.";

export type MetaCase = { name: string; input: unknown } & ({ stored: string | null } | { refused: string });

export const META_CASES: MetaCase[] = [
  // ---- accepted, stored as typed
  { name: "plain text", input: "Belajar efektif bersama Sakola Kembara.", stored: "Belajar efektif bersama Sakola Kembara." },
  { name: "a lone < or > is text, not markup", input: "IPK < 3 dan nilai > 2, 5 <3 ya", stored: "IPK < 3 dan nilai > 2, 5 <3 ya" },
  { name: "an ampersand and an entity-looking text are kept as typed", input: "Tips & Trik &amp; lain-lain", stored: "Tips & Trik &amp; lain-lain" },
  { name: "an emoji (a surrogate pair) is kept", input: "Belajar 😀 bersama", stored: "Belajar 😀 bersama" },
  { name: "exactly 300 characters", input: "x".repeat(300), stored: "x".repeat(300) },
  { name: "300 characters and spaces around them", input: `  ${"x".repeat(300)}   `, stored: "x".repeat(300) },
  { name: "a text that is long only because of its spaces (under the raw limit)", input: `a${" ".repeat(1000)}b`, stored: "a b" },

  // ---- accepted, cleaned
  { name: "trimmed", input: "   teks dengan spasi   ", stored: "teks dengan spasi" },
  { name: "every run of whitespace is one space", input: "satu   dua\t\ttiga\n\nempat\r\nlima\u000bsatu\u000cdua", stored: "satu dua tiga empat lima satu dua" },
  { name: "other spaces (no-break, line and paragraph separator, ideographic) are spaces", input: "a b c d　e h", stored: "a b c d e h" },
  { name: "a next-line control is a space", input: "a\u0085b", stored: "a b" },
  { name: "control characters are removed", input: "a\u0000b\u0007c\u001bd\u007fe\u009ff", stored: "abcdef" },
  { name: "zero-width, direction and format characters are removed", input: "a​b‎c‭d‮e⁠f﻿g­h", stored: "abcdefgh" },
  { name: "an unpaired surrogate is removed", input: "a\ud800b\udfffc", stored: "abc" },

  // ---- empty is none
  { name: "an empty text is none", input: "", stored: null },
  { name: "spaces only are none", input: "   \t \n ", stored: null },
  { name: "invisible characters only are none", input: "​‌﻿\u0000", stored: null },
  { name: "null is none", input: null, stored: null },

  // ---- refused
  { name: "301 characters", input: "x".repeat(301), refused: TOO_LONG },
  { name: "301 characters once cleaned", input: `  ${"ab ".repeat(100)}b   `, refused: TOO_LONG },
  { name: "a raw text over 2,000 characters is refused before it is cleaned", input: "x".repeat(2001), refused: TOO_LONG },
  { name: "a short text padded with over 2,000 characters of spaces is refused before it is cleaned", input: `a${" ".repeat(2100)}b`, refused: TOO_LONG },
  { name: "bold", input: "<b>tebal</b> sekali", refused: MARKUP },
  { name: "a script", input: "Halo <script>alert(1)</script>", refused: MARKUP },
  { name: "a closing tag", input: "akhir </p>", refused: MARKUP },
  { name: "a tag with no closing bracket", input: "a<b", refused: MARKUP },
  { name: "a comment", input: "x <!-- tersembunyi --> y", refused: MARKUP },
  { name: "a doctype", input: "<!DOCTYPE html>", refused: MARKUP },
  { name: "a processing instruction", input: "<?xml version=1?>", refused: MARKUP },
  { name: "a tag hidden behind an invisible character", input: "<​script>x", refused: MARKUP },
  { name: "a tag hidden behind a control character", input: "<\u0000img src=x>", refused: MARKUP },
  { name: "a number", input: 5, refused: NOT_TEXT },
  { name: "an object", input: { a: 1 }, refused: NOT_TEXT },
  { name: "a list", input: ["a"], refused: NOT_TEXT },
  { name: "a boolean", input: true, refused: NOT_TEXT },
];
