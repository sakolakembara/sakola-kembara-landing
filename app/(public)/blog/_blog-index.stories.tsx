import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleArticles } from "../../../.storybook/fixtures";
import { BlogIndex } from "./_blog-index";

const meta = {
  title: "Public/BlogIndex",
  component: BlogIndex,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { featured: sampleArticles[0], others: sampleArticles.slice(1), currentPage: 1, totalPages: 3 },
} satisfies Meta<typeof BlogIndex>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The body of `/blog`: the featured post, the grid and the pagination, with sample posts. */
export const FirstPage: Story = {};

/** Later pages have no featured post. */
export const LaterPage: Story = { args: { featured: null, currentPage: 2 } };

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
