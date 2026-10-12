import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { setTransport } from "~/lib/api";

// A test fails when the page logs an error or a warning (a React "not wrapped
// in act" or key warning, a failed prop type...) unless the test says it
// expected one by calling `takeConsoleProblems()`.
const problems: unknown[][] = [];

beforeEach(() => {
  problems.length = 0;
  vi.spyOn(console, "error").mockImplementation((...args) => void problems.push(args));
  vi.spyOn(console, "warn").mockImplementation((...args) => void problems.push(args));
});

afterEach(() => {
  cleanup();
  setTransport(null);
  // Cloudflare's script and what it defines (test/fake-turnstile.ts), and any env a test stubbed.
  document.head.querySelectorAll("script[data-sakem-turnstile]").forEach((script) => script.remove());
  delete window.turnstile;
  vi.unstubAllEnvs();
  document.title = "";
  document.body.style.overflow = "";
  const unexpected = problems.splice(0);
  if (unexpected.length > 0) {
    throw new Error(`Unexpected console output:\n${unexpected.map((args) => args.map(String).join(" ")).join("\n")}`);
  }
});

/** Returns what was logged to console.error or console.warn so far, and forgets it. */
export function takeConsoleProblems(): unknown[][] {
  return problems.splice(0);
}
