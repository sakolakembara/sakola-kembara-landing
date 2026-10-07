import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SectionHeader } from "./section-header";

const meta = {
  title: "Molecules/SectionHeader",
  component: SectionHeader,
  tags: ["autodocs"],
  args: {
    eyebrow: "Program Kami",
    title: "Apa saja yang dilalui penerima manfaat Sakola Kembara?",
    lead: "Program pembinaan komprehensif dari penjangkauan siswa hingga pendampingan alumni.",
  },
  argTypes: {
    tone: { control: "inline-radio", options: ["light", "dark"] },
    align: { control: "inline-radio", options: ["center", "left"] },
  },
} satisfies Meta<typeof SectionHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The opening of almost every section: eyebrow, `section` heading (h2 by default), lead. */
export const Light: Story = {};

export const Dark: Story = {
  args: { tone: "dark", eyebrow: "Dampak Kami", title: "Pencapaian Sakola Kembara", lead: undefined },
  globals: { backgrounds: { value: "navy" } },
};

export const LeftAligned: Story = {
  args: { align: "left" },
};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
