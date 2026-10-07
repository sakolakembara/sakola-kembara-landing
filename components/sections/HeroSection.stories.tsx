import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import HeroSection from "./HeroSection";

const meta = {
  title: "Sections/Hero",
  component: HeroSection,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HeroSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The homepage hero: headline, CTAs, photo panel with floating badges and the key stats. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
