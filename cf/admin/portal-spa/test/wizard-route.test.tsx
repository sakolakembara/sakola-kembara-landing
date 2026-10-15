import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DaftarRoute, importWithRetry } from "../src/pages/daftar/DaftarRoute";

// The wizard is its own chunk: the route shows a loading line while the chunk comes, and tries once more when a weak
// connection drops it. (That the chunk is NOT in the first load is `pnpm check:portal-spa`'s, and wizard-rules.test.ts.)

const gate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
});

vi.mock("../src/pages/daftar/DaftarPage", async () => {
  await gate.opened;
  return { default: () => <p>isi halaman formulir</p> };
});

afterEach(() => vi.useRealTimers());

describe("the route", () => {
  test("shows a status line while the chunk is loading, then the page", async () => {
    render(<DaftarRoute />);
    expect(screen.getByRole("status").textContent).toBe("Memuat formulir pendaftaran…");
    expect(screen.queryByText("isi halaman formulir")).toBeNull();
    gate.open();
    expect(await screen.findByText("isi halaman formulir")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a chunk that fails to load", () => {
  test("is tried once more after a pause, and the second answer is the one that counts", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module")).mockResolvedValueOnce("chunk");
    const result = importWithRetry(load);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    await expect(result).resolves.toBe("chunk");
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("a chunk that is there the first time is not asked for twice", async () => {
    const load = vi.fn().mockResolvedValue("chunk");
    await expect(importWithRetry(load)).resolves.toBe("chunk");
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("two failures in a row are the page's to show (the crash screen of the shell), not retried for ever", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const result = importWithRetry(load).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(800);
    expect(await result).toBeInstanceOf(TypeError);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
