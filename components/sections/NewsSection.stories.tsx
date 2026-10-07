import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleArticles } from "../../.storybook/fixtures";
import NewsSection from "./NewsSection";

// Sample posts with bundled photos: the real ones come from content/blog,
// whose images live in public/, which Storybook doesn't serve.
const articles = sampleArticles.slice(0, 3);

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
