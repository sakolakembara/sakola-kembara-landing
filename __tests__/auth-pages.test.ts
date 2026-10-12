import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Renders the five auth pages (server components) with the auth setup, the
// server actions and the account service replaced at the module boundary, to
// pin what each page shows and in which order: one heading, the form first,
// "atau" and the Google button after it, the footer link last.

const { authStatus, verify } = vi.hoisted(() => ({
  authStatus: { googleConfigured: true },
  verify: { result: { ok: true } as { ok: true } | { ok: false; reason: string } },
}));

vi.mock("@/auth", () => ({ authStatus, signIn: vi.fn() }));
vi.mock("@/app/(auth)/login/actions", () => ({ credentialsSignIn: vi.fn() }));
vi.mock("@/app/(auth)/register/actions", () => ({ registerStudent: vi.fn() }));
vi.mock("@/app/(auth)/forgot-password/actions", () => ({ requestPasswordResetAction: vi.fn() }));
vi.mock("@/app/(auth)/reset-password/actions", () => ({ resetPasswordAction: vi.fn() }));
vi.mock("@/lib/account-service", () => ({ verifyEmailByToken: vi.fn(async () => verify.result) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

import LoginPage from "@/app/(auth)/login/page";
import RegisterPage from "@/app/(auth)/register/page";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";

const html = (page: ReactElement) => renderToStaticMarkup(page);

/** Every needle appears, and in the order given. */
function expectInOrder(markup: string, needles: string[]) {
  let last = -1;
  for (const needle of needles) {
    const at = markup.indexOf(needle, last + 1);
    expect(at, `"${needle}" should come after the one before it`).toBeGreaterThan(last);
    last = at;
  }
}

beforeEach(() => {
  authStatus.googleConfigured = true;
  verify.result = { ok: true };
});

describe("/login", () => {
  const render = async (searchParams: { from?: string; error?: string } = {}) =>
    html(await LoginPage({ searchParams: Promise.resolve(searchParams) }));

  it("has one heading, then the form, the 'atau' rule, Google, and the sign-up link", async () => {
    const markup = await render();
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("Masuk ke Sakola Kembara</h1>");
    expectInOrder(markup, [
      "</h1>",
      'name="email"',
      "Lupa password?",
      'name="password"',
      ">Masuk</button>",
      ">atau<",
      "Masuk dengan Google",
      "Belum punya akun?",
      "Daftar di sini",
    ]);
  });

  it("drops the card, the brand name and the stacked intro text", async () => {
    const markup = await render();
    expect(markup).not.toContain("Selamat datang kembali");
    expect(markup).not.toContain("Masuk untuk mendaftar sebagai calon siswa");
    expect(markup).not.toContain("Gunakan akun Google atau email");
    expect(markup).not.toContain("rounded-2xl");
    expect(markup).not.toContain('href="/"');
  });

  it("shows neither 'atau' nor the Google button when Google is not configured", async () => {
    authStatus.googleConfigured = false;
    const markup = await render();
    expect(markup).toContain('name="email"');
    expect(markup).not.toContain(">atau<");
    expect(markup).not.toContain("Masuk dengan Google");
  });

  it("keeps the labels, autocomplete values and the password link", async () => {
    const markup = await render();
    expect(markup).toContain('for="cred-email"');
    expect(markup).toMatch(/autocomplete="email"/i);
    expect(markup).toMatch(/autocomplete="current-password"/i);
    expect(markup).toContain('href="/forgot-password"');
  });

  it("shows the error above the form, as an alert", async () => {
    const markup = await render({ error: "CredentialsSignin" });
    expect(markup).toContain('role="alert"');
    expectInOrder(markup, ["</h1>", "Email atau password salah.", 'name="email"']);
  });

  it("carries a safe `from` to the form, the password link and the sign-up link, and drops an unsafe one", async () => {
    const safe = await render({ from: "/portal/daftar" });
    expect(safe).toContain('name="from"');
    expect(safe).toContain("/forgot-password?from=%2Fportal%2Fdaftar");
    expect(safe).toContain("/register?from=%2Fportal%2Fdaftar");

    const unsafe = await render({ from: "//evil.example" });
    expect(unsafe).not.toContain('name="from"');
    expect(unsafe).not.toContain("evil.example");
    expect(unsafe).toContain('href="/register"');
  });
});

describe("/register", () => {
  const render = async (searchParams: { from?: string } = {}) =>
    html(await RegisterPage({ searchParams: Promise.resolve(searchParams) }));

  it("has one heading and its description, then the form, 'atau', Google, and the sign-in link", async () => {
    const markup = await render();
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expectInOrder(markup, [
      "Daftar akun baru</h1>",
      "Data pendaftaran kamu akan tersimpan pada akun ini agar bisa dibuka kembali kapan saja.",
      'name="name"',
      'name="confirmPassword"',
      ">Daftar</button>",
      ">atau<",
      "Masuk dengan Google",
      "Sudah punya akun?",
      "Masuk di sini",
    ]);
    expect(markup).not.toContain("Buat akun untuk mendaftar sebagai calon siswa");
    expect(markup).not.toContain("rounded-2xl");
    expect(markup).not.toContain('href="/"');
  });

  it("shows no Google button or 'atau' when Google is not configured", async () => {
    authStatus.googleConfigured = false;
    const markup = await render();
    expect(markup).not.toContain(">atau<");
    expect(markup).not.toContain("Masuk dengan Google");
  });

  it("carries a safe `from` to the sign-in link", async () => {
    const markup = await render({ from: "/portal/daftar" });
    expect(markup).toContain("/login?from=%2Fportal%2Fdaftar");
  });
});

describe("/forgot-password", () => {
  it("has one heading, its instructions, the form, and the way back under a rule", () => {
    const markup = html(ForgotPasswordPage());
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expectInOrder(markup, [
      "Lupa password?</h1>",
      "Masukkan email akun kamu. Kami akan mengirim tautan untuk mengatur ulang password ke inbox tersebut.",
      'name="website"',
      'name="email"',
      "Kirim tautan reset",
      "border-t",
      "Ingat lagi password kamu?",
      "Kembali ke halaman masuk",
    ]);
    expect(markup).not.toContain("rounded-2xl");
    expect(markup).not.toContain('href="/"');
  });
});

describe("/reset-password", () => {
  const render = async (token?: string) => html(await ResetPasswordPage({ searchParams: Promise.resolve({ token }) }));

  it("with a token: heading, instructions, the form with the token, and the way back", async () => {
    const markup = await render("contoh-token");
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expectInOrder(markup, [
      "Reset password</h1>",
      "Pilih password baru. Setelah disimpan, kamu langsung masuk ke portal siswa.",
      'name="token"',
      'name="password"',
      'name="confirmPassword"',
      "Ganti password",
      "border-t",
      "Kembali ke halaman masuk",
    ]);
    expect(markup).toContain('value="contoh-token"');
    expect(markup).not.toContain("rounded-2xl");
    expect(markup).not.toContain('href="/"');
  });

  it("without a token: the heading and the warning with the link, no form and no instructions", async () => {
    const markup = await render();
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("Tautan reset tidak lengkap.");
    expect(markup).toContain('href="/forgot-password"');
    expect(markup).toContain("Kembali ke halaman masuk");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Pilih password baru.");
  });
});

describe("/verify-email", () => {
  const render = async (token = "tok") => html(await VerifyEmailPage({ searchParams: Promise.resolve({ token }) }));

  it("success: the headline, a success banner with the details, and one button to the portal", async () => {
    const markup = await render();
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expectInOrder(markup, [
      "Email kamu berhasil diverifikasi</h1>",
      "Akun kamu sekarang sudah aktif sepenuhnya.",
      "Ke Portal Siswa",
    ]);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('href="/portal"');
    // The eyebrow said the same thing as the headline.
    expect(markup).not.toContain("Terverifikasi");
  });

  it.each([
    ["invalid_token", "Tautan verifikasi tidak valid atau sudah kadaluarsa."],
    ["user_not_found", "Akun yang terkait tautan ini sudah tidak ada."],
    ["email_changed", "Email kamu sudah berubah sejak tautan ini dibuat."],
  ])("failure (%s): the headline, an error banner with the reason, and a way to sign in", async (reason, text) => {
    verify.result = { ok: false, reason };
    const markup = await render();
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expectInOrder(markup, ["Tautan verifikasi tidak dapat diproses</h1>", text, ">Masuk</a>"]);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('href="/login"');
    expect(markup).not.toContain(">Gagal<");
  });
});
