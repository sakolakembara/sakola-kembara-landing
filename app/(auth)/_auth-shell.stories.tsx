import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { AUTH_LINK, AuthShell } from "./_auth-shell";

const meta = {
  title: "Auth/Layout",
  component: AuthShell,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { title: "Masuk ke Sakola Kembara", children: null },
} satisfies Meta<typeof AuthShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A narrow column on a plain white page: one heading, then the form. No card, no brand name above it. */
export const TitleOnly: Story = {
  args: {
    children: (
      <>
        <Field id="shell-email" label="Email">
          <Input type="email" name="email" placeholder="nama@contoh.com" />
        </Field>
        <Button type="button" size="lg" fullWidth>
          Masuk
        </Button>
      </>
    ),
  },
};

/** A description only where it holds instructions, and a footer link under a thin rule. */
export const WithDescriptionAndFooter: Story = {
  args: {
    title: "Lupa password?",
    description: "Masukkan email akun kamu. Kami akan mengirim tautan untuk mengatur ulang password ke inbox tersebut.",
    footer: (
      <>
        Ingat lagi password kamu?{" "}
        <Link href="/login" className={AUTH_LINK}>
          Kembali ke halaman masuk
        </Link>
      </>
    ),
    children: (
      <>
        <Field id="shell-forgot-email" label="Email">
          <Input type="email" name="email" placeholder="nama@contoh.com" />
        </Field>
        <Button type="button" size="lg" fullWidth>
          Kirim tautan reset
        </Button>
      </>
    ),
  },
};

/** A page with no form, like the result of an email link: the title, a banner and one button. */
export const Result: Story = {
  args: {
    title: "Email kamu berhasil diverifikasi",
    children: (
      <>
        <Alert tone="success">
          Akun kamu sekarang sudah aktif sepenuhnya. Kamu bisa langsung mengisi formulir pendaftaran dari portal siswa.
        </Alert>
        <Button href="/portal" size="lg" fullWidth>
          Ke Portal Siswa
        </Button>
      </>
    ),
  },
};

export const OnPhone: Story = {
  ...WithDescriptionAndFooter,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
