import { setTransport } from "@shared/spa/api";
import { TURNSTILE_HEADER } from "@shared/spa/captcha";
import { MOCK_TOKEN_PREFIX } from "@shared/spa/mock-turnstile";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { installMockApi } from "~/mock/install";
import { type Persona, PERSONAS, parsePersona } from "~/mock/persona";
import { createMockTransport } from "~/mock/transport";
import { parseOverview } from "~/lib/overview";
import { parseStatusItems } from "~/lib/status";
import { ENDPOINTS } from "~/lib/paths";
import { renderApp } from "./helpers";

// The mock (`pnpm dev:portal-spa:mock`) answers every call the portal makes, in the Worker's shapes, so Dzul can look
// at every screen without a Worker. These tests keep it honest: it follows the contract (docs/cloudflare/portal-api.md),
// the personas reach every state of the home and status pages, and it never answers a call the pages make with a 404.

function transportFor(persona: Persona, signedIn = true) {
  let session = signedIn;
  const transport = createMockTransport({ persona, delayMs: 0, session: { get: () => session, set: (value) => void (session = value) } });
  return { transport, session: () => session };
}

const call = (transport: ReturnType<typeof transportFor>["transport"], method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  transport(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });

const token = (n = 1) => ({ [TURNSTILE_HEADER]: `${MOCK_TOKEN_PREFIX}${n}` });

describe("the personas", () => {
  test("the names, and an unknown one is the default", () => {
    expect(PERSONAS).toContain("open");
    expect(parsePersona("submitted")).toBe("submitted");
    expect(parsePersona("kucing")).toBe("open");
    expect(parsePersona(null)).toBe("open");
    expect(parsePersona(undefined)).toBe("open");
  });

  test.each(PERSONAS)("%s: the overview and the status list have the shapes the pages parse", async (persona) => {
    const { transport } = transportFor(persona);
    if (persona === "admin-account" || persona === "error") return;
    const overview = parseOverview(await (await call(transport, "GET", ENDPOINTS.overview)).json());
    expect(overview, persona).not.toBeNull();
    const items = parseStatusItems(await (await call(transport, "GET", ENDPOINTS.applications)).json());
    expect(items, persona).not.toBeNull();
  });

  test("each persona is in the state its name says", async () => {
    const overviewOf = async (persona: Persona) => parseOverview(await (await call(transportFor(persona).transport, "GET", ENDPOINTS.overview)).json())!;
    expect((await overviewOf("open")).openBatch).not.toBeNull();
    expect((await overviewOf("open")).current.state).toBe("none");
    expect((await overviewOf("no-batch")).openBatch).toBeNull();
    expect((await overviewOf("draft")).current.state).toBe("draft");
    expect((await overviewOf("submitted")).current.state).toBe("submitted");
    expect((await overviewOf("submitted")).history.map((item) => item.published)).toEqual([false]);
    for (const persona of ["published-accepted", "published-rejected", "published-undecided"] as const) {
      const overview = await overviewOf(persona);
      expect(overview.openBatch, persona).toBeNull();
      expect(overview.history.map((item) => item.published), persona).toEqual([true]);
    }
  });

  test("before publication the mock, like the Worker, sends nothing but `processing`", async () => {
    const { transport } = transportFor("submitted");
    const body = await (await call(transport, "GET", ENDPOINTS.applications)).json();
    expect(JSON.stringify(body)).not.toMatch(/accepted|rejected|decided|reviewNotes|status/);
    expect(body.items[0].result).toEqual({ state: "processing" });
  });

  test("an unverified persona says so in /me; an admin persona has a role that is not a student's", async () => {
    expect((await (await call(transportFor("unverified").transport, "GET", ENDPOINTS.me)).json()).user.emailVerified).toBe(false);
    expect((await (await call(transportFor("admin-account").transport, "GET", ENDPOINTS.me)).json()).user.role).toBe("editor");
    expect((await (await call(transportFor("open").transport, "GET", ENDPOINTS.me)).json()).user.role).toBe("student");
  });
});

