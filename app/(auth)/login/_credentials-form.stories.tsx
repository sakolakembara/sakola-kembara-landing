import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import Link from "next/link";
import { AUTH_LINK, AuthDivider, AuthShell } from "../_auth-shell";
import { CredentialsForm } from "./_credentials-form";
import { GoogleButton } from "./_google-button";

/** The page around the form, as on `/login`. */
const loginPage: Decorator = (Story) => (
  <AuthShell
    title="Masuk ke Sakola Kembara"
    footer={
      <>
        Belum punya akun?{" "}
        <Link href="/register" className={AUTH_LINK}>
          Daftar di sini
        </Link>
      </>
    }
  >
    <Story />
  </AuthShell>
);

const meta = {
  title: "Auth/Login",
  component: CredentialsForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [loginPage],
  args: { from: null },
} satisfies Meta<typeof CredentialsForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page without Google (when it is not configured): the email and password form. Signing in does nothing in Storybook. */
export const Credentials: Story = {};

/** The page as on `/login` with Google: the form first, then the "atau" rule and the Google button. */
export const WithGoogle: Story = {
  render: (args) => (
    <>
      <CredentialsForm {...args} />
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
