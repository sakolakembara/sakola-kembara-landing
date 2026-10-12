import { Link } from "react-router";
import { StatusTag } from "~/components/crud/StatusTag";
import { ListPage } from "~/components/crud/ListPage";
import type { Column } from "~/components/crud/DataTable";
import { type AnnouncementListItem, API_PATH, formatWindow, LIST_SPEC, ROUTE, SEVERITIES, SEVERITY_LABEL, SEVERITY_STATUS, STATUS_VIEW } from "./model";

// The list of announcements, built with `ListPage`: the reference screen of docs/cloudflare/admin-crud.md.

/** The legacy Status look: a green dot and green text for what is on screen, amber for active but not showing, gray for off. */
function StatusCell({ status }: { status: string }) {
  const view = Object.hasOwn(STATUS_VIEW, status) ? STATUS_VIEW[status as keyof typeof STATUS_VIEW] : null;
  if (!view) return <span className="text-xs text-gray-500">{status || "-"}</span>;
  if (view.tone === "shown") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-500" />
        {view.label}
      </span>
    );
  }
  return <span className={view.tone === "waiting" ? "text-xs text-amber-700" : "text-xs text-gray-500"}>{view.label}</span>;
}

const COLUMNS: readonly Column<AnnouncementListItem>[] = [
  {
    key: "message",
    header: "Pesan",
    className: "max-w-[400px] align-top",
    cell: (row) => (
      <>
        <Link to={`${ROUTE}/${encodeURIComponent(row.id)}/edit`} className="font-medium text-gray-900 hover:text-primary-blue">
          {row.title}
        </Link>
        <p className="mt-1 line-clamp-1 text-xs text-gray-500">{row.body}</p>
      </>
    ),
  },
  { key: "severity", header: "Severity", cell: (row) => <StatusTag map={SEVERITY_STATUS} value={row.severity} /> },
  { key: "window", header: "Jadwal", className: "align-top text-xs text-gray-500", cell: (row) => formatWindow(row.startsAt, row.endsAt) },
  {
    key: "status",
    header: "Status",
    cell: (row) => <StatusCell status={row.status} />,
  },
];

export function AnnouncementsPage() {
  return (
    <ListPage<AnnouncementListItem>
      title="Pengumuman"
      description={(list) => (
        <p>
          {list.total.toLocaleString("id-ID")} total pengumuman. Strip pengumuman tampil di seluruh halaman publik saat ada satu yang aktif dan dalam jendela jadwal. Bila ada beberapa, yang terakhir dibuat yang tampil.
        </p>
      )}
      apiPath={API_PATH}
      routePath={ROUTE}
      area="komunikasi"
      spec={LIST_SPEC}
      columns={COLUMNS}
      caption="Daftar pengumuman"
      search={{ label: "Cari", placeholder: "Judul atau isi" }}
      filters={[
        { name: "severity", label: "Severity", allLabel: "Semua severity", options: SEVERITIES.map((value) => ({ value, label: SEVERITY_LABEL[value] })) },
        {
          name: "active",
          label: "Status",
          allLabel: "Semua status",
          options: [
            { value: "true", label: "Aktif" },
            { value: "false", label: "Tidak aktif" },
          ],
        },
      ]}
      noun="pengumuman"
      nameOf={(row) => row.title}
      createLabel="Pengumuman Baru"
      emptyText={(canWrite) => (canWrite ? "Belum ada pengumuman. Klik “Pengumuman Baru” untuk membuat." : "Belum ada pengumuman.")}
      emptyFilteredText="Tidak ada pengumuman yang cocok dengan filter."
    />
  );
}
