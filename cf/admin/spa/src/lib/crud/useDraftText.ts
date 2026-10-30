import { useCallback, useEffect, useRef, useState } from "react";

// The text of a box whose value the address bar keeps (a list's search, the audit log's actor). The box holds what
// is typed and sends it up (`commit`) when the person pauses (`delay`), presses Enter or leaves it (`flush`), or when
// another control applies everything at once (`take`). It follows the address bar when that changes to something
// this box did not send (a cleared filter, the back button); the echo of its own text is ignored, so a letter typed
// while the request was in flight is not overwritten.

export interface DraftText {
  value: string;
  onChange(next: string): void;
  /** The cleaned text, recorded as sent: the caller applies it together with the change it is making. */
  take(): string;
  /** Sends the text now when it is not what the address bar has (Enter, blur). */
  flush(): void;
}

export interface DraftTextOptions {
  /** Milliseconds of quiet after the last keystroke before the text is sent; without it only `flush` and `take` send. */
  delay?: number;
  /** What the address bar would keep of a text (`cleanSearch`: trimmed, cut); what is compared and sent. */
  clean?: (raw: string) => string;
}

const same = (raw: string) => raw;

export function useDraftText(committed: string, commit: (text: string) => void, { delay, clean = same }: DraftTextOptions = {}): DraftText {
  const [text, setText] = useState(committed);
  const textRef = useRef(committed);
  const sent = useRef(committed);
  const latest = useRef({ commit, clean });
  useEffect(() => {
    latest.current = { commit, clean };
  });

  useEffect(() => {
    if (committed === sent.current) return;
    sent.current = committed;
    textRef.current = committed;
    setText(committed);
  }, [committed]);

  const take = useCallback(() => {
    const cleaned = latest.current.clean(textRef.current);
    sent.current = cleaned;
    return cleaned;
  }, []);

  const flush = useCallback(() => {
    const cleaned = latest.current.clean(textRef.current);
    if (cleaned === sent.current) return;
    sent.current = cleaned;
    latest.current.commit(cleaned);
  }, []);

  useEffect(() => {
    if (delay === undefined) return;
    const timer = setTimeout(flush, delay);
    return () => clearTimeout(timer);
  }, [text, delay, flush]);

  const onChange = useCallback((next: string) => {
    textRef.current = next;
    setText(next);
  }, []);

  return { value: text, onChange, take, flush };
}
