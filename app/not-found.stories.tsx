import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NotFoundContent } from "./not-found";

const meta = {
  title: "Public/Not found",
  component: NotFoundContent,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NotFoundContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The 404 page body (inside the public navbar and footer on the site), for unknown program and blog slugs, shortlinks and other unknown URLs. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
