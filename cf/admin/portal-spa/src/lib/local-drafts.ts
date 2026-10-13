// What the browser keeps of a half-typed application, and when it must go. The wizard (P3, src/lib/wizard/) writes
// and reads the values; the shell wipes them. The rules are docs/cloudflare/portal-architecture.md#73-the-draft-per-step-saving-and-local-persistence:
//
//   key       sakem-portal:v1:<user id>:<batch id>  (the legacy key held the EMAIL; an id carries no personal data)
//   value     JSON with a numeric `savedAt` (epoch ms), written on every change
//   removed   at sign-out, after submit, when the API answers 401, `no_open_batch`, `batch_closed` or already
//             submitted, and when older than 30 days
//
// Nothing here throws: a browser that refuses storage (a private window) simply has nothing to keep or to wipe.

export const LOCAL_DRAFT_PREFIX = "sakem-portal:v1:";

/** A local copy older than this is removed the next time the portal opens. */
export const LOCAL_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The key of one student's local copy for one batch. */
export function localDraftKey(userId: string, batchId: string): string {
  return `${LOCAL_DRAFT_PREFIX}${userId}:${batchId}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The portal's keys in storage (a snapshot: removing while walking storage by index skips keys). */
function draftKeys(store: Storage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key !== null && key.startsWith(LOCAL_DRAFT_PREFIX)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

function remove(store: Storage, key: string): boolean {
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the local copies of one student (sign-out, a 401 for that student), or of every student when the account
 * is not known. Returns how many keys went. Keys of other sites and of other things this site keeps are never touched.
 */
export function wipeLocalDrafts(userId?: string | null): number {
  const store = storage();
  if (!store) return 0;
  const own = userId ? `${LOCAL_DRAFT_PREFIX}${userId}:` : LOCAL_DRAFT_PREFIX;
  return draftKeys(store).filter((key) => key.startsWith(own) && remove(store, key)).length;
}

/** The time a local copy was written, or null when its value cannot say. */
function savedAtOf(raw: string | null): number | null {
  if (raw === null) return null;
  try {
    const value = (JSON.parse(raw) as { savedAt?: unknown } | null)?.savedAt;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Removes every local copy older than 30 days, and every one whose value does not say when it was written (it
 * cannot be told to be fresh). Run once when the portal opens. Returns how many keys went.
 */
export function purgeStaleLocalDrafts(now: number = Date.now()): number {
  const store = storage();
  if (!store) return 0;
  let gone = 0;
  for (const key of draftKeys(store)) {
    let raw: string | null = null;
    try {
      raw = store.getItem(key);
    } catch {
      continue;
    }
    const savedAt = savedAtOf(raw);
    if ((savedAt === null || now - savedAt > LOCAL_DRAFT_MAX_AGE_MS) && remove(store, key)) gone++;
  }
  return gone;
}
