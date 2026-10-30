import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/crud/ConfirmDialog";
import { api } from "~/lib/api";
import { useMutation } from "~/lib/crud/useMutation";
import { fileTypeLabel, formatBytes } from "./answers";
import { type ApplicationFile, filePath, purgePath } from "./model";

// The files an applicant uploaded, on the applicant's page (SAKEM-083, docs/cloudflare/portal-architecture.md, 8.8).
//
//   FilesValue   one row of the detail: what a slot holds (the count, the total size, and each file's type and size),
//                and for someone who may open them a "Lihat" link per file. Nothing is loaded by itself: a link is
//                followed by a person, in a new tab, and the Worker writes an audit row for each open (so there are no
//                thumbnails, which would be an open, an R2 read and eight D1 rows each, and a row per file nobody chose).
//   PurgeFiles   the manual purge (nothing is deleted automatically, Dzul 2026-10-13): one button and a question.
//
// Opening needs `pendaftaran` write. A `viewer` sees the same list and is told who can open the files.

const EXTERNAL = "inline-flex items-center gap-1 text-primary-blue hover:underline";

function describeFile(file: ApplicationFile): string {
  const size = file.width !== null && file.height !== null ? ` · ${file.width}×${file.height}` : "";
  return `${fileTypeLabel(file.contentType)} · ${formatBytes(file.size)}${size}`;
}

export function FilesValue({ applicationId, files, canOpen }: { applicationId: string; files: ApplicationFile[]; canOpen: boolean }) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  return (
    <div className="space-y-1.5">
      <div className="text-gray-700">
        {files.length} berkas · {formatBytes(total)}
      </div>
      <ul className="space-y-1">
        {files.map((file, index) => (
          <li key={file.id} className="flex flex-wrap items-center gap-x-3 text-sm">
            {canOpen ? (
              // A PDF is offered as a download, never rendered by our pages (the Worker says `attachment`).
              <a href={filePath(applicationId, file.id)} target="_blank" rel="noopener noreferrer" className={EXTERNAL}>
                <ExternalLink size={12} aria-hidden="true" />
                {file.contentType === "application/pdf" ? "Unduh" : "Lihat"} berkas {index + 1}
              </a>
            ) : (
              <span className="text-gray-700">Berkas {index + 1}</span>
            )}
            <span className="text-xs text-gray-500">{describeFile(file)}</span>
          </li>
        ))}
      </ul>
      {!canOpen && <p className="text-xs text-gray-500">Berkas hanya bisa dibuka oleh tim Pendaftaran.</p>}
    </div>
  );
}

interface PurgeProps {
  applicationId: string;
  fullName: string;
  files: ApplicationFile[];
  /** The purge went through: `pending` files could not be removed from storage yet (the daily cleanup finishes them). */
  onPurged: (result: { purged: number; pending: number }) => void;
}

/** The card with the one destructive action of the files. Only drawn for someone who may purge (`canOpenFiles`). */
export function PurgeFiles({ applicationId, fullName, files, onPurged }: PurgeProps) {
  const [asking, setAsking] = useState(false);
  const purge = useMutation<null, { purged: number; pending: number }>(() => api(purgePath(applicationId), { method: "POST", json: { confirm: true } }));
  const total = files.reduce((sum, file) => sum + file.size, 0);

  async function confirm() {
    const result = await purge.submit(null);
    if (!result?.ok) return;
    setAsking(false);
    onPurged(result.data);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
      <header className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">Berkas Pendaftar</h2>
      </header>
      <div className="space-y-3 p-6">
        <p className="text-sm text-gray-700">
          {files.length} berkas · {formatBytes(total)} tersimpan di penyimpanan pribadi. Berkas tidak dihapus otomatis.
        </p>
        <Button variant="danger" fullWidth onClick={() => setAsking(true)}>
          Hapus Semua Berkas
        </Button>
      </div>
      <ConfirmDialog
        open={asking}
        title="Hapus semua berkas pendaftar ini?"
        description={
          <>
            {files.length} berkas milik {fullName} akan dihapus permanen dan tidak bisa dikembalikan. Penghapusan tercatat di Aktivitas, tanpa nama atau isi berkas.
          </>
        }
        confirmLabel="Hapus Semua Berkas"
        pending={purge.pending}
        pendingLabel="Menghapus..."
        error={purge.formError}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setAsking(false);
          purge.clearErrors();
        }}
      />
    </div>
  );
}
