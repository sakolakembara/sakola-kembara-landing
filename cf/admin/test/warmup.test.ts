import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { standInEnvironment, warmUp, warmUpDone } from "../src/warmup";

// The start-up warm-up (src/warmup.ts) runs library code against a stand-in environment before the first request.
// What it must never do: touch a real binding, fail loudly, or leave a mark. That it also keeps Workers' global-scope
// rules (no Response, no I/O, no timer, no random value) cannot be tested here, where tests run inside a request:
// it was checked by loading the Worker in `wrangler dev` (the PR says how).

afterEach(() => vi.restoreAllMocks());

describe("warmUp", () => {
  test("runs to the end against the stand-in and reports nothing", async () => {
    const warn = vi.spyOn(console, "warn");
    await expect(warmUp()).resolves.toBeUndefined();
    expect(warn.mock.calls.filter(([line]) => String(line).startsWith("[warm-up]"))).toEqual([]);
  });

  test("the warm-up that ran when the Worker loaded has finished without failing", async () => {
    await expect(warmUpDone).resolves.toBeUndefined();
  });

  test("reads and writes no real binding", async () => {
    const touched = [vi.spyOn(env.DB, "prepare"), vi.spyOn(env.DB, "batch"), vi.spyOn(env.DB, "exec")];
    await warmUp();
    for (const spy of touched) expect(spy).not.toHaveBeenCalled();
  });

  test("the stand-in is its own world: another D1, a made-up secret, nothing of the real environment", () => {
    const stand = standInEnvironment();
    expect(stand.DB).not.toBe(env.DB);
    expect(stand.BETTER_AUTH_SECRET).not.toBe(env.BETTER_AUTH_SECRET);
    expect(Object.keys(stand).sort()).toEqual(["BETTER_AUTH_SECRET", "DB", "ENVIRONMENT"]);
  });
});
