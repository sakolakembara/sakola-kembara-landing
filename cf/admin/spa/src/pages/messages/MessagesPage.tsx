import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { TableCard } from "~/components/ui/table";
import { makeStatusMap, StatusTag } from "~/components/crud/StatusTag";
import { Flash } from "~/components/crud/Flash";
import { Pagination } from "~/components/crud/Pagination";
import { PageHeader } from "~/components/PageHeader";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";
import { useFlash } from "~/lib/crud/flash";
import { useList } from "~/lib/crud/useList";
import { formatDateTime } from "~/lib/format";
import { API_PATH, LIST_SPEC, type MessageListItem, ROUTE, SUBJECT_LABEL, SUBJECT_TONE } from "./model";
import { useMessageCounts } from "./useMessageCounts";

// Pesan: the inbox of the contact form. A port of app/(admin)/admin/messages/page.tsx: the header with the two
// numbers, the three filter pills, and one row per message (an unread dot, the sender, the subject, a line of the
// text, the time). What the legacy page did not have and this one needs: pages (the legacy page read the whole
// table), and a way to tell when the numbers or the list could not be loaded.

const SUBJECT_STATUS = makeStatusMap({
  partnership: { label: SUBJECT_LABEL.partnership, tone: SUBJECT_TONE.partnership },
  donation: { label: SUBJECT_LABEL.donation, tone: SUBJECT_TONE.donation },
  other: { label: SUBJECT_LABEL.other, tone: SUBJECT_TONE.other },
});

function FilterPill({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "border-primary-blue bg-primary-blue text-white" : "border-gray-200 bg-white text-gray-700 hover:border-primary-blue/40"
      }`}
    >
      {label}
    </Link>
  );
}

const EMPTY: Record<string, string> = {
  unread: "Tidak ada pesan yang belum dibaca.",
  read: "Tidak ada pesan yang sudah dibaca.",
};

export function MessagesPage() {
  const list = useList<MessageListItem>(API_PATH, LIST_SPEC);
  const { counts, reload } = useMessageCounts();
  const notice = useFlash();
  const filter = list.query.filters.filter ?? "";

  const suffix = (value: number | undefined) => (value === undefined ? "" : ` (${value})`);
  const unread = counts?.unread;
  const read = counts ? counts.total - counts.unread : undefined;

  return (
    <div className="p-6 md:p-10">
      <PageHeader title="Pesan">
        {counts && (
          <p className="text-gray-600">
            {counts.total} total · {counts.unread} belum dibaca.
          </p>
        )}
      </PageHeader>

      <Flash flash={notice.flash} dismiss={notice.dismiss} />

      <nav aria-label="Saring pesan" className="mb-6 flex flex-wrap gap-2">
        <FilterPill to={ROUTE} label={`Semua${suffix(counts?.total)}`} active={filter === ""} />
        <FilterPill to={`${ROUTE}?filter=unread`} label={`Belum dibaca${suffix(unread)}`} active={filter === "unread"} />
        <FilterPill to={`${ROUTE}?filter=read`} label={`Sudah dibaca${suffix(read)}`} active={filter === "read"} />
      </nav>

      <div aria-busy={list.status === "loading" || list.refreshing}>
        <TableCard>
          {list.status === "error" ? (
            <div className="p-12 text-center">
              <p role="alert" className="mb-4 text-gray-700">
                {list.failure ? describeFailure(list.failure).message : MESSAGES.loadFailed}
              </p>
              <Button
                variant="neutral"
                onClick={() => {
                  list.refetch();
                  reload();
                }}
              >
                Coba lagi
              </Button>
            </div>
          ) : list.status === "loading" && list.items.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <p role="status">Memuat data...</p>
            </div>
          ) : list.items.length === 0 ? (
            <div className="p-12 text-center text-gray-500">{EMPTY[filter] ?? "Belum ada pesan dari pengunjung."}</div>
          ) : (
            <ul className={`divide-y divide-gray-100 ${list.refreshing ? "opacity-60 transition-opacity" : ""}`}>
              {list.items.map((message) => {
                const unreadRow = message.readAt === null;
                return (
                  <li key={message.id} className={`transition-colors hover:bg-gray-50 ${unreadRow ? "bg-blue-50/30" : ""}`}>
                    <Link to={`${ROUTE}/${encodeURIComponent(message.id)}`} className="flex items-center gap-4 p-4">
                      <span role="img" aria-label={unreadRow ? "Belum dibaca" : "Sudah dibaca"} className={`h-2 w-2 shrink-0 rounded-full ${unreadRow ? "bg-primary-blue" : "bg-transparent"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className={`text-sm ${unreadRow ? "font-semibold text-gray-900" : "text-gray-700"}`}>{message.fullName}</span>
                          <span className="text-xs text-gray-500">{message.email}</span>
                          <StatusTag map={SUBJECT_STATUS} value={message.subject} />
                        </div>
                        <p className={`mt-1 line-clamp-1 text-sm ${unreadRow ? "text-gray-700" : "text-gray-500"}`}>{message.preview}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(message.createdAt)}</div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </TableCard>
      </div>

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} searchFor={list.searchFor} />
    </div>
  );
}
