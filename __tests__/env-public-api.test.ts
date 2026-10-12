import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// lib/env parses process.env once at import, so each case re-imports it.
// Environment variables reach the container as `KEY=` lines from the deploy
// workflow, so "blank" and "unset" must both leave the app bootable.

const KEY = "PUBLIC_API_SHARED_SECRET";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
  vi.resetModules();
});

afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
  vi.restoreAllMocks();
});

async function loadEnv() {
  return (await import("@/lib/env")).env;
}

describe("PUBLIC_API_SHARED_SECRET in lib/env", () => {
  test("unset: the app boots and the secret is undefined", async () => {
    delete process.env[KEY];
    expect((await loadEnv())[KEY]).toBeUndefined();
  });

  test("blank (a `KEY=` line from the deploy workflow): boots, secret undefined", async () => {
    process.env[KEY] = "";
    expect((await loadEnv())[KEY]).toBeUndefined();
  });

  test("a secret of 32+ characters is accepted as is", async () => {
    const secret = "k".repeat(32);
    process.env[KEY] = secret;
    expect((await loadEnv())[KEY]).toBe(secret);
  });

  test("a set but too short secret fails boot loudly instead of weakening the HMAC", async () => {
    process.env[KEY] = "k".repeat(31);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadEnv()).rejects.toThrow(/Invalid environment variables/);
    expect(JSON.stringify(error.mock.calls)).toContain(KEY);
  });
});
