// The one XMLHttpRequest of both SPAs (the admin's uploads and the student portal's files): a generic send with progress and
// abort. `fetch` cannot report how much of a body has been sent, and a phone on a weak network needs a progress bar for a
// 3 MB photo, so a file upload cannot go through `api()` (shared/spa/api.ts). What the caller does with the answer, and
// which words it shows, stays with the caller: the admin's `xhrUploader` (spa/src/lib/crud/upload-client.ts) and the
// portal's file client (portal-spa/src/lib/files/client.ts) are thin callers of this.
//
// docs/cloudflare/portal-architecture.md, 5.2 ("the upload client is the one exception, owned by P4").

export interface XhrRequest {
  method: string;
  url: string;
  body: XMLHttpRequestBodyInit;
  /** Sent as they are. The browser adds `Content-Type` itself for a `FormData`, so leave it out then. */
  headers?: Readonly<Record<string, string>>;
  /** 0 to 1, as the browser reports the bytes of the body sent. Called only when the browser can tell the total. */
  onProgress?: (fraction: number) => void;
  /** Stops the request. One that is already aborted sends nothing. */
  signal?: AbortSignal;
}

export type XhrOutcome =
  /** The server answered, with any status: `text` is the body, `header` reads a response header. */
  | { kind: "response"; status: number; text: string; header: (name: string) => string | null }
  /** The request never got an answer: offline, DNS, a blocked or timed-out connection. */
  | { kind: "network" }
  /** The caller's signal stopped it. */
  | { kind: "aborted" };

/** Sends the request with the session cookie (same origin) and settles with what happened. Never rejects. */
export function sendXhr({ method, url, body, headers, onProgress, signal }: XhrRequest): Promise<XhrOutcome> {
  return new Promise<XhrOutcome>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries(headers ?? {})) xhr.setRequestHeader(name, value);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
    });
    xhr.addEventListener("load", () => resolve({ kind: "response", status: xhr.status, text: xhr.responseText, header: (name) => xhr.getResponseHeader(name) }));
    xhr.addEventListener("error", () => resolve({ kind: "network" }));
    xhr.addEventListener("timeout", () => resolve({ kind: "network" }));
    xhr.addEventListener("abort", () => resolve({ kind: "aborted" }));

    if (signal) {
      if (signal.aborted) return resolve({ kind: "aborted" });
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}
