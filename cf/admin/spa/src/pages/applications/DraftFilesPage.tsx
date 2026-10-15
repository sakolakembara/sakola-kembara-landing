import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "~/components/crud/ConfirmDialog";
import { type Column, DataTable } from "~/components/crud/DataTable";
import { Flash } from "~/components/crud/Flash";
import { Pagination } from "~/components/crud/Pagination";
import { PageHeader } from "~/components/PageHeader";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";
import { useFlash } from "~/lib/crud/flash";
import { useList } from "~/lib/crud/useList";
import { useMutation } from "~/lib/crud/useMutation";
import { useMe } from "~/lib/session";
import { ForbiddenPage } from "../Forbidden";
import { formatBytes } from "./answers";
import { DRAFT_FILES_PATH, DRAFT_PURGE_MIN_DAYS, type DraftFilesRow, DRAFTS_LIST_SPEC, DRAFTS_ROUTE, draftPurgePath, ROUTE, shortDraftId } from "./model";

// "Draf dengan berkas" (SAKEM-093, decided by Dzul on 2026-10-15): the drafts that were never submitted and still hold files
// in the private bucket. A draft is not in the Pendaftar list (that list is submitted applications), so without this nobody
// could ever delete a scan a student uploaded and then abandoned. It is a tab of Pendaftar, for who may purge: the Worker
// answers the list and the purge to `pendaftaran` write only, and a viewer sees neither the tab nor this page.
//
// It shows NO name, email, answer, file name or slot, on purpose: a draft holds a child's half-filled answers, and the person
// who purges is not told whose it is. What stands in for that is the rule the Worker enforces: a draft may be purged only
// after 30 days without a change, and the screen says so and offers the button only to such a draft. The other drafts say
// from when they may be purged. The purge asks first, and only the files go: what the student typed stays.

/** The two tabs of the Pendaftar area, for who may purge. Nothing is drawn for anyone else: they have one page, as before. */
export function PendaftarTabs({ current }: { current: "applicants" | "drafts" }) {
  const me = useMe();
  if (accessTo(me, "pendaftaran") !== "write") return null;
  const tab = (active: boolean) =>
    cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors", active ? "border-primary-blue text-primary-blue" : "border-transparent text-gray-600 hover:text-gray-900");
  return (
    <nav aria-label="Bagian Pendaftar" className="mb-6 flex gap-1 border-b border-gray-200">
      <Link to={ROUTE} aria-current={current === "applicants" ? "page" : undefined} className={tab(current === "applicants")}>
        Pendaftar
      </Link>
      <Link to={DRAFTS_ROUTE} aria-current={current === "drafts" ? "page" : undefined} className={tab(current === "drafts")}>
        Draf dengan berkas
      </Link>
    </nav>
  );
}

const when = (iso: string, style: "short" | "date" = "short") =>
  new Date(iso).toLocaleString("id-ID", style === "date" ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" });

const COLUMNS: readonly Column<DraftFilesRow>[] = [
  { key: "draft", header: "Draf", className: "align-top font-mono text-xs text-gray-700", cell: (row) => shortDraftId(row.id) },
  { key: "batch", header: "Batch", className: "align-top text-xs text-gray-600", cell: (row) => `${row.batch.year} · ${row.batch.name}` },
  { key: "files", header: "Berkas", cell: (row) => `${row.files} berkas · ${formatBytes(row.bytes)}` },
  { key: "updated", header: "Terakhir diubah", className: "align-top text-xs text-gray-500", cell: (row) => when(row.updatedAt) },
];

const PENDING_NOTICE = "Berkas sudah dihapus dari daftar, tetapi sebagian belum terhapus dari penyimpanan. Sistem akan mencoba lagi otomatis.";

export function DraftFilesPage() {
  const me = useMe();
  // Nobody but a writer gets a request: the list is a component of its own, so a viewer's page never asks.
  if (accessTo(me, "pendaftaran") !== "write") return <ForbiddenPage />;
  return <DraftFilesList />;
}

function DraftFilesList() {
  const list = useList<DraftFilesRow>(DRAFT_FILES_PATH, DRAFTS_LIST_SPEC);
  const notice = useFlash();
  const [asking, setAsking] = useState<DraftFilesRow | null>(null);
  const purge = useMutation<DraftFilesRow, { purged: number; pending: number }>((row) => api(draftPurgePath(row.id), { method: "POST", json: { confirm: true } }));

  async function confirm() {
    if (!asking) return;
    const result = await purge.submit(asking);
    if (!result) return;
    if (!result.ok) {
      // The draft changed under us (409: the student saved again) or is gone (404): the list is out of date, the dialog says why.
      if (result.status === 409 || result.status === 404) list.refetch();
      return;
    }
    setAsking(null);
    list.refetch();
    notice.show(result.data.pending > 0 ? { tone: "danger", text: PENDING_NOTICE } : { tone: "success", text: "Berkas draf sudah dihapus." });
  }

  return (
    <div className="p-6 md:p-10">
      <PageHeader title="Draf dengan berkas">
        <p className="text-gray-600">Siswa yang sudah mengunggah berkas tetapi belum mengirim pendaftaran. Nama dan isian mereka tidak ditampilkan.</p>
        <p className="mt-1 text-sm text-gray-600">Berkas draf baru bisa dihapus setelah {DRAFT_PURGE_MIN_DAYS} hari tanpa perubahan. Berkas tidak dihapus otomatis.</p>
      </PageHeader>

      <PendaftarTabs current="drafts" />
      <Flash flash={notice.flash} dismiss={notice.dismiss} />

      <DataTable<DraftFilesRow>
        caption="Daftar draf dengan berkas"
        columns={COLUMNS}
        rows={list.items}
        rowKey={(row) => row.id}
        state={list.status}
        errorMessage={list.failure ? describeFailure(list.failure).message : MESSAGES.loadFailed}
        onRetry={list.refetch}
        emptyText="Tidak ada draf dengan berkas."
        actions={(row) =>
          row.purgeable ? (
            <Button
              variant="danger"
              size="sm"
              aria-label={`Hapus berkas draf ${shortDraftId(row.id)}`}
              onClick={() => {
                purge.clearErrors();
                setAsking(row);
              }}
            >
              Hapus Berkas
            </Button>
          ) : (
            <span className="text-xs text-gray-500">Bisa dihapus mulai {when(row.purgeableAt, "date")}</span>
          )
        }
        refreshing={list.refreshing}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} searchFor={list.searchFor} />

      <ConfirmDialog
        open={asking !== null}
        title="Hapus berkas draf ini?"
        description={
          asking ? (
            <>
              {asking.files} berkas dari draf {shortDraftId(asking.id)} akan dihapus permanen dan tidak bisa dikembalikan. Isian siswa tidak ikut dihapus. Penghapusan tercatat di Aktivitas, tanpa nama atau isi berkas.
            </>
          ) : null
        }
        confirmLabel="Hapus Berkas"
        pending={purge.pending}
        pendingLabel="Menghapus..."
        error={purge.formError}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setAsking(null);
          purge.clearErrors();
        }}
      />
    </div>
  );
}
