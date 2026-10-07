import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PortalNav } from "./_nav";

const meta = {
  title: "Portal/Nav",
  component: PortalNav,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/portal" } } },
  args: { displayName: "Contoh Pendaftar" },
} satisfies Meta<typeof PortalNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The student portal's top bar. *Keluar* does nothing in Storybook. */
export const Desktop: Story = {};

/** On phones *Keluar* is icon-only, with the label kept for screen readers. */
export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
