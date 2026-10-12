import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import Link from "next/link";
import { AUTH_LINK, AuthShell } from "../_auth-shell";
import { ForgotForm } from "./_form";

/** The page around the form, as on `/forgot-password`. */
const forgotPage: Decorator = (Story) => (
  <AuthShell
    title="Lupa password?"
    description="Masukkan email akun kamu. Kami akan mengirim tautan untuk mengatur ulang password ke inbox tersebut."
    footer={
      <>
        Ingat lagi password kamu?{" "}
        <Link href="/login" className={AUTH_LINK}>
          Kembali ke halaman masuk
        </Link>
      </>
    }
  >
    <Story />
  </AuthShell>
);

const meta = {
  title: "Auth/Forgot password",
  component: ForgotForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [forgotPage],
  args: {},
} satisfies Meta<typeof ForgotForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Asks for the email to send a reset link to. Submitting does nothing in Storybook. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
