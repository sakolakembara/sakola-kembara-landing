import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import Link from "next/link";
import { AUTH_LINK, AuthDivider, AuthShell } from "../_auth-shell";
import { GoogleButton } from "../login/_google-button";
import { RegisterForm } from "./_register-form";

/** The page around the form, as on `/register`. */
const registerPage: Decorator = (Story) => (
  <AuthShell
    title="Daftar akun baru"
    description="Data pendaftaran kamu akan tersimpan pada akun ini agar bisa dibuka kembali kapan saja."
    footer={
      <>
        Sudah punya akun?{" "}
        <Link href="/login" className={AUTH_LINK}>
          Masuk di sini
        </Link>
      </>
    }
  >
    <Story />
  </AuthShell>
);

const meta = {
  title: "Auth/Register",
  component: RegisterForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [registerPage],
  args: { from: null },
} satisfies Meta<typeof RegisterForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The student sign-up form on `/register`. Submitting does nothing in Storybook. */
export const Default: Story = {};

/** With Google configured: the form first, then the "atau" rule and the Google button. */
export const WithGoogle: Story = {
  render: (args) => (
    <>
      <RegisterForm {...args} />
      <AuthDivider />
      <form onSubmit={(e) => e.preventDefault()}>
        <GoogleButton />
      </form>
    </>
  ),
};

export const OnPhone: Story = {
  ...WithGoogle,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
