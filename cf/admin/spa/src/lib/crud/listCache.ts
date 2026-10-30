import { onWrite } from "../api";

// The last answer of every list the admin opened, so opening it again shows the rows at once while the screen asks
// the Worker for the current ones (stale-while-revalidate, `useList`). It lives in memory only: a reload, a closed
// tab and a signed-out session leave nothing behind, and the Worker still answers `no-store`.
//
// A write (a save, a delete, a status change, a sign-in or a sign-out: `onWrite`) empties it, so a list is never
// shown with the row someone has just deleted, and nothing of one account is shown to the next. A load that
// started before a write and answers after it must not put its old answer back: `listCacheVersion()` is read
// when the request leaves, and `keepList` refuses an answer whose version has moved on.

const answers = new Map<string, unknown>();
let version = 0;

/** Empties the cache. Writes do it by themselves; tests do it between cases. */
export function clearListCache(): void {
  answers.clear();
  version += 1;
}

onWrite(clearListCache);

/** The version to hand back to `keepList` with the answer of a request that is about to leave. */
export function listCacheVersion(): number {
  return version;
}

/** `key` is the whole request path, query included; `T` is the payload of the list that path answers. */
export function cachedList<T>(key: string): T | undefined {
  return answers.get(key) as T | undefined;
}

/** Keeps an answer, unless a write happened since `since` (the version read before the request left). */
export function keepList<T>(key: string, payload: T, since: number): void {
  if (since === version) answers.set(key, payload);
}
