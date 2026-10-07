import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import CTASection from "./CTASection";

const meta = {
  title: "Sections/CTA",
  component: CTASection,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CTASection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** *Bergabung Bersama Kami*: four ways to take part (siswa, donatur, relawan, partner), on navy. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
