import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Footer } from "./footer";

const meta = {
  title: "Organisms/Footer",
  component: Footer,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Footer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Site footer: brand, site links, contact and social links. Links come from `lib/data.ts`. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
