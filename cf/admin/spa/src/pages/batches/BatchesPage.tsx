import { Link } from "react-router";
import { ListPage } from "~/components/crud/ListPage";
import type { Column } from "~/components/crud/DataTable";
import { StatusTag } from "~/components/crud/StatusTag";
import { API_PATH, applicantsLink, type BatchListed, formatPeriod, LIST_SPEC, PHASE_STATUS, ROUTE } from "./model";

// The list of batches, built with `ListPage` (docs/cloudflare/admin-crud.md). A port of
// app/(admin)/admin/batches/page.tsx: Tahun, Nama, Periode, Status and a link to the batch. What the legacy list
// did not have: the applicants still waiting for a decision per batch, each count a link to the Pendaftar list
// filtered to that batch and status (docs/cloudflare/admin-ia.md, 3.4), and "Hapus" for a batch nobody applied to.

const COLUMNS: readonly Column<BatchListed>[] = [
  { key: "year", header: "Tahun", className: "align-top font-mono font-medium text-gray-900", cell: (row) => row.year },
  {
    key: "name",
    header: "Nama",
    className: "align-top text-gray-900",
    cell: (row) => (
      <Link to={`${ROUTE}/${encodeURIComponent(row.id)}`} className="hover:text-primary-blue">
        {row.name}
      </Link>
    ),
  },
  { key: "period", header: "Periode", className: "align-top text-xs text-gray-600", cell: (row) => formatPeriod(row.opensAt, row.closesAt) },
  { key: "phase", header: "Status", cell: (row) => <StatusTag map={PHASE_STATUS} value={row.phase} /> },
  {
    key: "undecided",
    header: "Belum diputuskan",
    className: "align-top text-xs",
    cell: (row) =>
      row.pending + row.underReview === 0 ? (
        <span className="text-gray-400">0</span>
      ) : (
        <span className="flex flex-col gap-0.5">
          {row.pending > 0 && (
            <Link to={applicantsLink(row.id, "pending")} className="font-medium text-primary-blue hover:underline">
              {row.pending} pending
            </Link>
          )}
          {row.underReview > 0 && (
            <Link to={applicantsLink(row.id, "under_review")} className="font-medium text-primary-blue hover:underline">
              {row.underReview} dalam review
            </Link>
          )}
        </span>
      ),
  },
];

export function BatchesPage() {
  return (
    <ListPage<BatchListed>
      title="Batch Pendaftaran"
      description={
        <p>
          Pendaftaran siswa dibuka satu batch per tahun. Buat batch baru untuk membuka periode pendaftaran, lalu publikasikan hasil setelah semua keputusan
          selesai.
        </p>
      }
      apiPath={API_PATH}
      routePath={ROUTE}
      area="pendaftaran"
      spec={LIST_SPEC}
      columns={COLUMNS}
      caption="Daftar batch pendaftaran"
      search={{ label: "Cari", placeholder: "Nama batch" }}
      noun="batch"
      nameOf={(row) => row.name}
      createLabel="Batch Baru"
      emptyText={(canWrite) => (canWrite ? "Belum ada batch. Klik Batch Baru untuk membuka periode pendaftaran pertama." : "Belum ada batch.")}
      emptyFilteredText="Tidak ada batch yang cocok dengan pencarian."
      rowActions={(row, access) => (
        <Link to={`${ROUTE}/${encodeURIComponent(row.id)}`} aria-label={`${access === "write" ? "Kelola" : "Detail"} ${row.name}`} className="mr-3 inline-flex items-center gap-1 text-sm font-medium text-primary-blue hover:underline">
          {access === "write" ? "Kelola" : "Detail"}
        </Link>
      )}
    />
  );
}
