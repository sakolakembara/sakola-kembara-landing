import { Mail, Reply, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/crud/ConfirmDialog";
import { Flash } from "~/components/crud/Flash";
import { makeStatusMap, StatusTag } from "~/components/crud/StatusTag";
import { PageHeader } from "~/components/PageHeader";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { describeFailure } from "~/lib/crud/errors";
import { flashState, useFlash } from "~/lib/crud/flash";
import type { ItemPayload } from "~/lib/crud/types";
import { useDeleteAction } from "~/lib/crud/useDeleteAction";
import { useItem } from "~/lib/crud/useItem";
import { useSubmitLock } from "~/lib/hooks";
import { useMe } from "~/lib/session";
import { API_PATH, mailtoFor, type MessageItem, ROUTE, SUBJECT_LABEL, SUBJECT_TONE } from "./model";

// One message. A port of app/(admin)/admin/messages/[id]/page.tsx: the sender, the subject tag, "Dikirim ...", the
// reply link, the toggle, the delete, and the text as it was typed (line breaks kept).
//
// What differs from the legacy page, on purpose:
//  - Opening a message marks it read, as before, but by an explicit `POST /api/admin/messages/:id/read` that this page
//    makes once per visit; the `GET` that loaded the message changed nothing. Only someone who can write does it: a
//    read-only role (viewer) reads the message and leaves it unread.
//  - "Tandai belum dibaca" stays unread. (The legacy page marked it read again as soon as it drew itself again.)
//  - A message can be marked read again by hand ("Tandai sudah dibaca"), for the viewer's colleagues' sake and for the
//    case where the automatic mark failed.

const SUBJECT_STATUS = makeStatusMap({
  partnership: { label: SUBJECT_LABEL.partnership, tone: SUBJECT_TONE.partnership },
  donation: { label: SUBJECT_LABEL.donation, tone: SUBJECT_TONE.donation },
  other: { label: SUBJECT_LABEL.other, tone: SUBJECT_TONE.other },
});

const TOGGLE = "inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-60";

export function MessageDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const canWrite = accessTo(me, "komunikasi") === "write";
  const item = useItem<MessageItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  const notice = useFlash();
  const lock = useSubmitLock();
  const message = item.item;

  // The message this visit marked read by itself (for the note under the text), and the one it already tried, so
  // marking it unread by hand is not undone by the next render.
  const [markedId, setMarkedId] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const tried = useRef<string | null>(null);

  useEffect(() => {
    if (!canWrite || !message || message.readAt !== null || tried.current === message.id) return;
    tried.current = message.id;
    setMarking(true);
    void api<ItemPayload<MessageItem>>(`${API_PATH}/${encodeURIComponent(message.id)}/read`, { method: "POST" }).then((result) => {
      setMarking(false);
      // A failure is not announced: the message is on screen, and "Tandai sudah dibaca" is there to try again.
      if (!result.ok) return;
      setMarkedId(result.data.item.id);
      item.replace(result.data.item);
    });
  }, [canWrite, message, item]);

  const remove = useDeleteAction<MessageItem>({
    basePath: API_PATH,
    noun: "pesan",
    nameOf: (row) => row.fullName,
    onDeleted: () => navigate(ROUTE, { state: flashState({ tone: "success", text: "Pesan berhasil dihapus." }) }),
    onReload: item.refetch,
  });

  async function toggle(to: "read" | "unread") {
    if (!message) return;
    notice.dismiss();
    await lock.run(async () => {
      const result = await api<ItemPayload<MessageItem>>(`${API_PATH}/${encodeURIComponent(message.id)}/${to}`, { method: "POST" });
      if (!result.ok) {
        notice.show({ tone: "danger", text: describeFailure(result).message });
        return;
      }
      setMarkedId(null);
      item.replace(result.data.item);
    });
  }

  if (id && (item.status === "loading" || item.status === "idle") && !message) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat pesan...
        </p>
      </div>
    );
  }
  if (!message) {
    const missing = item.failure?.status === 404;
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{item.failure ? describeFailure(item.failure).message : "Gagal memuat pesan."}</Alert>
        {missing ? (
          <Button variant="neutral" href={ROUTE}>
            Kembali ke daftar
          </Button>
        ) : (
          <Button variant="neutral" onClick={item.refetch}>
            Coba lagi
          </Button>
        )}
      </div>
    );
  }

  const unread = message.readAt === null;

  return (
    <div className="max-w-3xl p-6 md:p-10">
      <PageHeader
        back={{ href: ROUTE, label: "Kembali ke daftar" }}
        title={message.fullName}
        documentTitle="Detail Pesan"
        overline="Detail pesan"
        className="md:items-start"
        actions={<StatusTag map={SUBJECT_STATUS} value={message.subject} size="lg" />}
      >
        <p className="text-sm text-gray-600">{message.email}</p>
      </PageHeader>

      <Flash flash={notice.flash} dismiss={notice.dismiss} />

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-4 text-sm">
          <div className="text-gray-500">Dikirim {new Date(message.createdAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}</div>
          <div className="flex flex-wrap items-center gap-3">
            <Button href={mailtoFor(message.email, message.subject)} size="sm">
              <Reply size={14} aria-hidden="true" /> Balas via Email
            </Button>
            {canWrite && !marking && (
              <button type="button" disabled={lock.pending} onClick={() => void toggle(unread ? "read" : "unread")} className={TOGGLE}>
                <Mail size={14} aria-hidden="true" /> {unread ? "Tandai sudah dibaca" : "Tandai belum dibaca"}
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                onClick={() => remove.ask(message)}
                aria-haspopup="dialog"
                className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:underline"
              >
                <Trash2 size={14} aria-hidden="true" /> Hapus
              </button>
            )}
          </div>
        </div>
        <div className="p-6">
          <p className="whitespace-pre-wrap leading-relaxed text-gray-800">{message.message}</p>
        </div>
        {markedId === message.id && !unread && <div className="px-6 pb-4 text-xs text-gray-400">Pesan ini ditandai sebagai sudah dibaca saat kamu membukanya.</div>}
      </section>

      <ConfirmDialog {...remove.dialogProps} />
    </div>
  );
}
