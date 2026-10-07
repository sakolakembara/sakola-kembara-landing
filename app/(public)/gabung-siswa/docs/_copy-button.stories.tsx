import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CopyButton } from "./_copy-button";

const meta = {
  title: "Public/CopyButton",
  component: CopyButton,
  tags: ["autodocs"],
  args: { text: "Contoh teks untuk disalin" },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The small *Salin* button on `/gabung-siswa/docs`; it shows a copied state after a click. */
export const Default: Story = {};
