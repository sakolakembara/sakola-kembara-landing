import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { VerifyEmailBanner } from "./_verify-email-banner";

const meta = {
  title: "Portal/VerifyEmailBanner",
  component: VerifyEmailBanner,
  tags: ["autodocs"],
  args: { email: "siswa@contoh.com" },
} satisfies Meta<typeof VerifyEmailBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Shown on the portal home until the email is verified. *Kirim ulang tautan*
 * calls the API, which Storybook doesn't have, so clicking it shows the
 * failure state.
 */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
