import { useEffect, useRef, useState } from "react";
import { api } from "~/lib/api";
import { describeFailure } from "~/lib/crud/errors";
import { PREVIEW_PATH } from "./model";
import { BODY_LIMIT_LABEL, LIMITS, PREVIEW_DELAY_MS } from "./rules";

// The preview of the article body: the Worker renders it (the same function a save uses, so what is shown is what
// will be stored), and this hook asks for it.
//
//   - only while the preview is on screen (`active`): typing in the editor asks for nothing;
//   - the first request after it is switched on goes at once, later keystrokes are DEBOUNCED (`PREVIEW_DELAY_MS`)
//     and the request still in flight is aborted when the text changes again;
//   - the last answer is remembered: switching back to the preview without having typed asks for nothing;
//   - an empty text and a text above the limit are answered here (the Worker would refuse the second).
//
// Every request is a Worker request with a render in it (about 4 ms of CPU for a long article, docs/cloudflare/admin-blog.md),
// which is why it asks as little as it can.

export type PreviewStatus = "idle" | "empty" | "loading" | "ready" | "error";

export interface PreviewState {
  status: PreviewStatus;
  /** The sanitised HTML of the last answer (kept while the next one loads). */
  html: string;
  /** A sentence, when `status` is "error". */
  message: string | null;
  /** Asks again after an error. */
  retry: () => void;
}

export function usePreview(markdown: string, active: boolean): PreviewState {
  const [state, setState] = useState<{ status: PreviewStatus; html: string; message: string | null }>({ status: "idle", html: "", message: null });
  const [attempt, setAttempt] = useState(0);
  const remembered = useRef<{ markdown: string; html: string } | null>(null);
  const wasActive = useRef(false);
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (!active) {
      wasActive.current = false;
      return;
    }
    // Switching it on, and "Coba lagi", are someone waiting for the answer: no delay. Typing is what the delay is for.
    const first = !wasActive.current || lastAttempt.current !== attempt;
    lastAttempt.current = attempt;
    wasActive.current = true;

    const text = markdown.trim();
    if (text === "") {
      setState({ status: "empty", html: "", message: null });
      return;
    }
    if (text.length > LIMITS.bodyMax) {
      setState({ status: "error", html: "", message: `Isi maksimal ${BODY_LIMIT_LABEL} karakter` });
      return;
    }
    if (remembered.current?.markdown === markdown) {
      setState({ status: "ready", html: remembered.current.html, message: null });
      return;
    }

    setState((previous) => ({ status: "loading", html: previous.html, message: null }));
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        const result = await api<{ html: string }>(PREVIEW_PATH, { method: "POST", json: { contentMarkdown: markdown }, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.ok && typeof result.data?.html === "string") {
          remembered.current = { markdown, html: result.data.html };
          setState({ status: "ready", html: result.data.html, message: null });
        } else {
          setState({ status: "error", html: "", message: result.ok ? "Jawaban server tidak bisa dibaca. Coba lagi." : describeFailure(result).message });
        }
      },
      first ? 0 : PREVIEW_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [markdown, active, attempt]);

  return { ...state, retry: () => setAttempt((count) => count + 1) };
}
