import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { Navbar } from "./navbar";

const meta = {
  title: "Organisms/Navbar",
  component: Navbar,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  // The navbar is fixed to the top; give the canvas room for the mobile menu.
  decorators: [
    (Story) => (
      <div className="bg-gray-50" style={{ minHeight: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Navbar>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Fixed site header: logo, menu and the auth button. In the app it also shows
 * the active announcement (see AnnouncementStrip) and swaps *Masuk* for
 * *Portal* or *Dashboard* when signed in; Storybook has no API, so it shows
 * the signed-out header without a strip.
 */
export const Desktop: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};

/** The mobile menu, opened with the hamburger button. */
export const PhoneMenuOpen: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Buka menu" }));
    await expect(canvas.getAllByRole("link", { name: "Masuk" }).length).toBeGreaterThan(0);
  },
};
