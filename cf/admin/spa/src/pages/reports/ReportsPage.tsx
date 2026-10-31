import { Download } from "lucide-react";
import { Link } from "react-router";
import type { Column } from "~/components/crud/DataTable";
import { ListPage } from "~/components/crud/ListPage";
import { StatusTag } from "~/components/crud/StatusTag";
import { useConfig } from "~/lib/config";
import { useUploadsBase } from "~/lib/crud/upload-client";
import { storedFileUrl } from "~/lib/crud/upload-kinds";
import { formatDate } from "~/lib/format";
import { SITE_URL } from "~/lib/site";
import { API_PATH, CATEGORIES, CATEGORY_LABEL, CATEGORY_STATUS, formatBytes, LIST_SPEC, type ReportItem, ROUTE, yearKind } from "./model";

// The list of reports, built with `ListPage` (docs/cloudflare/admin-crud.md). The columns, the wording and the
// order are the legacy page's (app/(admin)/admin/reports/page.tsx): newest year first, then newest upload.

/** The PDF, opened in a tab. An upload lives on the public files domain, a legacy file on the public site: both addresses come from /api/config. */
function FileLink({ row }: { row: ReportItem }) {
  const base = useUploadsBase();
  const { siteUrl } = useConfig();
  return (
    <a
      href={storedFileUrl(row.filePath, base, siteUrl)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Buka PDF ${row.title}`}
      className="mr-3 inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 hover:underline"
    >
      <Download size={14} aria-hidden="true" /> Lihat
    </a>
  );
}

const COLUMNS: readonly Column<ReportItem>[] = [
  {
    key: "title", sort: "title",
    header: "Judul",
    className: "max-w-[400px] align-top",
    cell: (row) => (
      <>
        <Link to={`${ROUTE}/${encodeURIComponent(row.id)}/edit`} className="font-medium text-gray-900 hover:text-primary-blue">
          {row.title}
        </Link>
        {row.description && <p className="mt-1 line-clamp-2 text-xs text-gray-600">{row.description}</p>}
        <p className="mt-1 truncate font-mono text-xs text-gray-400">{row.filePath}</p>
      </>
    ),
  },
  { key: "category", sort: "category", header: "Kategori", cell: (row) => <StatusTag map={CATEGORY_STATUS} value={row.category} /> },
  {
    key: "year", sort: "year", sortFirst: "desc",
    header: "Tahun",
    className: "whitespace-nowrap align-top font-medium text-gray-700",
    cell: (row) => (
      <>
        {row.year}
        <div className="text-xs font-normal text-gray-400">{yearKind(row.year)}</div>
      </>
    ),
  },
  { key: "size", sort: "fileSize", sortFirst: "desc", header: "Ukuran", className: "align-top text-xs text-gray-500", cell: (row) => formatBytes(row.fileSize) },
  { key: "uploadedAt", sort: "uploadedAt", sortFirst: "desc", header: "Diupload", className: "whitespace-nowrap align-top text-xs text-gray-500", cell: (row) => formatDate(row.uploadedAt) },
];

export function ReportsPage() {
  return (
    <ListPage<ReportItem>
      title="Laporan"
      description={(list) => (
        <p>
          {list.total.toLocaleString("id-ID")} total laporan. Tampil di publik di{" "}
          <a href={`${SITE_URL}/laporan`} target="_blank" rel="noopener noreferrer" className="text-primary-blue hover:underline">
            /laporan
          </a>
          .
        </p>
      )}
      apiPath={API_PATH}
      routePath={ROUTE}
      area="konten"
      spec={LIST_SPEC}
      columns={COLUMNS}
      caption="Daftar laporan"
      search={{ label: "Cari", placeholder: "Judul, deskripsi, atau tahun" }}
      filters={[{ name: "category", label: "Kategori", allLabel: "Semua kategori", options: CATEGORIES.map((value) => ({ value, label: CATEGORY_LABEL[value] })) }]}
      noun="laporan"
      nameOf={(row) => row.title}
      createLabel="Upload Laporan"
      deleteNote="File PDF dan metadata akan dihapus."
      rowActions={(row) => <FileLink row={row} />}
      emptyText={(canWrite) => (canWrite ? "Belum ada laporan. Klik “Upload Laporan” untuk menambah." : "Belum ada laporan.")}
      emptyFilteredText="Tidak ada laporan yang cocok dengan filter."
    />
  );
}