describe("the Worker's pipeline, as far as the mock plays it", () => {
  test("no session: 401 for /me and for the data routes", async () => {
    const { transport } = transportFor("open", false);
    for (const path of [ENDPOINTS.me, ENDPOINTS.overview, ENDPOINTS.applications]) expect((await call(transport, "GET", path)).status, path).toBe(401);
  });

  test("an admin account: /me answers, the data routes are 403 student_only", async () => {
    const { transport } = transportFor("admin-account");
    expect((await call(transport, "GET", ENDPOINTS.me)).status).toBe(200);
    for (const path of [ENDPOINTS.overview, ENDPOINTS.applications]) {
      const res = await call(transport, "GET", path);
      expect(res.status, path).toBe(403);
      expect((await res.json()).error).toBe("student_only");
    }
  });

  test("the `error` persona fails the data routes with a 500", async () => {
    const { transport } = transportFor("error");
    expect((await call(transport, "GET", ENDPOINTS.overview)).status).toBe(500);
    expect((await call(transport, "GET", ENDPOINTS.applications)).status).toBe(500);
  });

  test("config: Google on, the mock's site key, the public site's and the admin's address", async () => {
    const body = await (await call(transportFor("open").transport, "GET", ENDPOINTS.config)).json();
    expect(body).toMatchObject({ google: true, turnstileSiteKey: "mock-site-key" });
    expect(typeof body.siteUrl).toBe("string");
    expect(typeof body.adminUrl).toBe("string");
  });
});

