import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { AdminPageHeader } from "./_page-header";

const meta = {
  title: "Admin/PageHeader",
  component: AdminPageHeader,
  tags: ["autodocs"],
  globals: { backgrounds: { value: "gray" } },
  args: { title: "Batch Pendaftaran" },
} satisfies Meta<typeof AdminPageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list page: title, description and the main action. The action stays on one line. */
export const ListPage: Story = {
  args: {
    actions: (
      <Button href="/admin/batches/new">
        <Plus size={16} /> Batch Baru
      </Button>
    ),
    children: (
      <p className="text-gray-600">
        Pendaftaran siswa dibuka satu batch per tahun. Buat batch baru untuk membuka periode pendaftaran.
      </p>
    ),
  },
};

/** A detail page: the back link, an overline, and the status next to the title. */
export const DetailPage: Story = {
  args: {
    title: "Contoh Pendaftar",
    back: { href: "/admin/applications", label: "Kembali ke daftar" },
    overline: "Detail pendaftar",
    actions: (
      <Tag tone="blue" size="lg">
        Dalam Review
      </Tag>
    ),
  },
};

export const OnPhone: Story = {
  ...ListPage,
  globals: { backgrounds: { value: "gray" }, viewport: { value: "mobile", isRotated: false } },
};
