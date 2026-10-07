import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { authCard } from "../../../.storybook/decorators";
import { RegisterForm } from "./_register-form";

const meta = {
  title: "Auth/Register",
  component: RegisterForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [authCard],
  args: { from: null },
} satisfies Meta<typeof RegisterForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The student sign-up form on `/register`. Submitting does nothing in Storybook. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
