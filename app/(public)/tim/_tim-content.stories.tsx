import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleTeam } from "../../../.storybook/fixtures";
import { TimContent } from "./_tim-content";

const meta = {
  title: "Public/TimContent",
  component: TimContent,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { members: sampleTeam },
} satisfies Meta<typeof TimContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The body of `/tim`, grouped by category, with sample members. */
export const Default: Story = {};

export const Empty: Story = { args: { members: [] } };

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
