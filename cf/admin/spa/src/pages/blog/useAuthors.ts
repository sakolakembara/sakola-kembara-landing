import { useEffect, useState } from "react";
import { api } from "~/lib/api";
import { cachedRead, keepRead, readCacheVersion } from "~/lib/crud/readCache";
import { AUTHORS_PATH } from "./model";

/**
 * The names an article may be written under (`GET /api/admin/blog/authors`): the accounts that can write. `authors` is null
 * until the first answer (the box then offers what it already has), `failed` says the answer never came and nothing is
 * known (the form then lets the name be typed, and the Worker checks it). The last answer is kept in memory like a list's
 * (lib/crud/readCache.ts): coming back shows it at once and asks again.
 */
export function useAuthors(): { authors: string[] | null; failed: boolean } {
  const [authors, setAuthors] = useState<string[] | null>(() => cachedRead<string[]>(AUTHORS_PATH) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const version = readCacheVersion();
    void api<{ authors: string[] }>(AUTHORS_PATH, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok && Array.isArray(result.data?.authors)) {
        const names = result.data.authors.filter((name): name is string => typeof name === "string" && name !== "");
        keepRead(AUTHORS_PATH, names, version);
        setAuthors(names);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => controller.abort();
  }, []);

  // A failed answer after a good one keeps the good one.
  return { authors, failed: failed && authors === null };
}
