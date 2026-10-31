import { useCallback, useEffect, useState } from "react";
import { api } from "~/lib/api";
import { cachedRead, keepRead, readCacheVersion } from "~/lib/crud/readCache";
import { COUNTS_PATH, type MessageCounts } from "./model";

/**
 * The numbers of the Pesan header and its filter pills: "12 total · 3 belum dibaca", "Sudah dibaca (9)". Its own request
 * (`GET /api/admin/messages/counts`), because a list answers the page it was asked for and its `total` follows the
 * filter, while the pills show all three numbers at once. `null` while loading or when it failed: the screen then
 * shows the labels without numbers rather than a wrong one. `settled` tells the two apart: false until the first answer
 * (the page holds the line the numbers will be in), true after it, whatever it was. The last answer is kept in memory
 * (lib/crud/readCache.ts), like a list's: coming back shows it at once and asks again.
 */
export function useMessageCounts(): { counts: MessageCounts | null; settled: boolean; reload: () => void } {
  const [counts, setCounts] = useState<MessageCounts | null>(() => cachedRead<MessageCounts>(COUNTS_PATH) ?? null);
  const [settled, setSettled] = useState(counts !== null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = readCacheVersion();
    void api<MessageCounts>(COUNTS_PATH, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      const next = result.ok && Number.isFinite(result.data?.total) && Number.isFinite(result.data?.unread) ? { total: result.data.total, unread: result.data.unread } : null;
      if (next) keepRead(COUNTS_PATH, next, version);
      setCounts(next);
      setSettled(true);
    });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { counts, settled, reload };
}
