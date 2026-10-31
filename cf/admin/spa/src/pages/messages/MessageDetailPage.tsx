import { Mail, MailOpen, Reply, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/crud/ConfirmDialog";
import { DetailShell } from "~/components/crud/DetailShell";
import { makeStatusMap, StatusTag } from "~/components/crud/StatusTag";
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
// reply link, the toggle, the delete, and the text as it was typed (line breaks kept). On the detail frame
// (DetailShell): the sender and the subject in the top bar, and the page's actions (delete, the toggle, the reply) as the
// bar's buttons; there is nothing to decide in a card, so there is no column at the right.
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
    <DetailShell
      title={message.fullName}
      documentTitle="Detail Pesan"
      back={{ href: ROUTE, label: "Kembali ke daftar" }}
      status={<StatusTag map={SUBJECT_STATUS} value={message.subject} />}
      actions={
        <>
          {canWrite && (
            <Button variant="ghost" className="text-destructive hover:text-destructive" aria-haspopup="dialog" onClick={() => remove.ask(message)}>
              <Trash2 aria-hidden="true" />
              {/* On a phone three buttons share the bar at the bottom, and the long words of all three do not fit a 375 px
                  screen: the two quieter ones are their icons (the word stays as their name), the reply keeps its word. */}
              <span className="max-md:sr-only">Hapus</span>
            </Button>
          )}
          {canWrite && !marking && (
            <Button variant="neutral" disabled={lock.pending} onClick={() => void toggle(unread ? "read" : "unread")}>
              {unread ? <MailOpen aria-hidden="true" /> : <Mail aria-hidden="true" />}
              <span className="max-md:sr-only">{unread ? "Tandai sudah dibaca" : "Tandai belum dibaca"}</span>
            </Button>
          )}
          <Button href={mailtoFor(message.email, message.subject)}>
            <Reply aria-hidden="true" />
            Balas lewat email
          </Button>
        </>
      }
      meta={<span>{message.email}</span>}
      flash={notice}
    >
      <Card className="max-w-3xl gap-0 overflow-hidden py-0 md:py-0">
        <div className="border-b border-gray-100 px-5 py-4 text-[13px] text-gray-500 md:px-6">
          Dikirim {new Date(message.createdAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}
        </div>
        <div className="p-5 md:p-6">
          <p className="whitespace-pre-wrap leading-relaxed text-gray-800">{message.message}</p>
        </div>
        {markedId === message.id && !unread && <div className="px-5 pb-4 text-xs text-gray-400 md:px-6">Pesan ini ditandai sebagai sudah dibaca saat kamu membukanya.</div>}
      </Card>

      <ConfirmDialog {...remove.dialogProps} />
    </DetailShell>
  );
}
