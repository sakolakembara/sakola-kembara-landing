import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SuccessScreen } from "./_success";

const meta = {
  title: "Portal/Registration success",
  component: SuccessScreen,
  tags: ["autodocs"],
  args: { applicationId: "00000000-0000-0000-0000-000000000701" },
} satisfies Meta<typeof SuccessScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shown after the application is submitted. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
