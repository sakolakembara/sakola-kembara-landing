import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { setTransport } from "~/lib/api";
import { PREVIEW_PATH } from "~/pages/blog/form";
import { BODY_LIMIT_LABEL, LIMITS, PREVIEW_DELAY_MS } from "~/pages/blog/rules";
import { usePreview } from "~/pages/blog/usePreview";
import { deferred } from "./helpers";

// The preview hook (src/pages/blog/usePreview.ts) asks the Worker to render the article body. Every request is a
// Worker request with a render in it, so it must ask as little as it can: these tests drive it with fake timers and
// a transport that answers with plain objects (a real Response reads its body through streams, which fake timers hold up).

afterEach(() => {
  vi.useRealTimers();
  setTransport(null);
});

interface Answer {
  status?: number;
  body: unknown;
}

function plainApi(handler: (markdown: string, call: number) => Promise<Answer> | Answer) {
  const asked: string[] = [];
  setTransport(async (path, init) => {
    expect(path).toBe(PREVIEW_PATH);
    const markdown = String((JSON.parse(String(init.body)) as { contentMarkdown: string }).contentMarkdown);
    asked.push(markdown);
    const answer = await handler(markdown, asked.length);
    const status = answer.status ?? 200;
    return { status, ok: status < 300, headers: new Headers(), json: async () => answer.body } as unknown as Response;
  });
  return { asked };
}

const html = (markdown: string) => ({ body: { html: `<p>${markdown}</p>` } });
/** Moves the fake clock and lets React apply what the hook set meanwhile. */
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const render = (markdown: string, active = true) => renderHook(({ text, on }) => usePreview(text, on), { initialProps: { text: markdown, on: active } });

describe("usePreview: asks as little as it can", () => {
  test("nothing while it is not on screen; the first request at once; keystrokes after it are debounced into one", async () => {
    vi.useFakeTimers();
    const api = plainApi((markdown) => html(markdown));

    const view = render("satu", false);
    await advance(2000);
    expect(api.asked).toEqual([]);

    view.rerender({ text: "satu", on: true });
    await advance(0);
    expect(api.asked).toEqual(["satu"]); // no wait on switching it on
    expect(view.result.current).toMatchObject({ status: "ready", html: "<p>satu</p>" });

    // Typing while it is open: four changes inside the delay are one request, for the last text.
    for (const text of ["satu d", "satu du", "satu dua", "satu dua t"]) {
      view.rerender({ text, on: true });
      await advance(PREVIEW_DELAY_MS - 100);
    }
    expect(api.asked).toEqual(["satu"]);
    await advance(200);
    expect(api.asked).toEqual(["satu", "satu dua t"]);
    expect(view.result.current.html).toBe("<p>satu dua t</p>");
  });

  test("the request in flight is abandoned when the text changes again: an old answer never replaces a newer one", async () => {
    vi.useFakeTimers();
    const first = deferred<Answer>();
    plainApi((_markdown, call) => (call === 1 ? first.promise : { body: { html: "<p>nova</p>" } }));
    const view = render("lama");
    await advance(0);
    view.rerender({ text: "baru", on: true });
    await advance(PREVIEW_DELAY_MS + 10);
    expect(view.result.current.html).toBe("<p>nova</p>");
    await act(async () => first.resolve({ body: { html: "<p>kedaluwarsa</p>" } }));
    expect(view.result.current.html).toBe("<p>nova</p>");
  });

  test("the previous HTML stays while the next loads; an empty text and one above the limit are answered without a request", async () => {
    vi.useFakeTimers();
    const api = plainApi(() => ({ body: { html: "<p>ada</p>" } }));
    const view = render("ada isi");
    await advance(0);
    view.rerender({ text: "ada isi lagi", on: true });
    expect(view.result.current).toMatchObject({ status: "loading", html: "<p>ada</p>" });
    await advance(PREVIEW_DELAY_MS + 10);

    const asked = api.asked.length;
    view.rerender({ text: "   ", on: true });
    expect(view.result.current).toMatchObject({ status: "empty", html: "" });
    view.rerender({ text: "x".repeat(LIMITS.bodyMax + 1), on: true });
    expect(view.result.current).toMatchObject({ status: "error", message: `Isi maksimal ${BODY_LIMIT_LABEL} karakter` });
    await advance(2000);
    expect(api.asked).toHaveLength(asked);
  });

  test("the last answer is remembered: switching the preview off and on without typing asks nothing", async () => {
    vi.useFakeTimers();
    const api = plainApi((markdown) => html(markdown));
    const view = render("tetap");
    await advance(0);
    view.rerender({ text: "tetap", on: false });
    view.rerender({ text: "tetap", on: true });
    await advance(2000);
    expect(api.asked).toEqual(["tetap"]);
    expect(view.result.current).toMatchObject({ status: "ready", html: "<p>tetap</p>" });
  });

  test("an error is a sentence and no stale HTML; retry asks again", async () => {
    vi.useFakeTimers();
    let fail = true;
    const api = plainApi(() => (fail ? { status: 500, body: { error: "internal" } } : { body: { html: "<p>pulih</p>" } }));
    const view = render("isi");
    await advance(0);
    expect(view.result.current).toMatchObject({ status: "error", html: "", message: "Terjadi kesalahan di server. Coba lagi sebentar lagi." });
    fail = false;
    await act(async () => view.result.current.retry());
    await advance(0);
    expect(api.asked).toEqual(["isi", "isi"]);
    expect(view.result.current).toMatchObject({ status: "ready", html: "<p>pulih</p>" });
  });

  test("an answer that is not HTML is an error, not a crash", async () => {
    vi.useFakeTimers();
    plainApi(() => ({ body: { nonsense: true } }));
    const view = render("isi");
    await advance(0);
    expect(view.result.current.status).toBe("error");
    expect(view.result.current.message).toBe("Jawaban server tidak bisa dibaca. Coba lagi.");
  });
});
