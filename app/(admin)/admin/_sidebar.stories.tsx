import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Sidebar } from "./_sidebar";

const meta = {
  title: "Admin/Sidebar",
  component: Sidebar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/admin/applications" } },
  },
  args: { email: "admin@contoh.test" },
  decorators: [
    (Story) => (
      <div className="h-dvh flex flex-col md:flex-row bg-gray-50 overflow-hidden">
        <Story />
        <main className="flex-1 overflow-auto p-6 text-sm text-gray-500">Isi halaman admin</main>
      </div>
    ),
  ],
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The admin navigation, with the current page (here *Pendaftar*) highlighted. *Keluar* does nothing in Storybook. */
export const Desktop: Story = {};

/** On phones it collapses into a top bar with a menu button. */
export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
