import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ProgressBar } from "~/components/ProgressBar";
import { api, setTransport } from "~/lib/api";
import { deferred, respond } from "./helpers";

const bar = () => document.querySelector("[data-busy]") as HTMLElement;

describe("ProgressBar", () => {
  test("it is idle, and hidden from screen readers (the places that load say so themselves)", () => {
    render(<ProgressBar />);
    expect(bar().getAttribute("data-busy")).toBe("false");
    expect(bar().getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  test("it slides while a call is waiting for its answer, and stops when the answer is in", async () => {
    render(<ProgressBar />);
    const gate = deferred<Response>();
    setTransport(() => gate.promise);
    const call = api("/api/x");
    await waitFor(() => expect(bar().getAttribute("data-busy")).toBe("true"));
    // It fades in after a moment (CSS delay), so an answer that comes at once shows nothing.
    expect(bar().className).toContain("opacity-100");
    expect(bar().className).toContain("delay-200");
    expect(bar().innerHTML).toContain("animate-progress-slide");

    gate.resolve(respond({}));
    await call;
    await waitFor(() => expect(bar().getAttribute("data-busy")).toBe("false"));
    expect(bar().className).toContain("opacity-0");
    expect(bar().innerHTML).not.toContain("animate-progress-slide");
  });

  test("a call that fails, or never reaches the server, does not leave it sliding", async () => {
    render(<ProgressBar />);
    setTransport(async () => {
      throw new Error("offline");
    });
    await api("/api/x");
    await waitFor(() => expect(bar().getAttribute("data-busy")).toBe("false"));
  });

  test("it stays while any of two calls is still waiting", async () => {
    render(<ProgressBar />);
    const slow = deferred<Response>();
    setTransport((path) => (path === "/api/slow" ? slow.promise : Promise.resolve(respond({}))));
    const waiting = api("/api/slow");
    await api("/api/fast");
    expect(bar().getAttribute("data-busy")).toBe("true");
    slow.resolve(respond({}));
    await waiting;
    await waitFor(() => expect(bar().getAttribute("data-busy")).toBe("false"));
  });
});