describe("sign-in", () => {
  const signIn = (transport: ReturnType<typeof transportFor>["transport"], local: string, n = 1) => call(transport, "POST", ENDPOINTS.signIn, { email: `${local}@contoh.test`, password: "x" }, token(n));

  test("any address and password, with the made-up token, signs in; the token works once", async () => {
    const { transport, session } = transportFor("open", false);
    expect((await signIn(transport, "sari")).status).toBe(200);
    expect(session()).toBe(true);
    expect((await signIn(transport, "sari")).status).toBe(403); // the same token again: spent
  });

  test.each([
    ["salah", 401, "INVALID_EMAIL_OR_PASSWORD"],
    ["belum-verifikasi", 403, "EMAIL_NOT_VERIFIED"],
    ["dibatasi", 429, "rate_limited"],
    ["captcha-gagal", 403, "captcha_failed"],
    ["captcha-tidak-tersedia", 503, "captcha_unavailable"],
  ])("%s", async (local, status, code) => {
    const { transport, session } = transportFor("open", false);
    const res = await signIn(transport, local);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code ?? body.error).toBe(code);
    expect(session()).toBe(false);
  });

  test("offline: the request fails before an answer", async () => {
    await expect(signIn(transportFor("open", false).transport, "offline")).rejects.toThrow();
  });

  test("without the token: 403 captcha_failed", async () => {
    const res = await call(transportFor("open", false).transport, "POST", ENDPOINTS.signIn, { email: "sari@contoh.test", password: "x" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("captcha_failed");
  });

  test("sign-out ends the session", async () => {
    const { transport, session } = transportFor("open", true);
    expect((await call(transport, "POST", ENDPOINTS.signOut, {})).status).toBe(200);
    expect(session()).toBe(false);
  });
});

describe("registration, resend, reset", () => {
  test("registration answers the same for every address, behind the token", async () => {
    const { transport } = transportFor("open", false);
    const a = await call(transport, "POST", ENDPOINTS.register, { email: "baru@contoh.test" }, token(1));
    const b = await call(transport, "POST", ENDPOINTS.register, { email: "sudah-ada@contoh.test" }, token(2));
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect((await call(transport, "POST", ENDPOINTS.register, { email: "baru@contoh.test" })).status).toBe(403);
  });

  test.each([
    ["email-tidak-tersedia", 503, "email_unavailable"],
    ["kuota-penuh", 503, "email_quota"],
    ["dibatasi", 429, "rate_limited"],
    ["isian-salah", 400, "invalid"],
  ])("registration: %s", async (local, status, code) => {
    const res = await call(transportFor("open", false).transport, "POST", ENDPOINTS.register, { email: `${local}@contoh.test` }, token(1));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(code);
  });

  test("resend and forgot-password: the token, and the same refusals", async () => {
    const { transport } = transportFor("open", false);
    expect((await call(transport, "POST", ENDPOINTS.sendVerification, { email: "a@contoh.test" }, token(1))).status).toBe(200);
    expect((await call(transport, "POST", ENDPOINTS.sendVerification, { email: "kuota-penuh@contoh.test" }, token(2))).status).toBe(503);
    expect((await call(transport, "POST", ENDPOINTS.requestReset, { email: "a@contoh.test" }, token(3))).status).toBe(200);
    expect((await call(transport, "POST", ENDPOINTS.requestReset, { email: "a@contoh.test" })).status).toBe(403);
  });

  test("reset: 'kedaluwarsa' is refused as spent, any other token works", async () => {
    const { transport } = transportFor("open", false);
    expect((await call(transport, "POST", ENDPOINTS.resetPassword, { token: "kedaluwarsa", newPassword: "x" })).status).toBe(400);
    expect((await call(transport, "POST", ENDPOINTS.resetPassword, { token: "abc", newPassword: "x" })).status).toBe(200);
  });

  test("Google signs the student in and answers where to go", async () => {
    const { transport, session } = transportFor("open", false);
    const body = await (await call(transport, "POST", ENDPOINTS.signInSocial, { provider: "google", callbackURL: "/portal/" })).json();
    expect(body.url).toMatch(/\/portal\/$/);
    expect(session()).toBe(true);
  });
});

describe("the whole portal through the mock", () => {
  const SCREENS: Record<Persona, [home: string, status: string]> = {
    open: ["Gen 6 - 2026/2027", "Belum ada pendaftaran"],
    "no-batch": ["Belum ada batch yang dibuka", "Belum ada pendaftaran"],
    draft: ["Gen 6 - 2026/2027", "Belum ada pendaftaran"],
    submitted: ["Pendaftaran kamu untuk Gen 6 - 2026/2027 sudah kami terima", "Pendaftaran kamu sedang diproses"],
    "published-accepted": ["Hasil pendaftaran kamu sudah keluar", "Kamu diterima"],
    "published-rejected": ["Hasil pendaftaran kamu sudah keluar", "Belum lolos tahun ini"],
    "published-undecided": ["Hasil pendaftaran kamu sudah keluar", "Menunggu keputusan"],
    unverified: ["Verifikasi email kamu untuk mengaktifkan seluruh fitur", "Belum ada pendaftaran"],
    "admin-account": ["Akun ini bukan akun calon siswa", "Akun ini bukan akun calon siswa"],
    error: ["Pendaftaran kamu tidak terhapus", "Pendaftaran kamu tidak terhapus"],
  };

  test.each(PERSONAS)("%s: the home and the status pages, and not one call the mock does not know", async (persona) => {
    const { transport } = transportFor(persona);
    const answered: number[] = [];
    setTransport(async (path, init) => {
      const res = await transport(path, init);
      answered.push(res.status);
      return res;
    });
    const [home, status] = SCREENS[persona];

    const first = renderApp("/portal/");
    expect((await screen.findAllByText(home, { exact: false })).length, `${persona} home`).toBeGreaterThan(0);
    first.unmount();
    const second = renderApp("/portal/status");
    expect((await screen.findAllByText(status, { exact: false })).length, `${persona} status`).toBeGreaterThan(0);
    second.unmount();

    // 404 is the mock's "I do not know this path".
    expect(answered, persona).not.toContain(404);
  });
});

describe("installMockApi", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    document.querySelectorAll('[role="note"]').forEach((note) => note.remove());
  });

  test("picks the persona from ?mock=, keeps it for the tab, says so on the page, and puts the stand-in widget in place", async () => {
    window.history.replaceState(null, "", "/portal/?mock=submitted");
    installMockApi();
    expect(window.turnstile).toBeDefined();
    expect(document.querySelector('[role="note"]')?.textContent).toBe("Mode mock: data tiruan, bukan data sungguhan (submitted).");
    expect(JSON.parse(window.sessionStorage.getItem("sakem-portal-mock")!).persona).toBe("submitted");

    // Not signed in yet.
    const { api } = await import("@shared/spa/api");
    expect((await api(ENDPOINTS.me)).ok).toBe(false);
  });

  test("the choice is remembered when the next page has no ?mock=", () => {
    window.sessionStorage.setItem("sakem-portal-mock", JSON.stringify({ persona: "draft" }));
    window.history.replaceState(null, "", "/portal/");
    installMockApi();
    expect(document.querySelector('[role="note"]')?.textContent).toContain("(draft)");
  });

  test("storage that refuses is not a crash", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => installMockApi()).not.toThrow();
  });
});
