import { ExternalLink } from "lucide-react";
import { Link } from "react-router";
import type { Column } from "~/components/crud/DataTable";
import { ListPage } from "~/components/crud/ListPage";
import { formatDateTime } from "~/lib/format";
import { SITE_URL } from "~/lib/site";
import { CopyButton } from "./CopyButton";
import { API_PATH, LIST_SPEC, ROUTE, type ShortlinkItem, shortUrl } from "./model";

// The list of shortlinks, built with `ListPage` (docs/cloudflare/admin-crud.md). The columns and the wording are the
// legacy page's (app/(admin)/admin/shortlinks/page.tsx): the address with a copy button, where it goes, how many
// clicks it had and when the last one was, and whether it is switched on.

const COLUMNS: readonly Column<ShortlinkItem>[] = [
  {
    key: "slug", sort: "slug",
    header: "Alamat pendek",
    cell: (row) => (
      <>
        <Link to={`${ROUTE}/${encodeURIComponent(row.id)}/edit`} className="font-mono font-medium text-gray-900 hover:text-primary-blue">
          /{row.slug}
        </Link>
        <div className="mt-1">
          <CopyButton url={shortUrl(row.slug)} />
        </div>
        {row.note && <p className="mt-1 line-clamp-2 max-w-[240px] text-xs text-gray-500">{row.note}</p>}
      </>
    ),
  },
  {
    key: "target",
    header: "Tujuan",
    className: "max-w-[320px] align-top",
    cell: (row) => (
      <a href={row.targetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 break-all text-gray-600 hover:text-primary-blue">
        <span className="line-clamp-2">{row.targetUrl}</span>
        <ExternalLink size={12} aria-hidden="true" className="mt-1 shrink-0" />
      </a>
    ),
  },
  {
    key: "clicks", sort: "clickCount", sortFirst: "desc",
    header: "Klik",
    className: "whitespace-nowrap align-top",
    cell: (row) => (
      <>
        <div className="font-medium text-gray-900">{row.clickCount.toLocaleString("id-ID")}</div>
        <div className="mt-0.5 text-xs text-gray-500">{row.clickCount > 0 && row.lastClickedAt ? formatDateTime(row.lastClickedAt) : "Belum diklik"}</div>
      </>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (row) =>
      row.active ? (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-green-700">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-500" />
          Aktif
        </span>
      ) : (
        <span className="text-xs text-gray-500">Nonaktif</span>
      ),
  },
];

export function ShortlinksPage() {
  return (
    <ListPage<ShortlinkItem>
      title="Shortlink"
      description={(list) => {
        // "N aktif" counts the rows on screen, so it is only told when they are all of them.
        const everyLink = list.status === "ready" && list.total === list.items.length;
        return (
          <p>
            {list.total.toLocaleString("id-ID")} shortlink{everyLink ? `, ${list.items.filter((row) => row.active).length.toLocaleString("id-ID")} aktif` : ""}. Alamat pendek di <span className="font-mono text-sm">{SITE_URL}/slug</span> yang mengarahkan
            pengunjung ke tujuan mana pun.
          </p>
        );
      }}
      apiPath={API_PATH}
      routePath={ROUTE}
      area="konten"
      spec={LIST_SPEC}
      columns={COLUMNS}
      caption="Daftar shortlink"
      search={{ label: "Cari", placeholder: "Slug, tujuan, atau catatan" }}
      filters={[
        {
          name: "active",
          label: "Status",
          allLabel: "Semua status",
          options: [
            { value: "true", label: "Aktif" },
            { value: "false", label: "Nonaktif" },
          ],
        },
      ]}
      noun="shortlink"
      nameOf={(row) => `/${row.slug}`}
      createLabel="Shortlink Baru"
      deleteNote="Alamat yang sudah tersebar tidak akan berfungsi lagi."
      emptyText={(canWrite) => (canWrite ? "Belum ada shortlink. Klik “Shortlink Baru” untuk membuat." : "Belum ada shortlink.")}
      emptyFilteredText="Tidak ada shortlink yang cocok dengan filter."
    />
  );
}
