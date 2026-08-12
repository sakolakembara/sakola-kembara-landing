// Vitest setup: stub Next.js internals that aren't available under a raw
// Node test runner (they're supplied by Next at build time only).
import { vi } from "vitest";

// `server-only` is a bare `throw` module that Next uses to guard imports
// against being pulled into a client bundle. In tests we neutralize it.
vi.mock("server-only", () => ({}));
