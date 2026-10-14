// Reading an upload's body and handing it to R2 without ever holding the file in memory
// (docs/cloudflare/portal-architecture.md, 8.4). The body is the raw file, `Content-Length` declared:
//
//   1. `readHead` pulls chunks until it has the first SNIFF_WINDOW (1 MiB) bytes of the file, or all of it when it is
//      smaller, and nothing more. The caller sniffs them: an unknown type, a damaged header, absurd dimensions are
//      refused before a byte is stored.
//   2. `putStream` starts the R2 put on a FixedLengthStream of the declared length, writes the chunks already read,
//      then pipes the REST of the body into it natively (`pipeTo`: no JavaScript runs per chunk, which matters on a
//      10 ms CPU budget). Memory stays at the head plus the chunks in flight, whatever the size of the file.
//
// The declared length is the contract with R2: a body that ends early or runs past it makes the stream fail and the
// put reject, and R2 stores nothing (an object is only visible once its put has completed). A caller that aborts
// leaves nothing either. All of those answer `body_mismatch`; only the platform can tell a dropped connection from a
// lie, and the student's remedy is the same: try again.

import { SNIFF_WINDOW } from "../uploads/sniff";

export interface Head {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  /** The chunks read so far, in order: all of them go to R2. */
  chunks: Uint8Array[];
  /** Bytes in `chunks`. */
  bytes: number;
  /** The first `min(declared, SNIFF_WINDOW)` bytes, joined, for the sniffer. */
  head: Uint8Array;
  /** The body ended while reading the head. */
  ended: boolean;
}

/** Reads until `min(declared, SNIFF_WINDOW)` bytes are in hand (or the body ends). A body that errors counts as ended early. */
export async function readHead(body: ReadableStream<Uint8Array>, declared: number): Promise<Head> {
  const reader = body.getReader();
  const target = Math.min(declared, SNIFF_WINDOW);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let ended = false;
  try {
    while (bytes < target) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } catch {
    ended = true;
  }
  const joined = new Uint8Array(Math.min(bytes, target));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= joined.length) break;
    const take = chunk.subarray(0, joined.length - offset);
    joined.set(take, offset);
    offset += take.length;
  }
  return { reader, chunks, bytes, head: joined, ended };
}

export type PutOutcome = { ok: true; object: R2Object } | { ok: false; reason: "mismatch" | "failed" };

type PutResult = { object: R2Object } | { error: unknown };

/** The runtime's own words when the bytes written do not add up to the declared length (workerd, `FixedLengthStream`). */
const isLengthError = (error: unknown) => error instanceof TypeError && /FixedLengthStream/.test(error.message);

/**
 * Stores the file: the chunks of `head`, then the rest of `body`, as ONE object of exactly `declared` bytes.
 * `mismatch`: the body was shorter or longer than declared, or broke off (nothing is stored). `failed`: R2 itself
 * refused or errored (nothing is stored either; the caller releases what it reserved).
 */
export async function putStream(bucket: R2Bucket, key: string, options: R2PutOptions, head: Head, body: ReadableStream<Uint8Array>, declared: number): Promise<PutOutcome> {
  const fixed = new FixedLengthStream(declared);
  // Started now so that R2 is already reading when the first chunk is written; settled into a value so that an
  // early rejection is never an unhandled one.
  const putting: Promise<PutResult> = bucket.put(key, fixed.readable, options).then(
    (object) => ({ object }),
    (error: unknown) => ({ error }),
  );

  // The chunks already read, then the rest of the body piped natively. True when the stream took exactly what it was given.
  const feeding = (async (): Promise<boolean> => {
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    try {
      writer = fixed.writable.getWriter();
      for (const chunk of head.chunks) await writer.write(chunk);
      writer.releaseLock();
      writer = null;
      head.reader.releaseLock();
      await body.pipeTo(fixed.writable);
      return true;
    } catch {
      // Ends the stream with an error so the put does not wait for bytes that will never come (a no-op when `pipeTo`
      // already errored it).
      await (writer ?? fixed.writable).abort().catch(() => undefined);
      return false;
    }
  })();

  // A put that fails while the feeder is still waiting for R2 to read must not leave us waiting with it.
  const early = await Promise.race([putting.then((result) => ("error" in result ? result : null)), feeding.then(() => null)]);
  if (early) return { ok: false, reason: isLengthError(early.error) ? "mismatch" : "failed" };

  const [fed, put] = await Promise.all([feeding, putting]);
  if (!fed) return { ok: false, reason: "mismatch" };
  if ("error" in put) return { ok: false, reason: isLengthError(put.error) ? "mismatch" : "failed" };
  return { ok: true, object: put.object };
}

/** The MD5 R2 reports for the object, as 32 lowercase hex characters (an integrity check, not a security one), or null. */
export function md5Of(object: Pick<R2Object, "checksums" | "etag">): string | null {
  const md5 = object.checksums?.md5;
  if (md5) {
    const hex = [...new Uint8Array(md5)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (/^[0-9a-f]{32}$/.test(hex)) return hex;
  }
  const etag = object.etag?.replace(/"/g, "");
  return etag && /^[0-9a-f]{32}$/.test(etag) ? etag : null;
}
