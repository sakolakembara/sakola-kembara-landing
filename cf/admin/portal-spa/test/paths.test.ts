import { turnstileRoutes } from "@shared/spa/captcha";
import { describe, expect, test } from "vitest";
import { API, AUTH_API, BASE, ENDPOINTS, googleCallback, REGISTER_CALLBACK, RESET_PAGE, serverPath, VERIFY_CALLBACK } from "~/lib/paths";

describe("where the portal lives", () => {
  test("the SPA is at /portal and the API under it", () => {
    expect(BASE).toBe("/portal");
    expect(API).toBe("/portal/api");
    expect(AUTH_API).toBe("/portal/api/auth");
  });

  test("every call goes to /portal/api (the route of the portal Worker), none to the admin's /api", () => {
    for (const [name, path] of Object.entries(ENDPOINTS)) {
      expect(path, name).toMatch(/^\/portal\/api\//);
    }
  });

  test("the auth routes are the ones the Worker's table has, under the portal's base path", () => {
    expect(ENDPOINTS.signIn).toBe("/portal/api/auth/sign-in/email");
    expect(ENDPOINTS.signInSocial).toBe("/portal/api/auth/sign-in/social");
    expect(ENDPOINTS.signOut).toBe("/portal/api/auth/sign-out");
    expect(ENDPOINTS.register).toBe("/portal/api/auth/register");
    expect(ENDPOINTS.requestReset).toBe("/portal/api/auth/request-password-reset");
    expect(ENDPOINTS.resetPassword).toBe("/portal/api/auth/reset-password");
    expect(ENDPOINTS.sendVerification).toBe("/portal/api/auth/send-verification-email");
  });

  test("each Turnstile action protects the route the pages send it to", () => {
    const routes = turnstileRoutes(API);
    expect(routes).toEqual({
      login: ENDPOINTS.signIn,
      register: ENDPOINTS.register,
      "forgot-password": ENDPOINTS.requestReset,
      "resend-verification": ENDPOINTS.sendVerification,
    });
    expect(new Set(Object.values(routes)).size).toBe(4);
  });
});

describe("what is sent to the server carries the /portal prefix, what the router uses does not", () => {
  test("serverPath", () => {
    expect(serverPath("/")).toBe("/portal/");
    expect(serverPath("/login")).toBe("/portal/login");
    expect(serverPath("/verify-email?status=success")).toBe("/portal/verify-email?status=success");
  });

  test("the callbacks of the emailed links", () => {
    expect(VERIFY_CALLBACK).toBe("/portal/verify-email?status=success");
    expect(REGISTER_CALLBACK).toBe("/portal/login?verified=1");
    expect(RESET_PAGE).toBe("/portal/reset-password");
  });

  test("Google comes back to the page the student asked for, or to the portal's front page", () => {
    expect(googleCallback(null)).toBe("/portal/");
    expect(googleCallback("/daftar")).toBe("/portal/daftar");
    expect(googleCallback("/status?x=1")).toBe("/portal/status?x=1");
  });
});
