import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Heading } from "./heading";

const meta = {
  title: "Atoms/Heading",
  component: Heading,
  tags: ["autodocs"],
  args: { children: "Pencapaian Sakola Kembara", className: "text-gray-900" },
  argTypes: {
    level: {
      control: "select",
      options: ["display", "page", "article", "section", "subsection", "panel", "card"],
    },
    as: { control: "select", options: ["h1", "h2", "h3", "h4", "p"] },
  },
} satisfies Meta<typeof Heading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/**
 * The type scale (SAKEM-031 D3). The first five levels are Lora; `panel` and
 * `card` are sans. `level` sets the look and the default element; `as`
 * changes the element only.
 */
export const Scale: Story = {
  render: () => (
    <div className="space-y-4 text-gray-900">
      <Heading level="display" as="p">display · Membuka Pintu Pendidikan Tinggi</Heading>
      <Heading level="page" as="p">page · Pahlawan di Balik Sakola Kembara</Heading>
      <Heading level="article" as="p">article · Judul artikel blog yang panjang</Heading>
      <Heading level="section" as="p">section · Pencapaian Sakola Kembara</Heading>
      <Heading level="subsection" as="p">subsection · Tim Pengurus</Heading>
      <Heading level="panel" as="p">panel · Cara Berdonasi</Heading>
      <Heading level="card" as="p">card · Roadshow &amp; Seleksi</Heading>
    </div>
  ),
};

export const ScaleOnPhone: Story = {
  ...Scale,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
