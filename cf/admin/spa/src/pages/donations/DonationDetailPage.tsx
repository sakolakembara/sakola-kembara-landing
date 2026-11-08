import { Check, MessageCircle, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Textarea } from "~/components/ui/field";
import { ConfirmDialog } from "~/components/crud/ConfirmDialog";
import { DetailShell } from "~/components/crud/DetailShell";
import { StatusTag } from "~/components/crud/StatusTag";
import { accessTo } from "~/lib/access";
import { api, type ApiInit } from "~/lib/api";
import { describeFailure } from "~/lib/crud/errors";
import { flashState, useFlash } from "~/lib/crud/flash";
import type { ItemPayload } from "~/lib/crud/types";
import { useDeleteAction } from "~/lib/crud/useDeleteAction";
import { useItem } from "~/lib/crud/useItem";
import { useSubmitLock } from "~/lib/hooks";
import { useMe } from "~/lib/session";
import { API_PATH, type DonationItem, KIND_LABEL, localWhatsapp, monthLabel, ROUTE, rupiah, SOURCE_LABEL, STATUS, waLink } from "./model";

// One donation confirmation (SAKEM-128): what the donor typed, the receipt (a one-off donation), the internal note, and
// the two things an admin does with it: mark it checked once it is in the bank statement, and reach the donor on
// WhatsApp. The receipt comes from the private bucket through the Worker (each open is audited); an image shows on the
// page, a PDF is a download.

const NOTE_MAX = 2000;

export function DonationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const canWrite = accessTo(me, "sistem") === "write";
  const item = useItem<DonationItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  const donation = item.item;
  const notice = useFlash();
  const lock = useSubmitLock();
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);

  useEffect(() => {
    if (donation) setNote(donation.note ?? "");
  }, [donation?.id, donation?.note]);

  const remove = useDeleteAction<DonationItem>({
    basePath: API_PATH,
    noun: "konfirmasi donasi",
    nameOf: (row) => row.name,
    onDeleted: () => navigate(ROUTE, { state: flashState({ tone: "success", text: "Konfirmasi donasi berhasil dihapus." }) }),
    onReload: item.refetch,
  });

  async function send(path: string, init: ApiInit, done?: () => void) {
    if (!donation) return;
    notice.dismiss();
    await lock.run(async () => {
      const result = await api<ItemPayload<DonationItem>>(`${API_PATH}/${encodeURIComponent(donation.id)}/${path}`, init);
      if (!result.ok) {
        notice.show({ tone: "danger", text: describeFailure(result).message });
        return;
      }
      item.replace(result.data.item);
      done?.();
    });
  }

  if (id && (item.status === "loading" || item.status === "idle") && !donation) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat donasi...
        </p>
      </div>
    );
  }
  if (!donation) {
    const missing = item.failure?.status === 404;
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{item.failure ? describeFailure(item.failure).message : "Gagal memuat donasi."}</Alert>
        <Button variant="neutral" {...(missing ? { href: ROUTE } : { onClick: item.refetch })}>
          {missing ? "Kembali ke daftar" : "Coba lagi"}
        </Button>
      </div>
    );
  }

  const checked = donation.status === "checked";
  const proofUrl = `${API_PATH}/${encodeURIComponent(donation.id)}/proof`;
  const isImage = donation.proof?.contentType.startsWith("image/") ?? false;
  const created = new Date(donation.createdAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });

  const rows: [string, string][] = [
    ["Donasi", `${rupiah(donation.amount)} · ${KIND_LABEL[donation.kind].toLowerCase()}`],
    ["WhatsApp", localWhatsapp(donation.whatsapp)],
    ...(donation.kind === "monthly"
      ? ([
          ["Mulai", monthLabel(donation.startMonth)],
          ["Pengingat", `Setiap tanggal ${donation.remindDay}`],
        ] as [string, string][])
      : []),
    ["Tahu dari", donation.source ? SOURCE_LABEL[donation.source] : "Tidak dijawab"],
    ["Masuk", `${created} WIB`],
  ];

  return (
    <DetailShell
      title={donation.name}
      documentTitle="Detail Donasi"
      back={{ href: ROUTE, label: "Kembali ke daftar" }}
      status={<StatusTag map={STATUS} value={donation.status} />}
      actions={
        <>
          {canWrite && (
            <Button variant="ghost" className="text-destructive hover:text-destructive" aria-haspopup="dialog" onClick={() => remove.ask(donation)}>
              <Trash2 aria-hidden="true" />
              <span className="max-md:sr-only">Hapus</span>
            </Button>
          )}
          <Button variant="neutral" href={waLink(donation.whatsapp)}>
            <MessageCircle aria-hidden="true" />
            <span className="max-md:sr-only">WhatsApp</span>
          </Button>
          {canWrite &&
            (checked ? (
              <Button variant="neutral" disabled={lock.pending} onClick={() => void send("uncheck", { method: "POST" })}>
                <RotateCcw aria-hidden="true" />
                Batalkan dicek
              </Button>
            ) : (
              <Button disabled={lock.pending} onClick={() => void send("check", { method: "POST" })}>
                <Check aria-hidden="true" />
                Tandai dicek
              </Button>
            ))}
        </>
      }
      flash={notice}
      aside={
        donation.proof ? (
          <Card className="gap-3 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-900">Bukti transfer</span>
              <a href={proofUrl} download className="text-primary-blue hover:underline">
                Unduh
              </a>
            </div>
            {isImage ? (
              <a href={proofUrl} target="_blank" rel="noopener noreferrer" aria-label="Buka bukti transfer ukuran penuh">
                <img src={proofUrl} alt="Bukti transfer" className="max-h-[480px] w-full rounded-lg border border-gray-100 object-contain" />
              </a>
            ) : (
              <p className="text-sm text-gray-500">Berkas PDF. Klik “Unduh” untuk membukanya.</p>
            )}
          </Card>
        ) : donation.kind === "once" ? (
          <Card className="p-4 text-sm text-gray-500">Belum ada bukti transfer. Donatur belum menyelesaikan langkah kedua.</Card>
        ) : undefined
      }
    >
      <Card className="max-w-3xl gap-0 overflow-hidden py-0 md:py-0">
        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-3 p-5 text-sm md:p-6">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-gray-500">{label}</dt>
              <dd className="font-medium text-gray-900">{value}</dd>
            </div>
          ))}
        </dl>
        <form
          className="space-y-3 border-t border-gray-100 p-5 md:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void send("note", { method: "PUT", json: { note } }, () => setNoteSaved(true));
          }}
        >
          <label htmlFor="donation-note" className="block text-sm font-medium text-gray-700">
            Catatan internal
          </label>
          <Textarea
            id="donation-note"
            rows={3}
            maxLength={NOTE_MAX}
            value={note}
            disabled={!canWrite}
            placeholder="Mis. sudah masuk di mutasi 8 Nov"
            onChange={(event) => {
              setNote(event.target.value);
              setNoteSaved(false);
            }}
          />
          {canWrite && (
            <div className="flex items-center gap-3">
              <Button type="submit" variant="neutral" size="sm" disabled={lock.pending || note === (donation.note ?? "")}>
                Simpan catatan
              </Button>
              {noteSaved && <span role="status" className="text-xs text-gray-500">Catatan tersimpan.</span>}
            </div>
          )}
        </form>
      </Card>

      <ConfirmDialog {...remove.dialogProps} />
    </DetailShell>
  );
}
