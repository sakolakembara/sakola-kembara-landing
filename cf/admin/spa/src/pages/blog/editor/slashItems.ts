import type { Editor, Range } from "@tiptap/core";

// The menu that opens when a person types "/" in the article (Notion's way): what can be put on an empty line, in
// Indonesian, with words a writer would type to find it ("/gambar", "/judul", "/tabel").

export interface SlashContext {
  editor: Editor;
  /** The "/" and what was typed after it: it goes before the block is made. */
  range: Range;
  /** Opens the file picker for a picture (the menu cannot hold a file). */
  pickImage: () => void;
}

export interface SlashItem {
  id: string;
  title: string;
  hint: string;
  /** Other words that find it. */
  keywords: string[];
  run: (context: SlashContext) => void;
}

const start = ({ editor, range }: SlashContext) => editor.chain().focus().deleteRange(range);

export const SLASH_ITEMS: SlashItem[] = [
  { id: "judul-besar", title: "Judul besar", hint: "Bagian utama artikel", keywords: ["judul", "heading", "h2", "besar"], run: (c) => void start(c).setNode("heading", { level: 2 }).run() },
  { id: "judul-kecil", title: "Judul kecil", hint: "Sub-bagian", keywords: ["judul", "heading", "h3", "kecil", "sub"], run: (c) => void start(c).setNode("heading", { level: 3 }).run() },
  { id: "daftar", title: "Daftar", hint: "Poin-poin", keywords: ["daftar", "list", "bullet", "poin"], run: (c) => void start(c).toggleBulletList().run() },
  { id: "daftar-angka", title: "Daftar angka", hint: "Langkah berurutan", keywords: ["daftar", "angka", "nomor", "numbered", "urut"], run: (c) => void start(c).toggleOrderedList().run() },
  { id: "daftar-centang", title: "Daftar centang", hint: "Hal yang perlu dicek", keywords: ["daftar", "centang", "tugas", "checklist", "todo", "task"], run: (c) => void start(c).toggleTaskList().run() },
  { id: "kutipan", title: "Kutipan", hint: "Tandai kutipan", keywords: ["kutipan", "quote", "blockquote"], run: (c) => void start(c).toggleBlockquote().run() },
  {
    id: "gambar",
    title: "Gambar",
    hint: "Unggah dari komputer, atau tempel dan tarik",
    keywords: ["gambar", "foto", "image", "unggah", "upload"],
    run: (c) => {
      start(c).run();
      c.pickImage();
    },
  },
  { id: "tabel", title: "Tabel", hint: "Baris dan kolom", keywords: ["tabel", "table"], run: (c) => void start(c).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "kode", title: "Kode", hint: "Blok kode", keywords: ["kode", "code"], run: (c) => void start(c).toggleCodeBlock().run() },
  { id: "pemisah", title: "Pemisah", hint: "Garis pemisah", keywords: ["pemisah", "garis", "divider", "rule", "hr"], run: (c) => void start(c).setHorizontalRule().run() },
];

/** The items a query finds: the title or a keyword starts with it first, then the ones that only contain it. */
export function filterSlashItems(query: string): SlashItem[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return SLASH_ITEMS;
  const words = (item: SlashItem) => [item.title.toLowerCase(), ...item.keywords];
  const starts = SLASH_ITEMS.filter((item) => words(item).some((word) => word.startsWith(wanted)));
  const contains = SLASH_ITEMS.filter((item) => !starts.includes(item) && words(item).some((word) => word.includes(wanted)));
  return [...starts, ...contains];
}
