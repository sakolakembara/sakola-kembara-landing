import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleReportsByYear } from "../../../.storybook/fixtures";
import { LaporanContent } from "./_laporan-content";

const meta = {
  title: "Public/LaporanContent",
  component: LaporanContent,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { grouped: sampleReportsByYear },
} satisfies Meta<typeof LaporanContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The body of `/laporan`: reports grouped by year, with sample reports. */
export const Default: Story = {};

export const Empty: Story = { args: { grouped: [] } };

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
