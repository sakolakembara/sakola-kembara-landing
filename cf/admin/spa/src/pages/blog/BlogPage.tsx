import { Link } from "react-router";
import { StatusTag } from "~/components/crud/StatusTag";
import { ListPage } from "~/components/crud/ListPage";
import type { Column } from "~/components/crud/DataTable";
import { isFiltered } from "~/lib/crud/query";
import { API_PATH, type BlogListItem, CATEGORY_OPTIONS, LIST_SPEC, ROUTE, STATUS } from "./model";
import { formatIsoDay } from "./rules";

// The list of articles, built with `ListPage`: the legacy list (title with its excerpt, category, date, edit and
// delete) plus the status and a status filter, which the legacy blog did not need (everything saved was public).

const COLUMNS: readonly Column<BlogListItem>[] = [
  {
    key: "title", sort: "title",
    header: "Judul",
    className: "max-w-[400px] align-top",
    cell: (row) => (
      <>
        <Link to={`${ROUTE}/${encodeURIComponent(row.id)}/edit`} className="font-medium text-gray-900 hover:text-primary-blue">
          {row.title}
        </Link>
        {row.featured && <span className="ml-2 inline-block rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">Featured</span>}
        <p className="mt-1 line-clamp-1 text-xs text-gray-500">{row.excerpt}</p>
      </>
    ),
  },
  { key: "category", header: "Kategori", className: "align-top text-gray-600", cell: (row) => row.category },
  { key: "status", header: "Status", className: "align-top", cell: (row) => <StatusTag map={STATUS} value={row.status} /> },
  { key: "date", header: "Tanggal", className: "align-top whitespace-nowrap text-xs text-gray-500", cell: (row) => (row.date ? formatIsoDay(row.date) : "-") },
];

export function BlogPage() {
  return (
    <ListPage<BlogListItem>
      title="Blog"
      description={(list) => <p>{isFiltered(list.query) ? `${list.total.toLocaleString("id-ID")} artikel ditampilkan` : `${list.total.toLocaleString("id-ID")} total artikel`}</p>}
      apiPath={API_PATH}
      routePath={ROUTE}
      area="konten"
      spec={LIST_SPEC}
      columns={COLUMNS}
      caption="Daftar artikel"
      search={{ label: "Cari", placeholder: "Cari judul atau excerpt..." }}
      filters={[
        { name: "category", label: "Kategori", allLabel: "Semua kategori", options: CATEGORY_OPTIONS },
        {
          name: "status",
          label: "Status",
          allLabel: "Semua status",
          options: [
            { value: "published", label: STATUS.published.label },
            { value: "draft", label: STATUS.draft.label },
          ],
        },
      ]}
      noun="artikel"
      nameOf={(row) => row.title}
      createLabel="Tulis Artikel Baru"
      emptyText={(canWrite) => (canWrite ? "Belum ada artikel. Klik “Tulis Artikel Baru” untuk membuat." : "Belum ada artikel.")}
      emptyFilteredText="Tidak ada artikel yang cocok."
    />
  );
}
