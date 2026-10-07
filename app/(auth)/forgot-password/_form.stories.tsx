import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { authCard } from "../../../.storybook/decorators";
import { ForgotForm } from "./_form";

const meta = {
  title: "Auth/Forgot password",
  component: ForgotForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [authCard],
  args: {},
} satisfies Meta<typeof ForgotForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Asks for the email to send a reset link to. Submitting does nothing in Storybook. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
