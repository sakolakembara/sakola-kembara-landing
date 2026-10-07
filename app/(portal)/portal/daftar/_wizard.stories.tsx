import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Wizard } from "./_wizard";

const meta = {
  title: "Portal/Registration wizard",
  component: Wizard,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    batch: { id: "00000000-0000-0000-0000-000000000301", year: 2026, name: "Contoh Batch Gen 6" },
    user: { email: "siswa@contoh.test", name: "Contoh Pendaftar" },
  },
} satisfies Meta<typeof Wizard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The whole `/portal/daftar` wizard, working: fill a step and press
 * *Selanjutnya* to see validation and the next step. Answers are kept in this
 * browser, like on the site. Submitting does nothing in Storybook. Each step
 * on its own is under *Registration steps*.
 */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
