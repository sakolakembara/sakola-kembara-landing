import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { BlogArticle } from "@/lib/blog-types";
import kbm from "@/public/images/program/kbm-pekanan.jpg";
import mentoring from "@/public/images/program/mentoring.jpg";
import asrama from "@/public/images/program/asrama-intensif.jpg";
import NewsSection from "./NewsSection";

// Sample posts. The real ones come from content/blog, whose images live in
// public/, which Storybook doesn't serve, so these use bundled photos.
const article = (id: string, title: string, image: string, category: string, date: string): BlogArticle => ({
  id,
  wpId: 0,
  category,
  date,
  dateISO: "2026-10-01",
  title,
  excerpt: "Cerita singkat dari kegiatan pembinaan Sakola Kembara bersama para siswa.",
  contentMarkdown: "",
  featured: false,
  image,
  author: "Tim Sakola Kembara",
  sourceUrl: "",
  modifiedISO: "2026-10-01",
});

const articles = [
  article("contoh-1", "Belajar bersama di KBM pekanan", kbm.src, "News", "1 Oktober 2026"),
  article("contoh-2", "Mentoring dengan alumni perguruan tinggi negeri", mentoring.src, "Cerita", "24 September 2026"),
  article("contoh-3", "Asrama intensif menjelang UTBK", asrama.src, "Tips", "10 September 2026"),
];

const meta = {
  title: "Sections/News",
  component: NewsSection,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { articles },
} satisfies Meta<typeof NewsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** *Cerita & Inspirasi*: the latest three blog posts. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
