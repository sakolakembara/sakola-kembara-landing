import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tag } from "./tag";

const row = "flex flex-wrap items-center gap-4";

const meta = {
  title: "Atoms/Tag",
  component: Tag,
  tags: ["autodocs"],
  args: { children: "Pembinaan" },
  argTypes: {
    tone: { control: "select", options: ["brand", "soft", "blue", "amber", "green", "red", "purple", "gray"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** `brand` for categories and program phases, `soft` for quiet chips. */
export const BrandAndSoft: Story = {
  render: () => (
    <div className={row}>
      <Tag>Pembinaan</Tag>
      <Tag size="sm">News</Tag>
      <Tag tone="soft">290+ jam belajar setahun</Tag>
    </div>
  ),
};

/** The bordered hues for categories and statuses in lists. Maps in `lib/` pick the tone, e.g. `APPLICATION_STATUS_TONE`. */
export const Hues: Story = {
  render: () => (
    <div className={row}>
      <Tag tone="blue" size="sm">Dalam Review</Tag>
      <Tag tone="amber" size="sm">Pending</Tag>
      <Tag tone="green" size="sm">Diterima</Tag>
      <Tag tone="red" size="sm">Ditolak</Tag>
      <Tag tone="purple" size="sm">Kerjasama</Tag>
      <Tag tone="gray" size="sm">Lainnya</Tag>
    </div>
  ),
};

/** `lg` is the status next to a detail page's title. */
export const Sizes: Story = {
  render: () => (
    <div className={row}>
      <Tag tone="amber" size="sm">Pending</Tag>
      <Tag tone="amber" size="md">Pending</Tag>
      <Tag tone="amber" size="lg">Pending</Tag>
    </div>
  ),
};
