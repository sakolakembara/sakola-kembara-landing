import { describe, expect, test } from "vitest";
import { api, setTransport } from "~/lib/api";
import { parseDashboard } from "~/lib/dashboard";
import { parseMe } from "~/lib/me";
import { parsePersona } from "~/mock/persona";
import { createMockTransport, type MockConfig } from "~/mock/transport";

// The mock is not shipped, but it is how the screens are reviewed without a
// backend, so it has to keep speaking the same shapes as the real API.

describe("parsePersona", () => {
  test("roles", () => {
    expect(parsePersona("viewer")).toEqual({ role: "viewer", granted: [] });
    expect(parsePersona("super_admin")).toEqual({ role: "super_admin", granted: [] });
    expect(parsePersona("student")).toEqual({ role: "student", granted: [] });
  });
  test("an editor alone has every area, or the ones listed", () => {
    expect(parsePersona("editor")).toEqual({ role: "editor", granted: ["pendaftaran", "komunikasi", "konten"] });
    expect(parsePersona("editor:konten,komunikasi")).toEqual({ role: "editor", granted: ["konten", "komunikasi"] });
    expect(parsePersona("editor:-")).toEqual({ role: "editor", granted: [] });
    expect(parsePersona("editor:konten,bogus")).toEqual({ role: "editor", granted: ["konten"] });
  });
  test("anything else is super_admin", () => {
    expect(parsePersona(null)).toEqual({ role: "super_admin", granted: [] });
    expect(parsePersona("nobody")).toEqual({ role: "super_admin", granted: [] });
  });
});

function setup(overrides: Partial<MockConfig> = {}) {
  let signedIn = false;
  setTransport(
    createMockTransport({
      persona: { role: "editor", granted: ["konten"] },
      dashboard: "ready",
      delayMs: 0,
      session: { get: () => signedIn, set: (value) => (signedIn = value) },
      ...overrides,
    }),
  );
}

describe("mock transport", () => {
  test("no session until sign-in, and again after sign-out", async () => {
    setup();
    expect(await api("/api/me")).toMatchObject({ ok: false, status: 401 });
    expect((await api("/api/auth/sign-in/email", { method: "POST", json: { email: "ani@contoh.test", password: "x" } })).ok).toBe(true);
    const me = await api<unknown>("/api/me");
    expect(me.ok && parseMe(me.data)).toMatchObject({
      role: "editor",
      areas: { granted: ["konten"], visible: ["pendaftaran", "komunikasi", "konten"], writable: ["konten"] },
    });
    await api("/api/auth/sign-out", { method: "POST", json: {} });
    expect(await api("/api/me")).toMatchObject({ ok: false, status: 401 });
  });

  test("the documented sign-in failures", async () => {
    setup();
    const signIn = (local: string) => api("/api/auth/sign-in/email", { method: "POST", json: { email: `${local}@contoh.test`, password: "x" } });
    expect(await signIn("salah")).toMatchObject({ ok: false, status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(await signIn("belum-verifikasi")).toMatchObject({ ok: false, status: 403, code: "EMAIL_NOT_VERIFIED" });
    expect(await signIn("dibatasi")).toMatchObject({ ok: false, status: 429, retryAfter: 60 });
    expect(await signIn("offline")).toEqual({ ok: false, status: 0 });
  });

  test("reset: any token works except the spent one", async () => {
    setup();
    expect((await api("/api/auth/reset-password", { method: "POST", json: { token: "abc", newPassword: "x" } })).ok).toBe(true);
    expect(await api("/api/auth/reset-password", { method: "POST", json: { token: "kedaluwarsa", newPassword: "x" } })).toMatchObject({
      ok: false,
      status: 400,
      code: "INVALID_TOKEN",
    });
  });

  test("the dashboard answers in the documented shape, in every mode", async () => {
    for (const dashboard of ["ready", "empty"] as const) {
      setup({ dashboard });
      const result = await api<unknown>("/api/dashboard");
      expect(result.ok && parseDashboard(result.data), dashboard).not.toBeNull();
    }
    setup({ dashboard: "error" });
    expect(await api("/api/dashboard")).toMatchObject({ ok: false, status: 500 });
    setup({ dashboard: "unavailable" });
    expect(await api("/api/dashboard")).toMatchObject({ ok: false, status: 404 });
  });

  test("a viewer cannot create an announcement, like the Worker", async () => {
    setup({ persona: { role: "viewer", granted: [] } });
    expect(await api("/api/announcements", { method: "POST", json: { title: "Halo dunia", body: "Isi pengumuman" } })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  test("an unknown route is a 404", async () => {
    setup();
    expect(await api("/api/nope")).toMatchObject({ ok: false, status: 404 });
  });
});
