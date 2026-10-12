import { afterEach, describe, expect, test, vi } from "vitest";
import { api, setTransport } from "~/lib/api";
import { parseDashboard } from "~/lib/dashboard";
import { parseMe } from "~/lib/me";
import { parsePersona } from "~/mock/persona";
import { createMockTransport, type MockConfig } from "~/mock/transport";
import { installMockTurnstile, MOCK_SITE_KEY, MOCK_TOKEN_PREFIX } from "~/mock/turnstile";

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

/** What the sign-in page sends: the made-up token the mock widget hands out, in the real header. */
function signIn(local: string, token?: string) {
  return api("/api/auth/sign-in/email", {
    method: "POST",
    json: { email: `${local}@contoh.test`, password: "x" },
    turnstileToken: token,
  });
}
const forgot = (local: string, token?: string) =>
  api("/api/auth/request-password-reset", {
    method: "POST",
    json: { email: `${local}@contoh.test`, redirectTo: "/reset-password" },
    turnstileToken: token,
  });

/** A session that is already there, for the tests that are not about signing in. */
const SIGNED_IN: MockConfig["session"] = { get: () => true, set: () => {} };

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
    expect((await signIn("ani", "mock-turnstile-token-1")).ok).toBe(true);
    const me = await api<unknown>("/api/me");
    expect(me.ok && parseMe(me.data)).toMatchObject({
      role: "editor",
      areas: { granted: ["konten"], visible: ["konten"], writable: ["konten"] },
    });
    await api("/api/auth/sign-out", { method: "POST", json: {} });
    expect(await api("/api/me")).toMatchObject({ ok: false, status: 401 });
  });

  test("the documented sign-in failures", async () => {
    setup();
    let n = 0;
    const attempt = (local: string) => signIn(local, `${MOCK_TOKEN_PREFIX}f${(n += 1)}`);
    expect(await attempt("salah")).toMatchObject({ ok: false, status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(await attempt("belum-verifikasi")).toMatchObject({ ok: false, status: 403, code: "EMAIL_NOT_VERIFIED" });
    expect(await attempt("dibatasi")).toMatchObject({ ok: false, status: 429, retryAfter: 60 });
    expect(await attempt("offline")).toEqual({ ok: false, status: 0 });
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

  test("the dashboard answers in the documented shape, in every mode, for every persona", async () => {
    for (const persona of ["viewer", "editor", "editor:konten", "editor:komunikasi", "editor:-", "super_admin"]) {
      for (const dashboard of ["ready", "empty"] as const) {
        setup({ dashboard, persona: parsePersona(persona), session: SIGNED_IN });
        const result = await api<unknown>("/api/dashboard");
        expect(result.ok && parseDashboard(result.data), `${persona} ${dashboard}`).not.toBeNull();
      }
    }
    setup({ dashboard: "error", session: SIGNED_IN });
    expect(await api("/api/dashboard")).toMatchObject({ ok: false, status: 500 });
    setup({ dashboard: "unavailable", session: SIGNED_IN });
    expect(await api("/api/dashboard")).toMatchObject({ ok: false, status: 404 });
  });

  test("the mock dashboard holds only what the persona may see, like the Worker", async () => {
    const attentionOf = async (persona: string) => {
      setup({ persona: parsePersona(persona), session: SIGNED_IN });
      const result = await api<{ attention: Record<string, unknown> }>("/api/dashboard");
      return result.ok ? Object.keys(result.data.attention).sort() : result;
    };
    const full = ["batch", "pendingApplications", "underReviewApplications", "unreadMessages"];
    expect(await attentionOf("super_admin")).toEqual(full);
    expect(await attentionOf("viewer")).toEqual(full);
    expect(await attentionOf("editor")).toEqual(full);
    expect(await attentionOf("editor:pendaftaran")).toEqual(["batch", "pendingApplications", "underReviewApplications"]);
    expect(await attentionOf("editor:komunikasi")).toEqual(["unreadMessages"]);
    expect(await attentionOf("editor:konten")).toEqual([]);
    expect(await attentionOf("editor:-")).toEqual([]);
  });

  test("the mock dashboard is refused to a student and to nobody signed in, like the Worker", async () => {
    setup({ persona: { role: "student", granted: [] }, session: SIGNED_IN });
    expect(await api("/api/dashboard")).toMatchObject({ ok: false, status: 403 });
    setup();
    expect(await api("/api/dashboard")).toMatchObject({ ok: false, status: 401 });
  });

  test("a viewer cannot create an announcement, like the Worker", async () => {
    setup({ persona: { role: "viewer", granted: [] } });
    expect(await api("/api/admin/announcements", { method: "POST", json: { title: "Halo dunia", body: "Isi pengumuman" } })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  test("an editor of another area cannot even read the announcements, like the Worker; a viewer can", async () => {
    setup({ persona: { role: "editor", granted: ["konten"] } });
    expect(await api("/api/announcements")).toMatchObject({ ok: false, status: 403 });
    setup({ persona: { role: "editor", granted: ["komunikasi"] } });
    expect((await api("/api/announcements")).ok).toBe(true);
    setup({ persona: { role: "viewer", granted: [] } });
    expect((await api("/api/announcements")).ok).toBe(true);
  });

  test("an unknown route is a 404", async () => {
    setup();
    expect(await api("/api/nope")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("the mock's security check", () => {
  test("/api/config offers a site key, so the pages draw the (mock) widget", async () => {
    setup();
    expect(await api("/api/config")).toEqual({ ok: true, data: { google: true, turnstileSiteKey: MOCK_SITE_KEY, uploadsBaseUrl: "" } });
  });

  test("sign-in and forgot-password refuse a request without a made-up token, like the Worker", async () => {
    setup();
    expect(await signIn("ani")).toMatchObject({ ok: false, status: 403, code: "captcha_failed" });
    expect(await forgot("ani")).toMatchObject({ ok: false, status: 403, code: "captcha_failed" });
    expect(await signIn("ani", "not-from-the-widget")).toMatchObject({ ok: false, status: 403, code: "captcha_failed" });
    expect((await forgot("ani", `${MOCK_TOKEN_PREFIX}1`)).ok).toBe(true);
  });

  test("a token works once: a page that forgets to reset the widget meets captcha_failed here too", async () => {
    setup();
    expect(await signIn("salah", `${MOCK_TOKEN_PREFIX}7`)).toMatchObject({ ok: false, status: 401 }); // spent, whatever the answer
    expect(await signIn("ani", `${MOCK_TOKEN_PREFIX}7`)).toMatchObject({ ok: false, status: 403, code: "captcha_failed" });
    expect((await signIn("ani", `${MOCK_TOKEN_PREFIX}8`)).ok).toBe(true);
  });

  test("the documented addresses: captcha-gagal, captcha-tidak-tersedia, email-tidak-tersedia", async () => {
    setup();
    expect(await signIn("captcha-gagal", `${MOCK_TOKEN_PREFIX}1`)).toMatchObject({ ok: false, status: 403, code: "captcha_failed" });
    expect(await signIn("captcha-tidak-tersedia", `${MOCK_TOKEN_PREFIX}2`)).toMatchObject({ ok: false, status: 503, code: "captcha_unavailable" });
    expect(await forgot("captcha-gagal", `${MOCK_TOKEN_PREFIX}3`)).toMatchObject({ ok: false, status: 403, code: "captcha_failed" });
    expect(await forgot("captcha-tidak-tersedia", `${MOCK_TOKEN_PREFIX}4`)).toMatchObject({ ok: false, status: 503, code: "captcha_unavailable" });
    expect(await forgot("email-tidak-tersedia", `${MOCK_TOKEN_PREFIX}5`)).toMatchObject({ ok: false, status: 503, code: "email_unavailable" });
  });

  test("in the Worker's order: no email service, then the rate limit, then the token", async () => {
    setup();
    expect(await forgot("email-tidak-tersedia")).toMatchObject({ status: 503, code: "email_unavailable" }); // no token needed to hear it
    expect(await forgot("dibatasi")).toMatchObject({ status: 429, retryAfter: 60 });
    expect(await signIn("dibatasi")).toMatchObject({ status: 429, retryAfter: 60 });
  });
});

describe("the mock widget", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete window.turnstile;
  });

  test("solves itself after a moment, and again after every reset, with a new made-up token each time", () => {
    vi.useFakeTimers();
    installMockTurnstile();
    const box = document.createElement("div");
    const tokens: string[] = [];
    const id = window.turnstile!.render(box, {
      sitekey: MOCK_SITE_KEY,
      action: "login",
      theme: "light",
      size: "flexible",
      language: "id",
      callback: (token) => tokens.push(token),
      "expired-callback": () => {},
      "timeout-callback": () => {},
      "error-callback": () => {},
    })!;
    expect(box.textContent).toContain("memeriksa");
    expect(tokens).toEqual([]);

    vi.advanceTimersByTime(1000);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatch(new RegExp(`^${MOCK_TOKEN_PREFIX}`));
    expect(box.textContent).toContain("berhasil");

    window.turnstile!.reset(id);
    expect(box.textContent).toContain("memeriksa");
    vi.advanceTimersByTime(1000);
    expect(tokens).toHaveLength(2);
    expect(tokens[1]).not.toBe(tokens[0]);

    window.turnstile!.remove(id);
    expect(box.textContent).toBe("");
    window.turnstile!.reset(id); // unknown now: nothing happens
    vi.advanceTimersByTime(5000);
    expect(tokens).toHaveLength(2);
  });
});
