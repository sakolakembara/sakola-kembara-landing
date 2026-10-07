import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageHero } from "./page-hero";

const meta = {
  title: "Organisms/PageHero",
  component: PageHero,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    title: "Pahlawan di Balik Sakola Kembara",
    lead: "Didukung oleh pengurus dan relawan dari berbagai universitas terbaik di Indonesia.",
  },
} satisfies Meta<typeof PageHero>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The navy hero that opens a sub-page. The title is the page's h1. The top
 * padding clears the fixed navbar, so it looks tall on its own.
 */
export const Default: Story = {};

export const WithoutLead: Story = {
  args: { title: "Laporan", lead: undefined },
};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
