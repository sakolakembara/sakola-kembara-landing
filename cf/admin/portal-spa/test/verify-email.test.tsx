import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { renderApp, stubApi } from "./helpers";

describe("the page a verification link lands on", () => {
  async function open(search: string) {
    const api = stubApi({});
    renderApp(`/portal/verify-email${search}`);
    await screen.findByRole("heading", { level: 1 });
    return api;
  }

  test("?status=success: it worked, in the login layout, and the way on is 'Masuk' (verifying does not sign anyone in)", async () => {
    const api = await open("?status=success");
    expect(screen.getByRole("heading", { level: 1, name: "Email kamu berhasil diverifikasi" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Akun kamu sekarang sudah aktif. Silakan masuk untuk melanjutkan.");
    expect(screen.getByRole("link", { name: "Masuk" }).getAttribute("href")).toBe("/portal/login");
    expect(document.title).toBe("Verifikasi Email | Portal Siswa");
    expect(api.calls).toHaveLength(0); // it only reports; it calls nothing
  });

  test("?error=: the link is spent or expired, and what to do", async () => {
    await open("?error=INVALID_TOKEN");
    expect(screen.getByRole("heading", { level: 1, name: "Tautan verifikasi tidak dapat diproses" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Tautan verifikasi tidak valid atau sudah kadaluarsa");
  });

  test("?error= wins over ?status=success (the callback is /verify-email?status=success&error=...)", async () => {
    await open("?status=success&error=TOKEN_EXPIRED");
    expect(screen.getByRole("heading", { level: 1, name: "Tautan verifikasi tidak dapat diproses" })).toBeTruthy();
    expect(screen.queryByText("Email kamu berhasil diverifikasi")).toBeNull();
  });

  test("opened by hand it claims nothing", async () => {
    await open("");
    expect(screen.getByRole("heading", { level: 1, name: "Tautan verifikasi tidak lengkap" })).toBeTruthy();
    expect(screen.queryByText(/berhasil/)).toBeNull();
  });
});

describe("the page Better Auth sends the browser to when a Google step fails", () => {
  test("a known code has its own line, in the login layout", async () => {
    stubApi({});
    renderApp("/portal/auth/error?error=access_denied");
    expect(await screen.findByRole("heading", { level: 1, name: "Gagal masuk" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Izin masuk dengan Google tidak diberikan. Silakan coba lagi jika itu tidak disengaja.");
    expect(screen.getByRole("link", { name: "Kembali ke halaman masuk" }).getAttribute("href")).toBe("/portal/login");
  });

  test("anything else gets the generic line and is never echoed", async () => {
    stubApi({});
    renderApp("/portal/auth/error?error=%3Cscript%3Ex%3C%2Fscript%3E");
    expect((await screen.findByRole("alert")).textContent).toBe("Gagal masuk. Silakan coba lagi.");
    expect(document.body.innerHTML).not.toContain("<script>x");
  });
});
