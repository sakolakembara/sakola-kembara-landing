import { describe, expect, test, vi } from "vitest";
import { standInEnvironment, warmUp } from "../src/warmup";

// A warm-up that breaks must cost the warm-up and nothing else: no rejection, no throw, one fixed line in the log
// (the name of the error, never its message, which could carry a value).

describe("a failing warm-up", () => {
  test("is swallowed, and says only that it was skipped and the error's name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = () =>
      ({
        ...standInEnvironment(),
        DB: {
          prepare() {
            throw new Error("secret-looking message that must not reach the log");
          },
        },
      }) as never;
    await expect(warmUp(broken)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[warm-up] skipped (Error)");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-looking");
    warn.mockRestore();
  });
});
