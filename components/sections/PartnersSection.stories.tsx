import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import PartnersSection from "./PartnersSection";

const meta = {
  title: "Sections/Partners",
  component: PartnersSection,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PartnersSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** *Partner Kami*: current and past partner logos. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
