import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { authCard } from "../../../.storybook/decorators";
import { ResetForm } from "./_form";

const meta = {
  title: "Auth/Reset password",
  component: ResetForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [authCard],
  args: { token: "contoh-token" },
} satisfies Meta<typeof ResetForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sets a new password from the link in the email. Submitting does nothing in Storybook. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
