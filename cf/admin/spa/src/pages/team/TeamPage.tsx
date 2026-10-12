import { User } from "lucide-react";
import { Link } from "react-router";
import type { Column } from "~/components/crud/DataTable";
import { ListPage } from "~/components/crud/ListPage";
import { StatusTag } from "~/components/crud/StatusTag";
import { useUploadsBase } from "~/lib/crud/upload-client";
import { uploadUrl } from "~/lib/crud/upload-kinds";
import { SITE_URL } from "~/lib/site";
import { API_PATH, CATEGORY_LABEL, CATEGORY_ORDER, CATEGORY_STATUS, LIST_SPEC, ROUTE, type TeamListItem } from "./model";

// The list of the team, built with `ListPage` (docs/cloudflare/admin-crud.md). The columns, the wording and the
// order are the legacy page's (app/(admin)/admin/team/page.tsx): grouped by category, then by display order.

/** The round photo of a row, or the placeholder person. The file lives on the public files domain (base from /api/config). */
function Photo({ member }: { member: TeamListItem }) {
  const base = useUploadsBase();
  return (
    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gray-100">
      {member.image ? <img src={uploadUrl(member.image, base)} alt="" className="h-full w-full object-cover" /> : <User size={16} aria-hidden="true" className="text-gray-300" />}
    </div>
  );
}

const COLUMNS: readonly Column<TeamListItem>[] = [
  { key: "photo", header: "Foto", className: "align-middle", cell: (row) => <Photo member={row} /> },
  {
    key: "name",
    header: "Nama",
    className: "align-middle",
    cell: (row) => (
      <Link to={`${ROUTE}/${encodeURIComponent(row.id)}/edit`} className="font-medium text-gray-900 hover:text-primary-blue">
        {row.name}
      </Link>
    ),
  },
  { key: "role", header: "Peran", className: "align-middle text-gray-700", cell: (row) => row.role },
  { key: "category", header: "Kategori", className: "align-middle", cell: (row) => <StatusTag map={CATEGORY_STATUS} value={row.category} /> },
  { key: "order", header: "Urutan", className: "align-middle font-mono text-xs text-gray-500", cell: (row) => row.displayOrder },
];

export function TeamPage() {
  return (
    <ListPage<TeamListItem>
      title="Tim"
      description={(list) => (
        <p>
          {list.total.toLocaleString("id-ID")} anggota tampil di{" "}
          <a href={`${SITE_URL}/tim`} target="_blank" rel="noopener noreferrer" className="text-primary-blue hover:underline">
            /tim
          </a>{" "}
          (dikelompokkan per kategori, lalu diurutkan berdasarkan urutan tampil).
        </p>
      )}
      apiPath={API_PATH}
      routePath={ROUTE}
      area="konten"
      spec={LIST_SPEC}
      columns={COLUMNS}
      caption="Daftar anggota tim"
      search={{ label: "Cari", placeholder: "Nama atau peran" }}
      filters={[{ name: "category", label: "Kategori", allLabel: "Semua kategori", options: CATEGORY_ORDER.map((value) => ({ value, label: CATEGORY_LABEL[value] })) }]}
      noun="anggota"
      nameOf={(row) => row.name}
      createLabel="Tambah Anggota"
      deleteNote="Foto juga akan dihapus dari server."
      emptyText={(canWrite) => (canWrite ? "Belum ada anggota tim. Klik “Tambah Anggota” untuk membuat." : "Belum ada anggota tim.")}
      emptyFilteredText="Tidak ada anggota yang cocok dengan filter."
    />
  );
}
