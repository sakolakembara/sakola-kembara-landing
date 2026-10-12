import { useCallback, useEffect, useState } from "react";
import { api } from "~/lib/api";
import { COUNTS_PATH, type MessageCounts } from "./model";

/**
 * The numbers of the Pesan header and its filter pills: "12 total · 3 belum dibaca", "Sudah dibaca (9)". Its own request
 * (`GET /api/admin/messages/counts`), because a list answers the page it was asked for and its `total` follows the
 * filter, while the pills show all three numbers at once. `null` while loading or when it failed: the screen then
 * shows the labels without numbers rather than a wrong one.
 */
export function useMessageCounts(): { counts: MessageCounts | null; reload: () => void } {
  const [counts, setCounts] = useState<MessageCounts | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void api<MessageCounts>(COUNTS_PATH, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setCounts(result.ok && Number.isFinite(result.data?.total) && Number.isFinite(result.data?.unread) ? { total: result.data.total, unread: result.data.unread } : null);
    });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { counts, reload };
}
