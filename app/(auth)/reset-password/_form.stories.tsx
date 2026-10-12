import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import Link from "next/link";
import { AUTH_LINK, AuthShell } from "../_auth-shell";
import { ResetForm } from "./_form";

/** The page around the form, as on `/reset-password?token=…`. */
const resetPage: Decorator = (Story) => (
  <AuthShell
    title="Reset password"
    description="Pilih password baru. Setelah disimpan, kamu langsung masuk ke portal siswa."
    footer={
      <Link href="/login" className={AUTH_LINK}>
        Kembali ke halaman masuk
      </Link>
    }
  >
    <Story />
  </AuthShell>
);

const meta = {
  title: "Auth/Reset password",
  component: ResetForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [resetPage],
  args: { token: "contoh-token" },
} satisfies Meta<typeof ResetForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sets a new password from the link in the email. Submitting does nothing in Storybook. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
